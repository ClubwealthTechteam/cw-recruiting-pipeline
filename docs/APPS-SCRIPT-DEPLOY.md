# Automatic Apps Script deploy

After a merge to `main` that changes `apps-script/`, GitHub Actions (`.github/workflows/deploy-apps-script.yml`)
uploads Code.gs and Logic.gs to the **Recruitment Pipeline** Apps Script project and points the **existing** web app
deployment at the new version. No manual paste.

## What it can touch (guardrails)
`scripts/deploy-apps-script.mjs` checks all of this first and stops, changing nothing, if any check fails:
- the project id is the `SCRIPT_ID` secret **and** its title is exactly "Recruitment Pipeline";
- the live project holds exactly `appsscript`, `Code`, `Logic` (no other file can be overwritten or removed);
- the live Code.gs is the pipeline engine (its header line);
- `DEPLOYMENT_ID` is an existing web app deployment of that project. Deployments are never created or deleted;
- `appsscript.json` (scopes, web app access) is replaced only when the merge changed it; otherwise the live one is kept;
- the tests (`npm test`) pass.
After uploading it reads the files back and checks they match.

## One-time setup
1. Turn on the Apps Script API: https://script.google.com/home/usersettings (signed in as the script owner).
2. Apps Script → Project Settings → IDs → copy the **Script ID**.
3. Apps Script → Deploy → Manage deployments → the active web app → copy the **Deployment ID**.
4. On a computer with Node: `npx @google/clasp@2.4.2 login`, sign in as the script owner. It writes `~/.clasprc.json`.
5. GitHub → this repo → Settings → Secrets and variables → Actions → New repository secret, three times:
   `CLASPRC_JSON` (the whole content of `~/.clasprc.json`), `SCRIPT_ID`, `DEPLOYMENT_ID`.
6. GitHub → Actions → Deploy Apps Script → Run workflow (dry run ticked): it runs every check and writes nothing.

## Notes
- The sign-in in `CLASPRC_JSON` belongs to the Google account used in step 4; GitHub never shows secrets, also not in
  this public repo, and workflows from forks do not get them. If it expires or the password changes, repeat step 4–5.
- To stop automatic deploys, delete the `CLASPRC_JSON` secret (runs then stop at the first check).
