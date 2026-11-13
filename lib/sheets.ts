import 'server-only';
import { googleToken } from '@/lib/google';
import { upsertRows } from '@/lib/db';

/**
 * The Recruitment Pipeline sheet through the Sheets API (stage 3): the CRM writes its results there itself, so the
 * sheet stays a full copy while the engine moves into the CRM.
 */
export const PIPELINE_SHEET_ID = '11CpfMQhC97DCqFQhZuBL73XCUw8H3zrb_FAKW7vcv8o';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/${path}`, { ...init, headers: { Authorization: `Bearer ${await googleToken()}`, 'Content-Type': 'application/json' }, cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Google Sheets: ' + ((j as { error?: { message?: string } }).error?.message || res.status));
  return j as T;
}

const q = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
export function colLetter(n: number) { // 1 → A
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

const headers = new Map<string, { at: number; cols: string[] }>();
/** Row 1 of a tab (kept 10 minutes). */
export async function tabHeaders(tab: string, sheetId = PIPELINE_SHEET_ID): Promise<string[]> {
  const k = sheetId + '|' + tab;
  const c = headers.get(k);
  if (c && c.at > Date.now() - 600_000) return c.cols;
  const r = await api<{ values?: string[][] }>(`${sheetId}/values/${encodeURIComponent(q(tab) + '!1:1')}`);
  const cols = (r.values?.[0] || []).map((x) => String(x).trim());
  headers.set(k, { at: Date.now(), cols });
  return cols;
}

/** The values of one row, by column name (as the sheet shows them). */
export async function readRow(tab: string, row: number, sheetId = PIPELINE_SHEET_ID): Promise<Record<string, string>> {
  const cols = await tabHeaders(tab, sheetId);
  const r = await api<{ values?: string[][] }>(`${sheetId}/values/${encodeURIComponent(`${q(tab)}!A${row}:${colLetter(cols.length)}${row}`)}`);
  const v = r.values?.[0] || [];
  return Object.fromEntries(cols.map((h, i) => [h, String(v[i] ?? '')]));
}

/** Writes the given fields of one row (only those cells). */
export async function writeCells(tab: string, row: number, fields: Record<string, string | number>, sheetId = PIPELINE_SHEET_ID) {
  const cols = await tabHeaders(tab, sheetId);
  const data = Object.entries(fields).map(([k, v]) => {
    const i = cols.indexOf(k);
    if (i === -1) throw new Error(`Missing column "${k}" in ${tab}`);
    return { range: `${q(tab)}!${colLetter(i + 1)}${row}`, values: [[v]] };
  });
  await api(`${sheetId}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
}

/** Column A of a tab in another spreadsheet (e.g. the form sheet's Rejected tab). */
export async function readColumnA(sheetId: string, tab: string): Promise<string[]> {
  const r = await api<{ values?: string[][] }>(`${sheetId}/values/${encodeURIComponent(q(tab) + '!A:A')}`);
  return (r.values || []).map((x) => String(x[0] ?? ''));
}

/** Adds one row at the end of a tab; returns its row number. */
export async function appendRow(tab: string, fields: Record<string, string | number>, sheetId = PIPELINE_SHEET_ID): Promise<number> {
  const cols = await tabHeaders(tab, sheetId);
  const r = await api<{ updates?: { updatedRange?: string } }>(
    `${sheetId}/values/${encodeURIComponent(q(tab) + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [cols.map((h) => fields[h] ?? '')] }) }
  );
  const m = /![A-Z]+(\d+)/.exec(r.updates?.updatedRange || '');
  return m ? Number(m[1]) : 0;
}

/** Sets one Settings value in the sheet (adds the row if it is missing). */
export async function setSheetSetting(key: string, value: string) {
  const r = await api<{ values?: string[][] }>(`${PIPELINE_SHEET_ID}/values/${encodeURIComponent("'Settings'!A:A")}`);
  const i = (r.values || []).findIndex((x) => String(x[0] ?? '').trim() === key);
  const row = i > 0 ? i + 1 : await appendRow('Settings', { Key: key, Value: value });
  if (i > 0) await writeCells('Settings', row, { Value: value });
  // the database copy too, so the Database page's counts match at once
  if (row > 1) await upsertRows('Settings', [{ row, data: { Key: key, Value: value } }]);
}

/** Adds a column to row 1 of a tab when it is missing (widening the grid if needed). */
export async function ensureColumn(tab: string, name: string, sheetId = PIPELINE_SHEET_ID) {
  headers.delete(sheetId + '|' + tab);
  const cols = await tabHeaders(tab, sheetId);
  if (cols.includes(name)) return;
  const meta = await api<{ sheets: { properties: { sheetId: number; title: string; gridProperties: { columnCount: number } } }[] }>(`${sheetId}?fields=sheets.properties`);
  const sh = meta.sheets.find((x) => x.properties.title === tab);
  if (!sh) throw new Error(`No tab "${tab}"`);
  if (sh.properties.gridProperties.columnCount <= cols.length) {
    await api(`${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ appendDimension: { sheetId: sh.properties.sheetId, dimension: 'COLUMNS', length: 1 } }] }) });
  }
  await api(`${sheetId}/values/${encodeURIComponent(`${q(tab)}!${colLetter(cols.length + 1)}1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [[name]] }) });
  headers.delete(sheetId + '|' + tab);
}
