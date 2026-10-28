"""Turns the live Zoom snapshot into Zoom Attendance writes.
Usage: python3 -I zoom_live_sync.py SHEET_VALUES.json SNAPSHOT.json
SHEET_VALUES.json: the get_values result of 'Zoom Attendance'!A1:M (header first).
Prints JSON: {"blocks": [{"range": ..., "values": ...}], "append": [[...row A:M...]]}
Existing rows keep Matched Applicant ID and Result (set by the Apps Script); only F:I and L:M are rewritten."""
import json, sys, datetime as dt
from zoneinfo import ZoneInfo
sheet = json.load(open(sys.argv[1]))
snap = json.load(open(sys.argv[2]))
vals = sheet.get('values', sheet)
hdr, rows = vals[0], vals[1:]
col = {h: i for i, h in enumerate(hdr)}
key = lambda name: ' '.join(str(name).lower().split())
skip = lambda r: key(r['Parsed Name']) == 'miguel' or r['Zoom Display Name'].strip().lower() == 'miguel_test position'
now = dt.datetime.now(ZoneInfo('America/Los_Angeles')).strftime('%Y-%m-%d %H:%M:%S')
rows = [r + [''] * (len(hdr) - len(r)) for r in rows]
existing = {}
for i, r in enumerate(rows):
    if str(r[col['Interview Date']])[:10] == snap['date'] and key(r[col['Parsed Name']]) != 'miguel':
        existing[key(r[col['Parsed Name']])] = i + 2  # sheet row
blocks, append, changed = [], [], False
for r in snap['rows']:
    if skip(r):
        continue
    fi = [r['Total Minutes'], r['First Join'], r['Last Leave'], r['Segments']]
    lm = [r['Minutes Early'], r['Arrival']]
    n = existing.get(key(r['Parsed Name']))
    if n:
        rows[n - 2][col['Total Minutes']:col['Segments'] + 1] = fi
        rows[n - 2][col['Minutes Early']:col['Arrival'] + 1] = lm
        changed = True
    else:
        append.append([r['Interview Date'], r['Zoom Display Name'], r['Parsed Name'], r['Parsed Position'], '', *fi, '', now, *lm])
if changed:  # two writes for the whole tab: columns F:I and L:M, every other row unchanged
    last = len(rows) + 1
    blocks.append({'range': f"'Zoom Attendance'!F2:I{last}", 'values': [r[col['Total Minutes']:col['Segments'] + 1] for r in rows]})
    blocks.append({'range': f"'Zoom Attendance'!L2:M{last}", 'values': [r[col['Minutes Early']:col['Arrival'] + 1] for r in rows]})
print(json.dumps({'blocks': blocks, 'append': append}))
