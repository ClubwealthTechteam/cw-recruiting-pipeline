import 'server-only';
import { neon } from '@neondatabase/serverless';

/**
 * The CRM's own database (Neon Postgres, Miguel, 2026-11-12). Stage 1 of moving off the Google Sheet: the sheet
 * stays in charge, and the Apps Script sends every row it writes here (see dbFlush_ / dbPushTab_ in Code.gs), so
 * pages can read from Postgres instead of reading the whole sheet.
 *
 *  sheet_rows: one row per sheet row, by tab and sheet row number, with the row's values as JSON
 *  kv:         values the site cannot work out from those rows (team list, job ads) and switches (readFromDb)
 */
export const dbConfigured = () => !!process.env.DATABASE_URL;
const sql = () => neon(process.env.DATABASE_URL!);

let schemaReady: Promise<void> | null = null;
export function ensureSchema() {
  if (!schemaReady) {
    const q = sql();
    schemaReady = q.transaction([
      q`create table if not exists sheet_rows (
          tab text not null, row_no integer not null, data jsonb not null,
          updated_at timestamptz not null default now(), primary key (tab, row_no))`,
      q`create table if not exists kv (key text primary key, value jsonb, updated_at timestamptz not null default now())`,
      // stage 2: saves shown at once in the CRM, then done on the sheet by the Apps Script in order
      q`create table if not exists ops (
          id bigserial primary key, created_at timestamptz not null default now(), by_user text not null,
          body jsonb not null, revert jsonb not null default '[]', label text not null default '',
          status text not null default 'pending', started_at timestamptz, finished_at timestamptz,
          error text, dismissed boolean not null default false)`
    ]).then(() => undefined).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

export type SheetRow = { row: number; data: Record<string, unknown> };

/** Writes (or overwrites) rows of one tab by sheet row number: one query for the whole batch. */
export async function upsertRows(tab: string, rows: SheetRow[]) {
  if (!rows.length) return 0;
  await ensureSchema();
  await sql().query(
    `insert into sheet_rows (tab, row_no, data, updated_at)
     select $1, (x->>'row')::int, x->'data', now() from jsonb_array_elements($2::jsonb) as x
     on conflict (tab, row_no) do update set data = excluded.data, updated_at = now()`,
    [tab, JSON.stringify(rows)]
  );
  return rows.length;
}

/** After a full copy of a tab: rows past the sheet's last row are gone from the sheet, so they go here too. */
export async function trimTab(tab: string, lastRow: number) {
  await ensureSchema();
  await sql().query('delete from sheet_rows where tab = $1 and row_no > $2', [tab, lastRow]);
}

/** One tab's rows, in sheet order. */
export async function readTab(tab: string): Promise<Record<string, unknown>[]> {
  await ensureSchema();
  const rows = await sql().query('select data from sheet_rows where tab = $1 order by row_no', [tab]);
  return (rows as { data: Record<string, unknown> }[]).map((r) => r.data);
}

/** Several tabs in one round trip. */
export async function readTabs(tabs: string[]): Promise<Record<string, Record<string, unknown>[]>> {
  await ensureSchema();
  const rows = (await sql().query('select tab, data from sheet_rows where tab = any($1) order by tab, row_no', [tabs])) as { tab: string; data: Record<string, unknown> }[];
  const out: Record<string, Record<string, unknown>[]> = Object.fromEntries(tabs.map((t) => [t, []]));
  for (const r of rows) out[r.tab].push(r.data);
  return out;
}

export async function setKv(key: string, value: unknown) {
  await ensureSchema();
  await sql().query(
    `insert into kv (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value ?? null)]
  );
}

export async function getKv<T = unknown>(key: string): Promise<T | undefined> {
  await ensureSchema();
  const rows = (await sql().query('select value from kv where key = $1', [key])) as { value: T }[];
  return rows[0]?.value;
}

export async function getKvs(keys: string[]): Promise<Record<string, unknown>> {
  await ensureSchema();
  const rows = (await sql().query('select key, value from kv where key = any($1)', [keys])) as { key: string; value: unknown }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Row counts and the newest change per tab, for the Database page. */
export async function tabStats(): Promise<{ tab: string; rows: number; updated: string }[]> {
  await ensureSchema();
  const rows = (await sql().query(
    "select tab, count(*)::int as rows, to_char(max(updated_at) at time zone 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI:SS') as updated from sheet_rows group by tab order by tab"
  )) as { tab: string; rows: number; updated: string }[];
  return rows;
}

// ---------- rows by their ID column (stage 2) ----------

/** Rows of one tab whose keyField is one of ids, with their sheet row number. */
export async function rowsByKey(tab: string, keyField: string, ids: string[]): Promise<{ row: number; data: Record<string, unknown> }[]> {
  if (!ids.length) return [];
  await ensureSchema();
  const rows = (await sql().query('select row_no, data from sheet_rows where tab = $1 and data->>$2 = any($3)', [tab, keyField, ids])) as { row_no: number; data: Record<string, unknown> }[];
  return rows.map((r) => ({ row: r.row_no, data: r.data }));
}

export type Patch = { tab: string; row: number; set: Record<string, unknown> };

/** Merges fields into rows (one query per row, sent together). */
export async function applyPatches(patches: Patch[]) {
  if (!patches.length) return;
  await ensureSchema();
  const q = sql();
  await q.transaction(patches.map((p) => q.query(
    'update sheet_rows set data = data || $3::jsonb, updated_at = now() where tab = $1 and row_no = $2',
    [p.tab, p.row, JSON.stringify(p.set)]
  )));
}

// ---------- the save queue (stage 2) ----------

export type Op = { id: number; by_user: string; body: Record<string, unknown>; revert: Patch[]; label: string; status: string; error: string | null; created_at: string };

export async function enqueueOp(by: string, body: Record<string, unknown>, revert: Patch[], label: string) {
  await ensureSchema();
  const rows = (await sql().query('insert into ops (by_user, body, revert, label) values ($1, $2::jsonb, $3::jsonb, $4) returning id',
    [by, JSON.stringify(body), JSON.stringify(revert), label])) as { id: number }[];
  return rows[0].id;
}

/**
 * The oldest waiting save, marked running. Saves go one at a time and in order: nothing is taken while another is
 * running (a running save older than 3 minutes counts as stuck and is retried).
 */
export async function claimNextOp(): Promise<Op | null> {
  await ensureSchema();
  const q = sql();
  await q.query("update ops set status = 'pending', started_at = null where status = 'running' and started_at < now() - interval '3 minutes'");
  const rows = (await q.query(
    `update ops set status = 'running', started_at = now()
     where id = (select id from ops where status = 'pending' order by id limit 1 for update skip locked)
       and not exists (select 1 from ops where status = 'running')
     returning id, by_user, body, revert, label, status, error, created_at`
  )) as Op[];
  return rows[0] || null;
}

export async function finishOp(id: number, ok: boolean, error?: string) {
  await sql().query('update ops set status = $2, finished_at = now(), error = $3 where id = $1', [id, ok ? 'done' : 'failed', error || null]);
}

export async function opStats(): Promise<{ pending: number; failed: number }> {
  await ensureSchema();
  const rows = (await sql().query(
    "select count(*) filter (where status in ('pending','running'))::int as pending, count(*) filter (where status = 'failed' and created_at > now() - interval '7 days')::int as failed from ops"
  )) as { pending: number; failed: number }[];
  return rows[0] || { pending: 0, failed: 0 };
}

/** Saves of this person that did not go through and that they have not closed yet. */
export async function failedOpsFor(by: string): Promise<Op[]> {
  await ensureSchema();
  return (await sql().query(
    "select id, by_user, body, revert, label, status, error, created_at from ops where by_user = $1 and status = 'failed' and not dismissed and created_at > now() - interval '3 days' order by id",
    [by]
  )) as Op[];
}

export async function dismissOp(id: number, by: string) {
  await sql().query('update ops set dismissed = true where id = $1 and by_user = $2', [id, by]);
}
