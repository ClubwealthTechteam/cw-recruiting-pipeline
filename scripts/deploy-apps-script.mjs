#!/usr/bin/env node
/**
 * Deploys apps-script/Code.gs, Logic.gs (and appsscript.json only when it changed) to the ONE Apps Script project
 * "Recruitment Pipeline", then points the EXISTING web app deployment at the new version (Miguel, 2026-11-05).
 *
 * Guardrails, all checked before anything is written (any failure stops the run and changes nothing):
 *   1. the project id is SCRIPT_ID and its title is exactly "Recruitment Pipeline";
 *   2. the live project holds exactly appsscript, Code and Logic (so nothing else could be overwritten or removed);
 *   3. the live Code.gs is ours (starts with the Recruiting Pipeline header);
 *   4. DEPLOYMENT_ID is an existing web app deployment of this project; no deployment is ever created or deleted;
 *   5. the manifest (appsscript.json: scopes, web app access) is only replaced when this push changed it;
 *      otherwise the live manifest is kept as it is.
 * DRY_RUN=1 runs every check and prints what would change, without writing.
 *
 * Env: CLASPRC_JSON (contents of ~/.clasprc.json from `clasp login`), SCRIPT_ID, DEPLOYMENT_ID,
 *      MANIFEST_CHANGED=1|0, DRY_RUN=1|0, GIT_SHA (for the version description).
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const EXPECTED_TITLE = 'Recruitment Pipeline';
const EXPECTED_FILES = ['appsscript', 'Code', 'Logic'];
const CODE_MARKER = 'Recruiting Pipeline engine for the "RECRUITMENT PIPELINE BASE" spreadsheet';
const API = 'https://script.googleapis.com/v1/projects';

const env = (k) => { const v = (process.env[k] || '').trim(); if (!v) fail(`${k} is not set (GitHub secret missing?)`); return v; };
function fail(msg) { console.error(`STOPPED, nothing was changed: ${msg}`); process.exit(1); }
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** A fresh access token from the refresh token in .clasprc.json (clasp 2.x and 3.x formats). */
async function accessToken() {
  let c;
  try { c = JSON.parse(env('CLASPRC_JSON')); } catch { fail('CLASPRC_JSON is not valid JSON'); }
  const t3 = c.tokens && (c.tokens.default || Object.values(c.tokens)[0]);
  const creds = t3
    ? { client_id: t3.client_id, client_secret: t3.client_secret, refresh_token: t3.refresh_token }
    : { client_id: c.oauth2ClientSettings?.clientId, client_secret: c.oauth2ClientSettings?.clientSecret, refresh_token: c.token?.refresh_token };
  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) fail('CLASPRC_JSON has no refresh token; run `npx @google/clasp login` again');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...creds, grant_type: 'refresh_token' })
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) fail(`Google sign-in failed (${j.error || r.status}); run clasp login again and update CLASPRC_JSON`);
  return j.access_token;
}

async function call(tok, method, url, body) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) fail(`${method} ${url.replace(API, '')} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const scriptId = env('SCRIPT_ID');
const deploymentId = env('DEPLOYMENT_ID');
const dryRun = process.env.DRY_RUN === '1';
const manifestChanged = process.env.MANIFEST_CHANGED === '1';
const local = {
  Code: readFileSync('apps-script/Code.gs', 'utf8'),
  Logic: readFileSync('apps-script/Logic.gs', 'utf8'),
  appsscript: readFileSync('apps-script/appsscript.json', 'utf8')
};
if (!local.Code.includes(CODE_MARKER)) fail('apps-script/Code.gs in the repo does not look like the pipeline engine');

const tok = await accessToken();

// 1. right project
const project = await call(tok, 'GET', `${API}/${scriptId}`);
if (project.title !== EXPECTED_TITLE) fail(`project ${scriptId} is "${project.title}", not "${EXPECTED_TITLE}"`);

// 2 + 3. exactly our three files, and the live Code.gs is ours
const live = await call(tok, 'GET', `${API}/${scriptId}/content`);
const names = (live.files || []).map((f) => f.name).sort();
if (JSON.stringify(names) !== JSON.stringify([...EXPECTED_FILES].sort())) fail(`the project holds ${names.join(', ')}; expected exactly ${EXPECTED_FILES.join(', ')}`);
const liveByName = Object.fromEntries(live.files.map((f) => [f.name, f]));
if (!String(liveByName.Code.source || '').includes(CODE_MARKER)) fail('the live Code.gs does not look like the pipeline engine');

// 4. the existing web app deployment of this project
const dep = await call(tok, 'GET', `${API}/${scriptId}/deployments/${deploymentId}`);
if (dep.deploymentConfig?.scriptId !== scriptId) fail('DEPLOYMENT_ID belongs to another project');
if (!(dep.entryPoints || []).some((e) => e.entryPointType === 'WEB_APP')) fail('DEPLOYMENT_ID is not a web app deployment');

// 5. manifest: replaced only when this push changed appsscript.json
const manifest = manifestChanged ? local.appsscript : liveByName.appsscript.source;
const files = [
  { name: 'appsscript', type: 'JSON', source: manifest },
  { name: 'Code', type: 'SERVER_JS', source: local.Code },
  { name: 'Logic', type: 'SERVER_JS', source: local.Logic }
];
for (const f of files) {
  const before = liveByName[f.name].source || '';
  console.log(`${f.name}: ${before === f.source ? 'unchanged' : `${sha(before)} -> ${sha(f.source)}`}`);
}
console.log(`deployment ${deploymentId.slice(0, 10)}…: now version ${dep.deploymentConfig?.versionNumber ?? '(head)'}`);
if (dryRun) { console.log('DRY RUN: all checks passed; nothing was written.'); process.exit(0); }

await call(tok, 'PUT', `${API}/${scriptId}/content`, { files });
const desc = `Auto-deploy ${String(process.env.GIT_SHA || '').slice(0, 7)} (GitHub main)`;
const ver = await call(tok, 'POST', `${API}/${scriptId}/versions`, { description: desc });
await call(tok, 'PUT', `${API}/${scriptId}/deployments/${deploymentId}`, {
  deploymentConfig: { scriptId, versionNumber: ver.versionNumber, manifestFileName: 'appsscript', description: desc }
});

// read back: the live files match what was sent
const after = await call(tok, 'GET', `${API}/${scriptId}/content`);
for (const f of files) {
  const got = after.files.find((x) => x.name === f.name)?.source || '';
  if (got !== f.source) fail(`read-back of ${f.name} does not match (the upload may be partial; check Apps Script)`);
}
console.log(`Deployed version ${ver.versionNumber} to the existing web app deployment. Read-back matches.`);
