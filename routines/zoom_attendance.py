#!/usr/bin/env python3
"""
Wednesday Zoom attendance for the Club Wealth Help Desk meeting (read-only).

Polls Zoom's live participant list every few minutes until the end time, keeps every
join/leave segment it sees, and writes one row per strict "Name_Position" participant
with their total minutes inside the interview window (overlapping segments are merged,
rejoin segments add up). "_Training" names never count.

Also records arrival: minutes before (early) or after (late) the interview start. The invite asks applicants to
join 10 minutes early, so "On time" means 10+ minutes early.

Usage: python3 zoom_attendance.py --out /path/zoom.json [--interview 14:00] [--start 13:45] [--end 15:30] [--interval 180] [--once]
Needs ZOOM_ACCOUNT_ID. The proxy authenticates the token request; the token is never printed.
"""
import argparse, datetime as dt, json, os, re, sys, time, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

PT = ZoneInfo('America/Los_Angeles')
MEETING_ID = '99195738734'


def token():
    url = 'https://zoom.us/oauth/token?' + urllib.parse.urlencode({
        'grant_type': 'account_credentials', 'account_id': os.environ['ZOOM_ACCOUNT_ID']})
    with urllib.request.urlopen(urllib.request.Request(url, method='POST'), timeout=30) as r:
        return json.load(r)['access_token']


def live_participants(tok):
    out, page = [], ''
    while True:
        q = {'type': 'live', 'page_size': 300}
        if page:
            q['next_page_token'] = page
        req = urllib.request.Request(
            f'https://api.zoom.us/v2/metrics/meetings/{MEETING_ID}/participants?' + urllib.parse.urlencode(q),
            headers={'Authorization': 'Bearer ' + tok})
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.load(r)
        out += d.get('participants', [])
        page = d.get('next_page_token') or ''
        if not page:
            return out


def parse_name(display):
    """Strict Name_Position: exactly one underscore, both sides non-empty, not _Training."""
    parts = (display or '').strip().split('_')
    if len(parts) != 2:
        return None
    name, pos = parts[0].strip(), parts[1].strip()
    if not name or not pos or re.match(r'(?i)^training\b', pos):
        return None
    return name, pos


def ts(s):
    return dt.datetime.fromisoformat(s.replace('Z', '+00:00')) if s else None


def merge_minutes(segments, lo, hi):
    iv = sorted((max(a, lo), min(b, hi)) for a, b in segments if min(b, hi) > max(a, lo))
    total, cur = 0.0, None
    for a, b in iv:
        if cur and a <= cur[1]:
            cur[1] = max(cur[1], b)
        else:
            if cur:
                total += (cur[1] - cur[0]).total_seconds()
            cur = [a, b]
    if cur:
        total += (cur[1] - cur[0]).total_seconds()
    return total / 60


EARLY_REQUIRED = 10  # the invite: "Kindly join 10 minutes before the call"


def arrival(first_join, start):
    """(minutes early as a signed number, plain-language label). Negative minutes = late."""
    early = round((start - first_join).total_seconds() / 60)
    if early >= EARLY_REQUIRED:
        return early, f'{early} min early (on time)'
    if early > 0:
        return early, f'{early} min early ({EARLY_REQUIRED - early} min short of the 10 min asked)'
    if early == 0:
        return 0, 'Joined at the start time (10 min late for the 10-min-early rule)'
    return early, f'{-early} min late'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--interview', default='14:00', help='interview start (PT), for early/late')
    ap.add_argument('--start', default='13:45')
    ap.add_argument('--end', default='15:30')
    ap.add_argument('--interval', type=int, default=180)
    ap.add_argument('--once', action='store_true', help='single poll (for a read-only test)')
    ap.add_argument('--post', action='store_true', help='also send rows to the Apps Script API (backup path)')
    a = ap.parse_args()

    today = dt.datetime.now(PT).date()
    at = lambda hm: dt.datetime.combine(today, dt.time(*map(int, hm.split(':'))), PT)
    lo, hi, start = at(a.start), at(a.end), at(a.interview)
    seen = {}  # (participant key, join_time) -> record
    names = {}  # participant uuid -> every display name seen across polls (people rename after joining)
    polls = errors = 0
    while True:
        try:
            for p in live_participants(token()):
                key = (p.get('participant_user_id') or p.get('id') or p.get('user_name'), p.get('join_time'))
                seen[key] = p
                pid = p.get('participant_uuid') or p.get('participant_user_id') or p.get('id')
                if pid:
                    names.setdefault(pid, set()).add(p.get('user_name') or '')
            polls += 1
        except Exception as e:  # keep polling; report at the end
            errors += 1
            print(f'poll error: {type(e).__name__}', file=sys.stderr)
        now = dt.datetime.now(PT)
        if a.once or now >= hi:
            break
        time.sleep(max(30, min(a.interval, (hi - now).total_seconds())))

    end = min(dt.datetime.now(PT), hi)
    people = {}
    for p in seen.values():
        pid = p.get('participant_uuid') or p.get('participant_user_id') or p.get('id')
        candidates = [p.get('user_name')] + sorted(names.get(pid, set()))
        display = next((n for n in candidates if parse_name(n)), None)
        parsed = parse_name(display)
        j = ts(p.get('join_time'))
        if not parsed or not j:
            continue
        l = ts(p.get('leave_time')) or end
        k = re.sub(r'\s+', ' ', parsed[0]).lower()
        e = people.setdefault(k, {'display': display.strip(), 'name': parsed[0], 'position': parsed[1], 'segments': []})
        e['segments'].append((j.astimezone(PT), l.astimezone(PT)))

    rows = []
    for e in people.values():
        mins = merge_minutes(e['segments'], lo, end)
        if mins <= 0:
            continue
        segs = sorted(e['segments'])
        # arrival = first join that reaches into the interview window (ignores earlier, unrelated visits that day)
        inside = [sg for sg in segs if sg[1] > lo]
        early, label = arrival(inside[0][0], start)
        rows.append({
            'Interview Date': today.isoformat(), 'Zoom Display Name': e['display'], 'Parsed Name': e['name'],
            'Parsed Position': e['position'], 'Total Minutes': round(mins, 1),
            'First Join': inside[0][0].strftime('%H:%M'), 'Last Leave': max(s[1] for s in segs).strftime('%H:%M'),
            'Segments': len(segs), 'Minutes Early': early, 'Arrival': label
        })
    json.dump({'date': today.isoformat(), 'polls': polls, 'errors': errors, 'records_seen': len(seen), 'rows': rows},
              open(a.out, 'w'), indent=1)
    if a.post:
        # Backup when the routine has no Sheets connector: send rows to the pipeline's Apps Script API.
        url, secret = os.environ.get('APPS_SCRIPT_URL'), os.environ.get('APPS_SCRIPT_SECRET')
        if not url or not secret:
            print('post skipped: APPS_SCRIPT_URL / APPS_SCRIPT_SECRET not set')
        else:
            body = json.dumps({'secret': secret, 'action': 'zoomRows', 'rows': rows, 'finalize': today.isoformat()}).encode()
            with urllib.request.urlopen(urllib.request.Request(url, data=body, headers={'Content-Type': 'text/plain'}), timeout=60) as r:
                res = json.load(r)
            print('posted to pipeline:', 'ok' if res.get('ok') else 'error ' + str(res.get('error')))
    print(f'done: {polls} polls, {errors} errors, {len(seen)} records, {len(rows)} Name_Position participants -> {a.out}')


if __name__ == '__main__':
    main()
