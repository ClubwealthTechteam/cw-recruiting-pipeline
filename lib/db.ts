import 'server-only';
import { createClient, type Client, type InStatement, type Row as LibRow } from '@libsql/client/web';

/**
 * The CRM's own database. Miguel, 2026-11-17: moved from Neon (its free plan ran out of quota on Nov 17) to Turso
 * (libSQL / SQLite over HTTP), whose free plan counts rows read instead of data transferred. Same tables and the same
 * functions as before, so nothing else changed. The sheet stays in charge: the Apps Script sends every row it writes
 * here (dbFlush_ / dbPushTab_ in Code.gs), so pages can read from the database instead of reading the whole sheet.
 *
 *  sheet_rows: one row per sheet row, by tab and sheet row number, with the row's values as JSON text
 *  kv:         values the site cannot work out from those rows (team list, job ads) and switches (readFromDb)
 *  ops:        the stage-2 save queue
 * Times are epoch milliseconds. Settings come from Vercel: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.
 */
const URL_ = () => process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || '';
const TOKEN = () => process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || '';
export const dbConfigured = () => !!URL_();

let client: Client | null = null;
function db(): Client {
  if (!client) client = createClient({ url: URL_().replace(/^libsql:\/\//, 'https://'), authToken: TOKEN() || undefined });
  return client;
}
const now = () => Date.now();
const parse = (v: unknown) => { if (v === null || v === undefined) return undefined; try { return JSON.parse(String(v)); } catch { return v; } };
/** A JSON path for a column name such as "Email ID": $."Email ID" (column names are letters and spaces only). */
const jpathLit = (key: string) => { if (!/^[A-Za-z][A-Za-z ]*$/.test(key)) throw new Error('bad column name: ' + key); return '$."' + key + '"'; };
/** The ID columns rows are looked up by; each has an index. */
const KEY_FIELDS = ['Email ID', 'Applicant ID', 'Flag ID'];

let schemaReady: Promise<void> | null = null;
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = db().batch([
      `create table if not exists sheet_rows (
         tab text not null, row_no integer not null, data text not null,
         updated_at integer not null, primary key (tab, row_no))`,
      'create table if not exists kv (key text primary key, value text, updated_at integer not null)',
      // stage 2: saves shown at once in the CRM, then done on the sheet by the Apps Script in order
      `create table if not exists ops (
         id integer primary key autoincrement, created_at integer not null, by_user text not null,
         body text not null, revert text not null default '[]', label text not null default '',
         status text not null default 'pending', started_at integer, finished_at integer,
         error text, dismissed integer not null default 0)`,
      'create index if not exists ops_status on ops (status, id)',
      // the every-minute sender asks only for queued emails, and saves look rows up by their ID
      `create index if not exists sheet_rows_status on sheet_rows (tab, json_extract(data, '$."Status"'))`,
      ...KEY_FIELDS.map((k, i) => `create index if not exists sheet_rows_key${i} on sheet_rows (tab, json_extract(data, '${jpathLit(k)}'))`),
    ], 'write').then(() => undefined).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

export type SheetRow = { row: number; data: Record<string, unknown> };

/**
 * Writes (or overwrites) rows of one tab by sheet row number, in one statement. Rows whose data did not change are
 * left alone, so the regular full re-copies from the Apps Script do not count as writes.
 */
export async function upsertRows(tab: string, rows: SheetRow[]) {
  if (!rows.length) return 0;
  await ensureSchema();
  for (let i = 0; i < rows.length; i += 400) {
    const part = rows.slice(i, i + 400).map((r) => ({ row: r.row, data: JSON.stringify(r.data) }));
    await db().execute({
      sql: `insert into sheet_rows (tab, row_no, data, updated_at)
            select ?, json_extract(value, '$.row'), json_extract(value, '$.data'), ? from json_each(?) where true
            on conflict (tab, row_no) do update set data = excluded.data, updated_at = excluded.updated_at
            where sheet_rows.data <> excluded.data`,
      args: [tab, now(), JSON.stringify(part)],
    });
  }
  return rows.length;
}

/** After a full copy of a tab: rows past the sheet's last row are gone from the sheet, so they go here too. */
export async function trimTab(tab: string, lastRow: number) {
  await ensureSchema();
  await db().execute({ sql: 'delete from sheet_rows where tab = ? and row_no > ?', args: [tab, lastRow] });
}

/** One tab's rows, in sheet order. */
export async function readTab(tab: string): Promise<Record<string, unknown>[]> {
  return (await readTabs([tab]))[tab];
}

/** Several tabs in one round trip. */
export async function readTabs(tabs: string[]): Promise<Record<string, Record<string, unknown>[]>> {
  await ensureSchema();
  const out: Record<string, Record<string, unknown>[]> = Object.fromEntries(tabs.map((t) => [t, []]));
  if (!tabs.length) return out;
  const r = await db().execute({ sql: `select tab, data from sheet_rows where tab in (${tabs.map(() => '?').join(',')}) order by tab, row_no`, args: tabs });
  for (const row of r.rows) out[String(row.tab)].push(JSON.parse(String(row.data)));
  return out;
}

export async function setKv(key: string, value: unknown) {
  await ensureSchema();
  await db().execute({
    sql: 'insert into kv (key, value, updated_at) values (?, ?, ?) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at',
    args: [key, JSON.stringify(value ?? null), now()],
  });
}

export async function getKv<T = unknown>(key: string): Promise<T | undefined> {
  return (await getKvs([key]))[key] as T | undefined;
}

export async function getKvs(keys: string[]): Promise<Record<string, unknown>> {
  await ensureSchema();
  if (!keys.length) return {};
  const r = await db().execute({ sql: `select key, value from kv where key in (${keys.map(() => '?').join(',')})`, args: keys });
  return Object.fromEntries(r.rows.map((x) => [String(x.key), parse(x.value)]));
}

const pt = (ms: number) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

/** Row counts and the newest change per tab, for the Database page. */
export async function tabStats(): Promise<{ tab: string; rows: number; updated: string }[]> {
  await ensureSchema();
  const r = await db().execute('select tab, count(*) as n, max(updated_at) as at from sheet_rows group by tab order by tab');
  return r.rows.map((x) => ({ tab: String(x.tab), rows: Number(x.n), updated: x.at ? pt(Number(x.at)) : '' }));
}

// ---------- rows by their ID column (stage 2) ----------

/** Rows of one tab whose keyField is one of ids, with their sheet row number. */
export async function rowsByKey(tab: string, keyField: string, ids: string[]): Promise<{ row: number; data: Record<string, unknown> }[]> {
  if (!ids.length) return [];
  await ensureSchema();
  const r = await db().execute({
    // the path is written into the SQL (not passed as a value) so the index on it is used
    sql: `select row_no, data from sheet_rows where tab = ? and json_extract(data, '${jpathLit(keyField)}') in (${ids.map(() => '?').join(',')})`,
    args: [tab, ...ids],
  });
  return r.rows.map((x) => ({ row: Number(x.row_no), data: JSON.parse(String(x.data)) }));
}

/** Rows of one tab with this Status (indexed), in sheet order, with their sheet row number. */
export async function rowsByStatus(tab: string, status: string): Promise<{ row: number; data: Record<string, unknown> }[]> {
  await ensureSchema();
  const r = await db().execute({
    sql: `select row_no, data from sheet_rows where tab = ? and json_extract(data, '$."Status"') = ? order by row_no`,
    args: [tab, status],
  });
  return r.rows.map((x) => ({ row: Number(x.row_no), data: JSON.parse(String(x.data)) }));
}

export type Patch = { tab: string; row: number; set: Record<string, unknown> };

/** Merges fields into rows (one statement per row, sent together). */
export async function applyPatches(patches: Patch[]) {
  if (!patches.length) return;
  await ensureSchema();
  const t = now();
  // json_patch drops keys set to null, so null becomes '' (what an empty sheet cell holds)
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v ?? '']));
  await db().batch(patches.map((p) => ({
    sql: 'update sheet_rows set data = json_patch(data, ?), updated_at = ? where tab = ? and row_no = ?',
    args: [JSON.stringify(clean(p.set)), t, p.tab, p.row],
  })), 'write');
}

// ---------- the save queue (stage 2) ----------

export type Op = { id: number; by_user: string; body: Record<string, unknown>; revert: Patch[]; label: string; status: string; error: string | null; created_at: number };
const toOp = (x: LibRow): Op => ({
  id: Number(x.id), by_user: String(x.by_user), body: parse(x.body) as Record<string, unknown>, revert: (parse(x.revert) as Patch[]) || [],
  label: String(x.label ?? ''), status: String(x.status), error: x.error === null || x.error === undefined ? null : String(x.error), created_at: Number(x.created_at),
});
const OP_COLS = 'id, by_user, body, revert, label, status, error, created_at';

export async function enqueueOp(by: string, body: Record<string, unknown>, revert: Patch[], label: string) {
  await ensureSchema();
  const r = await db().execute({
    sql: 'insert into ops (created_at, by_user, body, revert, label) values (?, ?, ?, ?, ?) returning id',
    args: [now(), by, JSON.stringify(body), JSON.stringify(revert), label],
  });
  return Number(r.rows[0].id);
}

/**
 * The oldest waiting save, marked running. Saves go one at a time and in order: nothing is taken while another is
 * running (a running save older than 3 minutes counts as stuck and is retried). One write transaction, so two
 * callers never take the same save.
 */
export async function claimNextOp(): Promise<Op | null> {
  await ensureSchema();
  const t = now();
  const stmts: InStatement[] = [
    { sql: "update ops set status = 'pending', started_at = null where status = 'running' and started_at < ?", args: [t - 180_000] },
    {
      sql: `update ops set status = 'running', started_at = ?
            where id = (select id from ops where status = 'pending' order by id limit 1)
              and not exists (select 1 from ops where status = 'running')
            returning ${OP_COLS}`,
      args: [t],
    },
  ];
  const res = await db().batch(stmts, 'write');
  const row = res[1].rows[0];
  return row ? toOp(row) : null;
}

export async function finishOp(id: number, ok: boolean, error?: string) {
  await db().execute({ sql: 'update ops set status = ?, finished_at = ?, error = ? where id = ?', args: [ok ? 'done' : 'failed', now(), error || null, id] });
}

/** Puts a save back in the queue (the save queue's retry). */
export async function retryOp(id: number) {
  await db().execute({ sql: "update ops set status = 'pending', started_at = null, finished_at = null, error = null where id = ?", args: [id] });
}

export async function opStats(): Promise<{ pending: number; failed: number }> {
  await ensureSchema();
  const r = await db().execute({
    sql: "select sum(status in ('pending','running')) as pending, sum(status = 'failed' and created_at > ?) as failed from ops where status <> 'done'",
    args: [now() - 7 * 86_400_000],
  });
  const x = r.rows[0];
  return { pending: Number(x?.pending ?? 0), failed: Number(x?.failed ?? 0) };
}

/** Saves of this person that did not go through and that they have not closed yet. */
export async function failedOpsFor(by: string): Promise<Op[]> {
  await ensureSchema();
  const r = await db().execute({
    sql: `select ${OP_COLS} from ops where by_user = ? and status = 'failed' and dismissed = 0 and created_at > ? order by id`,
    args: [by, now() - 3 * 86_400_000],
  });
  return r.rows.map(toOp);
}

export async function dismissOp(id: number, by: string) {
  await db().execute({ sql: 'update ops set dismissed = 1 where id = ? and by_user = ?', args: [id, by] });
}

/**
 * A short lock held in the database (stage 3), so two clock pings never run the same job at once.
 * True when this caller got it; it ends by itself after ms.
 */
export async function tryLease(key: string, ms: number): Promise<boolean> {
  await ensureSchema();
  const t = now();
  const r = await db().execute({
    sql: `insert into kv (key, value, updated_at) values (?, ?, ?)
          on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at
          where coalesce(cast(kv.value as integer), 0) < ?
          returning key`,
    args: [key, String(t + ms), t, t],
  });
  return r.rows.length > 0;
}

export async function releaseLease(key: string) {
  await db().execute({ sql: "update kv set value = '0', updated_at = ? where key = ?", args: [now(), key] });
}
