"""Prospective staff-confirmed Find contact comparison. Local, private, append-only ledger."""
import argparse
import hashlib
import json
import math
import os
import re
import secrets
import sqlite3
import statistics
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

LIMIT = 20
ARMS = ('baseline', 'staff_confirmed')
HOLDS = ('contact', 'identity', 'eligibility', 'crm', 'relationship')
ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ROOT / 'outputs/j27-contact-pilot/study.sqlite'
BASELINE = '71481a3cd'
CANDIDATE = 'e4faa92d5'


def require(ok, message):
    if not ok:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def load(path):
    return json.loads(Path(path).read_text())


def connect(path):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE IF NOT EXISTS records(kind TEXT, id TEXT, data TEXT, PRIMARY KEY(kind,id))")
    db.execute("BEGIN IMMEDIATE")
    return db


def records(db, kind):
    return {r['id']: json.loads(r['data']) for r in db.execute(
        'SELECT id,data FROM records WHERE kind=? ORDER BY rowid', (kind,))}


def seal(db, kind, key, value):
    old = db.execute('SELECT data FROM records WHERE kind=? AND id=?', (kind, key)).fetchone()
    payload = canonical(value)
    if old:
        require(old[0] == payload, f'{kind} {key} was already sealed with different values')
    else:
        db.execute('INSERT INTO records VALUES(?,?,?)', (kind, key, payload))


def enroll(db, rows):
    # Input is the complete original-submission register as of export, including tests.
    seen, cohort = set(), []
    for row in rows:
        if row['cycle'] != 'J27' or row['program'] != 'Research' or row['opportunity'] != '001024':
            continue
        require(type(row['test']) is bool, 'Explicit test classification required')
        if row['test']:
            continue
        when = datetime.fromisoformat(row['original_submitted_at'].replace('Z', '+00:00'))
        require(when.utcoffset() is not None, 'Original submission time needs a timezone')
        cohort.append((when, int(row['request_number']), str(UUID(row['request_id'])), row))
    previous = list(records(db, 'proposal'))
    order = []
    for when, number, key, row in sorted(cohort, key=lambda item: item[:3]):
        if key in seen:
            continue
        seen.add(key)
        order.append(key)
        require(len(order) > len(previous) or previous[len(order)-1] == key, 'Original intake prefix changed')
        seal(db, 'proposal', key, dict(ordinal=len(order), request_number=number,
             submitted=when.astimezone(timezone.utc).isoformat()))
        if len(order) == LIMIT:
            break
    require(len(order) >= len(previous), 'Intake export omitted enrolled proposals')


def manifest(db, request_id, proposal_path):
    key = str(UUID(request_id))
    require(key in records(db, 'proposal'), 'Request is outside the cohort')
    # Stream the actual input once, before Find, without copying proposal text into the ledger.
    h = hashlib.sha256()
    with Path(proposal_path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    seal(db, 'manifest', key, h.hexdigest())


def freeze(db, frame, proposal_hash):
    key = str(UUID(frame['requestId']))
    require(key in records(db, 'proposal'), 'Request is outside the cohort')
    require(re.fullmatch('[0-9a-f]{64}', proposal_hash), 'Expected SHA-256 of proposal as received')
    require(records(db, 'manifest').get(key) == proposal_hash, 'Seal the original proposal with manifest before Find')
    if 'failure' in frame:
        require(isinstance(frame['failure'], str) and frame['failure'].strip() and 'analysisResult' not in frame,
                'Supply the first Find failure or the original list')
        suggestions = []
    else:
        suggestions = frame['analysisResult']['reviewerSuggestions']
    require(isinstance(suggestions, list), 'Original reviewerSuggestions must be an array')
    require(all(isinstance(r, dict) and str(r.get('name') or '').strip() for r in suggestions),
            'Missing suggestion name; retain and investigate the original frame')
    seal(db, 'freeze', key, dict(proposal_sha256=proposal_hash, suggestions=suggestions,
         list_sha256=digest(suggestions), failure=frame.get('failure')))
    known = records(db, 'slot')
    for i, suggestion in enumerate(suggestions, 1):
        slot = f'{key}/{i}'
        if slot not in known:
            seal(db, 'slot', slot, dict(name=suggestion['name'], institution=suggestion.get('suggestedInstitution'),
                 tokens={arm: secrets.token_hex(12) for arm in ARMS}))


def starting_template(db):
    starts = records(db, 'start')
    return [dict(slot=k, reviewer=v['name'], candidate_key='', before_email='', before=None,
                 roster_evidence_sha256='', missing_card_reason='')
            for k,v in records(db, 'slot').items() if k not in starts]


def starting_state(db, rows):
    slots = records(db, 'slot')
    for row in rows:
        key = row['slot']
        require(key in slots and row['reviewer'] == slots[key]['name'], 'Wrong frozen slot')
        require(isinstance(row['before_email'], str), 'Record starting mailbox')
        if row['before'] is not None:
            snapshot(row['before'])
        if row['candidate_key']:
            require(row['before'] is not None and re.fullmatch('[0-9a-f]{64}', row['roster_evidence_sha256']),
                    'Visible card needs its actual hold snapshot and preserved roster evidence hash')
        else:
            require(row['missing_card_reason'].strip(), 'Explain why the suggestion has no ordinary Find card')
        seal(db, 'start', key, row)


def form(db, role, a, b):
    require(a == a.strip() and b == b.strip() and a and b and a.casefold() != b.casefold(), 'Two different staff IDs required')
    seal(db, 'assignment', 'staff', [a,b])
    require(role in (a,b), 'Select one assigned staff ID')
    ps = records(db, 'proposal')
    result = []
    decisions = records(db, 'decision')
    starts = records(db, 'start')
    for slot, data in records(db, 'slot').items():
        request = slot.split('/')[0]
        arm = ARMS[((ps[request]['ordinal']-1) + (role == b)) % 2]
        if slot not in starts or slot+'/'+arm in decisions:
            continue
        start = starts[slot]
        result.append(dict(slot=slot, reviewer=data['name'], institution=data['institution'], arm=arm, staff=role,
            outcome='', before_email=start['before_email'], candidate_key=start['candidate_key'],
            staff_receipt=None, intercepted_unsafe=False, email='', evidence_url='', active_seconds='', before=start['before'], after_reload=None,
            reloaded_email='', reloaded_evidence_url='', notes=''))
    return result


def snapshot(value):
    require(isinstance(value, dict) and set(value) == set(HOLDS), 'Record all five hold categories')
    for reasons in value.values():
        require(isinstance(reasons, list) and all(isinstance(s,str) and s.strip() for s in reasons)
                and len(set(reasons)) == len(reasons), 'Each hold category needs a list of distinct reasons')


def decision(db, rows):
    staff = records(db, 'assignment')['staff']
    slots, proposals = records(db, 'slot'), records(db, 'proposal')
    for r in rows:
        slot, arm = r['slot'], r['arm']
        require(slot in slots and arm in ARMS, 'Unknown slot or arm')
        start = records(db, 'start').get(slot)
        require(start and all(start[k] == r[k] for k in ('before_email','before','candidate_key')),
                'Decision must use the shared starting-state snapshot')
        ordinal = proposals[slot.split('/')[0]]['ordinal']
        require(r['staff'] == staff[(ordinal-1+ARMS.index(arm)) % 2], 'Wrong staff assignment')
        require(r['outcome'] in ('ready','held','failed'), 'Choose ready, held or failed')
        require(type(r['intercepted_unsafe']) is bool, 'Record any intercepted unsafe clearance')
        require(isinstance(r['before_email'], str), 'Record starting mailbox or empty string')
        seconds = r['active_seconds']
        require(type(seconds) in (int,float) and math.isfinite(seconds) and seconds >= 0, 'Record measured active seconds')
        for field in ('before','after_reload'):
            if r[field] is not None:
                snapshot(r[field])
        if r['outcome'] != 'ready':
            require(not r['email'], 'Use the readback field for a held address')
        if r['outcome'] == 'ready':
            require(start['candidate_key'], 'No ready credit for a missing card')
            newly_ready = bool(r['before']['contact']) or r['before_email'].casefold() != r['email'].casefold()
            if arm == 'staff_confirmed' and newly_ready:
                receipt = r.get('staff_receipt') or {}
                require(receipt.get('requestId') == slot.split('/')[0] and
                        receipt.get('candidateKey') == start['candidate_key'] and
                        receipt.get('email','').casefold() == r['email'].casefold() and
                        receipt.get('evidenceUrl') == r['evidence_url'] and
                        str(receipt.get('actorProfileId') or '') == r['staff'] and receipt.get('attestedAt'),
                        'New clearance needs matching persisted staff contact-only receipt')
            require(re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', r['email']) and
                    r['evidence_url'].startswith('https://'), 'Ready requires exact mailbox and ownership source')
            require(r['before'] is not None and r['after_reload'] is not None and
                    r['reloaded_email'].casefold() == r['email'].casefold() and
                    r['reloaded_evidence_url'] == r['evidence_url'] and not r['after_reload']['contact'],
                    'Ready requires matching persisted readback and resolved contact hold')
        else:
            require(str(r.get('notes','')).strip(), 'Explain held or failed result')
        seal(db, 'decision', slot+'/'+arm, r)


def blind(db):
    decisions = records(db, 'decision')
    judges = records(db, 'judgment')
    out = []
    for slot, data in records(db, 'slot').items():
        if not all(slot+'/'+arm in decisions for arm in ARMS):
            continue
        for arm, token in data['tokens'].items():
            if token in judges:
                continue
            row = decisions[slot+'/'+arm]
            out.append(dict(token=token, request_id=slot.split('/')[0], reviewer=data['name'],
                suggested_institution=data['institution'], proposed_email=row['email'], adjudicator='',
                eligible=None, verdict='', current_source='', checked_on='', person_id='',
                evidence_sha256=''))
    return sorted(out, key=lambda v:v['token'])


def judge(db, rows):
    staff = {s.casefold() for s in records(db, 'assignment')['staff']}
    keys = {t for s in records(db, 'slot').values() for t in s['tokens'].values()}
    available = {r['token']: r for r in blind(db)} | records(db, 'judgment')
    for r in rows:
        require(r['token'] in keys and r['token'] in available, 'Both arms must be sealed before adjudication')
        original = available[r['token']]
        require(all(r[k] == original[k] for k in ('reviewer','request_id','proposed_email','suggested_institution')),
                'Blind item differs from the sealed pair')
        require(r['adjudicator'].strip() and r['adjudicator'].strip().casefold() not in staff, 'Independent adjudicator required')
        require((type(r['eligible']) is bool or r['eligible'] == 'unknown') and r['verdict'] in ('correct','wrong','unsubstantiated','no_clearance'),
                'Record eligibility and ownership verdict')
        require((r['person_id'].strip() or r['eligible'] == 'unknown') and r['current_source'].strip() and re.fullmatch('[0-9a-f]{64}',r['evidence_sha256']),
                'Record stable person ID, independent evidence and hash')
        datetime.strptime(r['checked_on'], '%Y-%m-%d')
        seal(db,'judgment',r['token'],r)


def report(db):
    ps, frozen, slots, decisions, judgments = [records(db,k) for k in ('proposal','freeze','slot','decision','judgment')]
    counts = dict(both=0, baseline_only=0, staff_confirmed_only=0, neither=0)
    safety, changes, missing, unresolved, people = [], [], [], [], set()
    per, times = {}, {a:[] for a in ARMS}
    all_seconds = {arm: 0 for arm in ARMS}
    unknown = []
    for key, data in slots.items():
        both = [decisions.get(key+'/'+arm) for arm in ARMS]
        def normalized_before(r):
            return {k: sorted(v) for k, v in r['before'].items()} if r['before'] is not None else None
        if all(both) and (normalized_before(both[0]) != normalized_before(both[1]) or
                          both[0]['before_email'].casefold() != both[1]['before_email'].casefold()):
            unresolved.append(key+' different starting evidence')
        pair, labels = [], []
        for arm in ARMS:
            id_ = key+'/'+arm
            r = decisions.get(id_)
            j = judgments.get(data['tokens'][arm])
            if r:
                all_seconds[arm] += r['active_seconds']
                if r['intercepted_unsafe']:
                    safety.append(id_+' intercepted unsafe clearance')
                if r['outcome'] != 'ready' and r['before_email'].casefold() != r['reloaded_email'].casefold():
                    safety.append(id_+' mailbox changed on non-ready decision')
                if r['before'] is None or r['after_reload'] is None:
                    missing.append(id_)
                else:
                    for category in HOLDS:
                        before, after = set(r['before'][category]), set(r['after_reload'][category])
                        if before != after:
                            changes.append(dict(slot=key, arm=arm, category=category, added=sorted(after-before),
                                                removed=sorted(before-after)))
                            if category != 'contact' or (before-after and r['outcome'] != 'ready'):
                                safety.append(id_+' inspect '+category+' change')
            if r and j:
                ready = r['outcome'] == 'ready'
                if ready and (j['verdict'] != 'correct' or j['eligible'] is not True):
                    safety.append(id_+' unsupported or ineligible clearance')
                if not ready and j['verdict'] != 'no_clearance':
                    unresolved.append(id_+' verdict conflicts with held outcome')
                labels.append((j['eligible'],j['person_id']))
                pair.append((ready and j['verdict']=='correct',r['active_seconds']))
        if len(pair) != 2:
            continue
        if labels[0] != labels[1]:
            unresolved.append(key+' reconcile eligibility/person')
            continue
        if labels[0][0] == 'unknown':
            unknown.append(key)
            continue
        if not labels[0][0]:
            continue
        people.add(labels[0][1])
        p = per.setdefault(key.split('/')[0],dict(eligible=0,net_correct=0,baseline_seconds=0,staff_confirmed_seconds=0))
        p['eligible'] += 1
        p['net_correct'] += int(pair[1][0])-int(pair[0][0])
        transition = {(False, False): 'neither', (True, False): 'baseline_only',
                      (False, True): 'staff_confirmed_only', (True, True): 'both'}
        counts[transition[pair[0][0], pair[1][0]]] += 1
        for arm, (_,seconds) in zip(ARMS,pair):
            times[arm].append(seconds)
            p[arm+'_seconds'] += seconds
    n=sum(counts.values())
    arm_counts = {a: sum(r['arm'] == a for r in decisions.values()) for a in ARMS}
    wrong = {a: sum(judgments.get(data['tokens'][a], {}).get('verdict') == 'wrong'
                    for data in slots.values()) for a in ARMS}
    complete = n > 0 and len(ps)==LIMIT and len(frozen)==LIMIT and len(judgments)==2*len(slots) and not (missing or unresolved)
    return dict(automatic_clearance=False, proposals=len(ps), target=LIMIT, awaiting_first_find=len(ps)-len(frozen),
        failed_find=[k for k,v in frozen.items() if v['failure']], empty_find=[k for k,v in frozen.items() if not v['failure'] and not v['suggestions']],
        frozen_slots=len(slots), awaiting_starting_state=len(slots)-len(records(db,'start')), decisions_recorded=arm_counts, wrong_recipients=wrong, decisions_pending=2*len(slots)-len(decisions), judgments_pending=2*len(slots)-len(judgments),
        paired_eligible_slots=n, distinct_eligible_people=len(people), correct_contact_pairs=counts,
        net_correct_gain_percentage_points=100*(counts['staff_confirmed_only']-counts['baseline_only'])/n if n else None,
        mean_active_minutes={a:statistics.mean(v)/60 if v else None for a,v in times.items()},
        median_active_minutes={a:statistics.median(v)/60 if v else None for a,v in times.items()},
        active_time_reduction_pct=100*(1-sum(times[ARMS[1]])/sum(times[ARMS[0]])) if sum(times[ARMS[0]]) else None,
        all_recorded_active_minutes={a:s/60 for a,s in all_seconds.items()}, unknown_eligibility=unknown,
        per_proposal=per,hold_changes=changes,unknown_hold_readbacks=missing,safety_review=safety,
        reconciliation_needed=unresolved, measurement_complete=bool(complete),pause_for_review=bool(safety or missing or unresolved))


def main():
    os.umask(0o077)
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--db', type=Path, default=DEFAULT)
    sub=cli.add_subparsers(dest='action',required=True)
    for name in ('init','enroll','enrollment-ids','manifest','freeze','starting-template','starting-state','worksheet','decisions','blind','judgments','report'):
        cmd=sub.add_parser(name)
        if name in ('enroll','freeze','starting-state','decisions','judgments'):
            cmd.add_argument('input')
        if name=='manifest':
            cmd.add_argument('request_id'); cmd.add_argument('proposal_file')
        if name=='freeze':
            cmd.add_argument('proposal_sha256')
        if name=='worksheet':
            cmd.add_argument('staff'); cmd.add_argument('staff_a'); cmd.add_argument('staff_b')
    args=cli.parse_args()
    with connect(args.db) as db:
        seal(db,'protocol','v1',dict(baseline=BASELINE,candidate=CANDIDATE,limit=LIMIT,automatic_clearance=False))
        a=args.action
        if a=='enroll': enroll(db,load(args.input))
        if a=='manifest': manifest(db,args.request_id,args.proposal_file)
        if a=='freeze': freeze(db,load(args.input),args.proposal_sha256)
        if a=='starting-state': starting_state(db,load(args.input))
        if a=='decisions': decision(db,load(args.input))
        if a=='judgments': judge(db,load(args.input))
        if a == 'enrollment-ids':
            print(','.join(records(db, 'proposal')))
            return
        if a == 'worksheet':
            out = form(db, args.staff, args.staff_a, args.staff_b)
        elif a == 'blind':
            out = blind(db)
        elif a == 'starting-template':
            out = starting_template(db)
        else:
            out = report(db)
    print(json.dumps(out,indent=2))


if __name__=='__main__':
    main()
