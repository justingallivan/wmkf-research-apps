/**
 * apply-research-copi-stage-b.mjs — Stage B apply of the Research Institution
 * at Award backfill: co-PI rows on awarded Research requests.
 * Plan: docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md §3.2–3.4.
 * Owner-run only. Mode shape follows backfill-research-pi-institution-at-award.mjs
 * (Stage A); row selection and payloads live in scripts/lib/research-copi-apply.mjs
 * (unit-tested).
 *
 * Inputs (all in --dir, the stage-b-2 owner folder; they hold names, keep them out of git):
 *   research-copi-iaa-resolve.jsonl    frozen resolve snapshot (--resolve-hash must match)
 *   research-copi-iaa-review.xlsx      names and proposal emails for that run
 *   research-copi-confirm-v3.xlsx      owner group approvals, exclusions, check answers
 *   research-copi-decisions.csv        staff answers + owner decisions as account GUIDs
 *   research-copi-current-emails.csv   chosen email per new contact (lookup)
 *
 * Modes:
 *   --plan --resolve-hash=<8 chars>   READ-ONLY in Dataverse. Overlays approvals and
 *       decisions on the snapshot, resolves the staff "same person" contacts by
 *       exact email, re-checks every new contact's final email against existing
 *       contacts, finds existing co-PI rows, and writes research-copi-apply-plan.jsonl
 *       (the apply input, also kept as research-copi-apply-plan-<hash>.jsonl) and
 *       research-copi-apply-plan.csv (owner dry run), then prints counts and the plan
 *       hash. Refuses to run once research-copi-applied.jsonl records any activity;
 *       verify and rollback load the plan that log names.
 *   --apply --confirm=<plan hash> --approver="<name>" [--first=N]
 *       Runs the plan's operations in order (per-operation logic: makeApplier in the
 *       lib). Creates use plan-minted GUIDs; every write re-reads its target first,
 *       patches only empty values with If-Match on that same read, and logs
 *       intent/result lines to research-copi-applied.jsonl. A junction row whose new
 *       contact is not created yet is `blocked` and retried on the next run, like
 *       `failed`. After an interrupted or failed write, a target found in exactly the
 *       planned state is `recovered`; one edited since is `recovered_modified`.
 *   --verify  READ-ONLY. Re-reads every applied write and lists unresolved planned
 *       operations, recovered writes and records edited since creation.
 *   --rollback --ids=<file of ids | all> [--include-recovered]
 *       Reverses only this script's writes that are unchanged since (ETag): junction
 *       rows are deleted before contacts; a created contact is deleted only when no
 *       junction row or potential-reviewer row references it; set values are cleared;
 *       Ross's contact update is restored. `recovered` writes need --include-recovered
 *       (an edit between the write and its recovery cannot be ruled out);
 *       `recovered_modified` is never reversed automatically.
 * Write modes need DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD>"; every mode that
 * reaches production needs DATAVERSE_ALLOW_PROD_READS=yes.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { lc } from './lib/research-iaa-backfill.mjs';
import { groupNewContacts } from './lib/research-copi-stage-b.mjs';
import {
  GUID, ROLE_COPI, parseDecision, selectLine, contactCreatePayload, junctionCreatePayload, foldLedger, applyDone, rollbackEligible,
  makeApplier, runOperations, planOverwriteBlocked, ledgerPlanHash, recordedRowMismatch, JUNCTION, REQUEST_SELECT, ROW_SELECT, CONTACT_SELECT, SET_TARGETS,
} from './lib/research-copi-apply.mjs';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const flag = (name) => process.argv.includes(`--${name}`);
const MODE = flag('apply') ? 'apply' : flag('verify') ? 'verify' : flag('rollback') ? 'rollback' : flag('plan') ? 'plan' : null;
const DIR = arg('dir');
if (!MODE || !DIR) { console.error('Usage: --plan|--apply|--verify|--rollback --dir=<stage-b-2 folder>'); process.exit(2); }
const dirAbs = path.resolve(DIR);
if (dirAbs.startsWith(`${path.resolve('.')}${path.sep}`)) { console.error('--dir must be outside the repository (the files hold names).'); process.exit(2); }
const F = (name) => path.join(dirAbs, name);
const PLAN = F('research-copi-apply-plan.jsonl');
const PLAN_CSV = F('research-copi-apply-plan.csv');
const APPLIED = F('research-copi-applied.jsonl');
if ((MODE === 'apply' || MODE === 'rollback') && !process.env.DATAVERSE_PROD_WRITE_ACK) {
  console.error(`Write mode needs DATAVERSE_PROD_WRITE_ACK, e.g. DATAVERSE_PROD_WRITE_ACK="research co-PI stage B ${new Date().toISOString().slice(0, 10)}"`);
  process.exit(2);
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { fetchWithTimeout, buildHeaders } = await import('../lib/services/dynamics/http.js');
const { escape } = await import('../lib/dataverse/core/odata.js');

const OIST_FOUNDATION = '00c4fa37-3fea-f011-8544-6045bd0510d4';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
const host = (() => { try { return new URL(process.env.DYNAMICS_URL).host; } catch { return ''; } })();
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const append = (f, obj) => fs.appendFileSync(f, `${JSON.stringify(obj)}\n`);
const guid = (v, what) => { const s = lc(v); if (!GUID.test(s || '')) throw new Error(`${what} is not a GUID: ${v}`); return s; };

async function readAll(entitySet, options) {
  const result = await DynamicsService.queryAllRecords(entitySet, options);
  if (result.capped) throw new Error(`${entitySet} read hit the 5,000-row cap`);
  return result.records;
}
async function getOrNull(entitySet, id, select) {
  try { return await DynamicsService.getRecord(entitySet, id, { select }); }
  catch (err) { if (err?.status === 404) return null; throw err; }
}
const activeContactsWithEmail = (email) => readAll('contacts', {
  select: CONTACT_SELECT,
  filter: `statecode eq 0 and (${['emailaddress1', 'emailaddress2', 'emailaddress3'].map((f) => `${f} eq '${escape(email)}'`).join(' or ')})`,
});
const rowsForRequest = (requestId) => readAll(JUNCTION, { select: ROW_SELECT, filter: `_wmkf_request_value eq ${guid(requestId, 'requestId')}` });

// ── File inputs ──
const cellText = (v) => (v && typeof v === 'object' ? (v.richText ? v.richText.map((x) => x.text).join('') : v.text || v.hyperlink || v.result || '') : v ?? '');
async function sheets(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb.worksheets.map((ws) => {
    const head = ws.getRow(1).values.map(cellText);
    const rows = [];
    ws.eachRow((r, i) => { if (i === 1) return; const o = {}; head.forEach((h, k) => { if (h) o[h] = String(cellText(r.getCell(k).value)).trim(); }); rows.push(o); });
    return { name: ws.name, rows };
  });
}
function readCsv(file) {
  const [head, ...lines] = fs.readFileSync(file, 'utf8').trim().split('\n');
  const split = (l) => [...l.matchAll(/("((?:[^"]|"")*)"|[^,]*)(,|$)/g)].slice(0, -1).map((m) => (m[2] !== undefined ? m[2].replace(/""/g, '"') : m[1]));
  const cols = split(head);
  return lines.map((l) => { const v = split(l); return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ''])); });
}

// ── Plan ──
async function runPlan() {
  if (planOverwriteBlocked(readJsonl(APPLIED))) {
    console.error(`${APPLIED} already records apply activity for the current plan; re-planning would drop those writes from verify and rollback. Finish (or roll back) that plan, then move the plan and log aside before planning again.`);
    process.exit(2);
  }
  const resolveText = fs.readFileSync(F('research-copi-iaa-resolve.jsonl'), 'utf8');
  const resolveHash = sha(resolveText).slice(0, 8);
  if (arg('resolve-hash') !== resolveHash) { console.error(`--resolve-hash must equal ${resolveHash}`); process.exit(2); }
  const lines = resolveText.trim().split('\n').map((l) => JSON.parse(l)).filter((x) => !x.meta);
  if (lines.some((x) => x.host !== host)) { console.error('Resolve file is from another host.'); process.exit(2); }

  const review = new Map((await sheets(F('research-copi-iaa-review.xlsx')))[0].rows.map((r) => [r.key, r]));
  const [groupsSheet, checksSheet, membersSheet] = await sheets(F('research-copi-confirm-v3.xlsx'));
  const approvedGroups = new Set(groupsSheet.rows.filter((r) => r['Approve?'] === 'Yes').map((r) => r.key.replace(/^group\|/, '')));
  const excluded = new Set(membersSheet.rows.filter((r) => r['Exclude?'] === 'Yes').map((r) => r.key));
  const checks = new Map(checksSheet.rows.map((r) => [r.key, r.Answer || '']));
  const decisions = new Map(readCsv(F('research-copi-decisions.csv')).map((r) => [r.key, parseDecision(r)]));
  const emails = new Map(readCsv(F('research-copi-current-emails.csv')).map((r) => [r.key, r.chosenEmail]));
  console.log(`Resolve ${resolveHash}: ${lines.length} lines. Approved groups: ${[...approvedGroups].join(', ')}. Excluded: ${excluded.size}. Decisions: ${decisions.size}.`);

  const held = [];
  const hold = (line, reason) => held.push({ key: line.key, requestNum: line.requestNum || '', reason });
  const coPi = []; // extracted + recorded rows that end in a co-PI row
  const contactAccounts = new Map(); // contactId -> {accountId, keys}
  const wantAccount = (contactId, accountId, key) => {
    const prev = contactAccounts.get(contactId);
    if (prev && prev.accountId !== accountId) prev.conflict = true;
    contactAccounts.set(contactId, { accountId, keys: [...(prev?.keys || []), key], conflict: prev?.conflict || false });
  };
  let copyFrom = null; let rossKey = null;
  for (const line of lines) {
    const decision = decisions.get(line.key);
    const sel = selectLine(line, { approvedGroups, excluded, checks, decision });
    if (!sel.include) { if (sel.reason !== 'group-not-approved' || line.class === 'ready') hold(line, sel.reason); continue; }
    if (sel.kind === 'contact-account') { wantAccount(guid(line.contactId, 'contactId'), sel.contactAccountId, line.key); continue; }
    const r = review.get(line.key) || {};
    coPi.push({ line, sel, decision, name: r.Person || '', email: lc(decision?.email || emails.get(line.key) || r['Proposal email'] || '') });
    if (sel.copyAccountOf) copyFrom = { key: line.key, from: sel.copyAccountOf };
    if (decision?.updateEmail) rossKey = line.key;
  }

  const ops = [];
  await bypassDynamicsRestrictions('research-copi-stage-b-plan', async () => {
    // Staff "same person": the existing contact by its exact email.
    for (const x of coPi.filter((c) => c.sel.contact.mode === 'lookup')) {
      const hits = await activeContactsWithEmail(x.sel.contact.email);
      if (hits.length !== 1) { x.held = `same-person lookup found ${hits.length} active contacts`; continue; }
      x.contactId = lc(hits[0].contactid);
      x.contactRecord = hits[0];
    }
    for (const x of coPi.filter((c) => c.sel.contact.mode === 'existing')) x.contactId = guid(x.sel.contact.contactId, 'contactId');

    // New contacts: the final email must not already belong to a contact, and no two new people may collide.
    const fresh = coPi.filter((c) => c.sel.contact.mode === 'new');
    for (const x of fresh) {
      if (x.email && (await activeContactsWithEmail(x.email)).length) x.held = 'final email already held by an active contact';
    }
    const groups = groupNewContacts(fresh.map((x, idx) => ({ idx, ref: x.line.key, name: x.name, email: x.email, accountId: x.sel.iaaAccountId })));
    fresh.forEach((x, idx) => { const g = groups.get(idx); if (g && g.status !== 'single' && !x.held) x.held = `new-contact group ${g.status}`; });

    // Ogawa takes the current account of her lab head's (Pao's) resolved contact.
    if (copyFrom) {
      const target = coPi.find((c) => c.line.key === copyFrom.key);
      const source = coPi.find((c) => c.line.key === copyFrom.from);
      const account = lc(source?.contactRecord?._parentcustomerid_value);
      if (!source?.contactRecord) target.held = `account source ${copyFrom.from} not resolved`;
      else if (account === OIST_FOUNDATION) target.held = 'source account is the OIST Foundation record: owner to decide';
      else target.sel.newContactAccount = account || '';
    }

    // Existing junction rows: a co-PI row already there is an IaA update (or nothing); a PI row blocks.
    const byRequest = new Map();
    for (const x of coPi.filter((c) => !c.held)) {
      const reqId = guid(x.line.requestId, 'requestId');
      if (!byRequest.has(reqId)) byRequest.set(reqId, await rowsForRequest(reqId));
      const rows = byRequest.get(reqId);
      if (x.line.cohort === 'recorded') {
        const row = rows.find((j) => lc(j.wmkf_apprequestpersonid) === lc(x.line.junctionRowId));
        if (!row) { x.held = 'recorded junction row not found'; continue; }
        const mismatch = recordedRowMismatch(x.line, row);
        if (mismatch) { x.held = mismatch; continue; }
        x.existingRow = row;
      } else if (x.contactId) {
        const mine = rows.filter((j) => lc(j._wmkf_contact_value) === x.contactId);
        if (x.contactId === lc(x.line.projectLeaderId) || mine.some((j) => j.wmkf_role !== ROLE_COPI)) { x.held = 'contact is the PI on this request'; continue; }
        x.existingRow = mine.find((j) => j.wmkf_role === ROLE_COPI) || null;
      }
      if (x.existingRow && x.existingRow._wmkf_institutionataward_value) x.held = 'co-PI row already has an Institution at Award';
    }

    // Ross: owner-approved update of her existing contact.
    let rossUpdate = null;
    if (rossKey) {
      const ross = coPi.find((c) => c.line.key === rossKey);
      const d = ross.decision;
      const accounts = await readAll('accounts', { select: 'accountid,name', filter: `statecode eq 0 and name eq '${escape(d.updateAccountName)}'` });
      if (!ross.contactRecord) ross.updateHeld = 'contact not resolved';
      else if (accounts.length !== 1) ross.updateHeld = `${accounts.length} active accounts named ${d.updateAccountName}`;
      else rossUpdate = { contactId: ross.contactId, email: d.updateEmail, accountId: lc(accounts[0].accountid), before: ross.contactRecord };
      if (ross.updateHeld) held.push({ key: rossKey, requestNum: ross.line.requestNum, reason: `contact update: ${ross.updateHeld}` });
    }

    // Build operations in dependency order per row.
    const position = new Map();
    for (const x of coPi) {
      if (x.held) { hold(x.line, x.held); continue; }
      const source = { key: x.line.key, requestId: lc(x.line.requestId), requestNum: x.line.requestNum, meetingDate: x.line.meetingDate, applicantId: lc(x.line.applicantId), projectLeaderId: lc(x.line.projectLeaderId) };
      if (x.existingRow) {
        // Apply re-checks the row against the approved identity (snapshot for recorded rows, the matched contact otherwise), not whatever the row holds now.
        const expect = { requestId: source.requestId, contactId: lc(x.line.cohort === 'recorded' ? x.line.contactId : x.contactId), role: ROLE_COPI };
        if (x.sel.iaaAccountId) ops.push({ op: 'iaa-set', id: lc(x.existingRow.wmkf_apprequestpersonid), value: guid(x.sel.iaaAccountId, 'iaa'), expect, source });
        else hold(x.line, 'co-PI row exists and no institution to set');
        continue;
      }
      let contactId = x.contactId;
      if (x.sel.contact.mode === 'new') {
        contactId = crypto.randomUUID();
        const accountId = x.sel.newContactAccount ? guid(x.sel.newContactAccount, 'newContactAccount') : '';
        ops.push({ op: 'contact-create', id: contactId, payload: contactCreatePayload({ contactId, name: x.name, email: x.email, accountId }), source });
      }
      const reqId = source.requestId;
      if (!position.has(reqId)) position.set(reqId, byRequest.get(reqId).filter((j) => j.wmkf_role === ROLE_COPI).length);
      position.set(reqId, position.get(reqId) + 1);
      const junctionId = crypto.randomUUID();
      ops.push({
        op: 'junction-create', id: junctionId, contactId, newContact: x.sel.contact.mode === 'new',
        ...(x.sel.contact.mode === 'new' ? { contactPayload: ops.at(-1).payload } : {}),
        payload: junctionCreatePayload({ junctionId, requestId: reqId, requestNum: x.line.requestNum, contactId, iaaAccountId: x.sel.iaaAccountId ? guid(x.sel.iaaAccountId, 'iaa') : '', position: position.get(reqId) }),
        source,
      });
      if (x.sel.contactAccountId && contactId) wantAccount(contactId, x.sel.contactAccountId, x.line.key);
    }
    for (const [contactId, w] of contactAccounts) {
      if (w.conflict) { held.push({ key: w.keys.join(' '), requestNum: '', reason: 'two different accounts proposed for one contact' }); continue; }
      ops.push({ op: 'contact-account-set', id: contactId, value: guid(w.accountId, 'contact account'), source: { key: w.keys.join(' ') } });
    }
    if (rossUpdate) {
      const b = rossUpdate.before;
      ops.push({
        op: 'contact-update', id: rossUpdate.contactId,
        before: { emailaddress1: lc(b.emailaddress1), emailaddress2: lc(b.emailaddress2), parentcustomerid: lc(b._parentcustomerid_value) },
        after: { emailaddress1: rossUpdate.email, emailaddress2: lc(b.emailaddress2) || lc(b.emailaddress1), parentcustomerid: rossUpdate.accountId },
        source: { key: rossKey },
      });
    }
  });

  const planText = `${[{ meta: true, host, resolveHash, at: now() }, ...ops].map((o) => JSON.stringify(o)).join('\n')}\n`;
  fs.writeFileSync(PLAN, planText);
  // Immutable copy by hash: verify and rollback load the plan an apply log names.
  fs.writeFileSync(F(`research-copi-apply-plan-${sha(planText).slice(0, 8)}.jsonl`), planText);
  const nameOf = new Map(coPi.map((x) => [x.line.key, x.name]));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [['op', 'request', 'person', 'detail', 'key'].join(',')];
  for (const o of ops) {
    const detail = o.op === 'contact-create' ? `${o.payload.emailaddress1 || '(no email)'}${o.payload['parentcustomerid_account@odata.bind'] ? ` | account ${o.payload['parentcustomerid_account@odata.bind']}` : ''}`
      : o.op === 'junction-create' ? `${o.newContact ? 'new contact' : `contact ${o.contactId}`} | IaA ${o.payload['wmkf_InstitutionAtAward@odata.bind'] || '(empty)'}`
        : o.op === 'contact-update' ? `email ${o.before.emailaddress1} -> ${o.after.emailaddress1}; account -> ${o.after.parentcustomerid}`
          : `${o.id} -> ${o.value}`;
    csv.push([o.op, o.source.requestNum || '', nameOf.get(o.source.key) || '', detail, o.source.key].map(q).join(','));
  }
  for (const h of held) csv.push(['held', h.requestNum, nameOf.get(h.key) || '', h.reason, h.key].map(q).join(','));
  fs.writeFileSync(PLAN_CSV, `${csv.join('\n')}\n`);
  const tally = (arr, f) => arr.reduce((m, x) => ({ ...m, [f(x)]: (m[f(x)] || 0) + 1 }), {});
  console.log('Operations:', JSON.stringify(tally(ops, (o) => o.op)));
  console.log('Held:', JSON.stringify(tally(held, (h) => h.reason)));
  console.log(`Wrote ${PLAN}\nWrote ${PLAN_CSV}\nPlan hash (pass to --apply --confirm=): ${sha(planText).slice(0, 8)}`);
}

// ── Apply ──
const SETS = SET_TARGETS;
async function patchReturning(entitySet, id, select, body, ifMatch) {
  const token = await DynamicsService.getAccessToken();
  const headers = { ...buildHeaders(token), Prefer: 'return=representation,odata.include-annotations="*"', 'If-Match': ifMatch };
  const res = await fetchWithTimeout(`${process.env.DYNAMICS_URL}/api/data/v9.2/${entitySet}(${guid(id, 'id')})?$select=${select}`, { method: 'PATCH', headers, body: JSON.stringify(body) }, 60000);
  if (!res.ok) { const err = new Error(`PATCH failed (${res.status}): ${(await res.text()).slice(0, 200)}`); err.status = res.status; throw err; }
  return DynamicsService.processAnnotations(await res.json());
}
const applyOp = makeApplier({
  getOrNull: (entitySet, id, select) => getOrNull(entitySet, guid(id, 'id'), select),
  activeContactsWithEmail,
  rowsForRequest,
  create: (entitySet, payload) => DynamicsService.createRecord(entitySet, payload),
  patch: patchReturning,
});

function loadPlan({ fromLedger = false } = {}) {
  const logged = fromLedger ? ledgerPlanHash(readJsonl(APPLIED)) : null;
  const file = logged ? F(`research-copi-apply-plan-${logged}.jsonl`) : PLAN;
  if (!fs.existsSync(file)) { console.error(`No plan file ${file}; run --plan first.`); process.exit(2); }
  const text = fs.readFileSync(file, 'utf8');
  if (logged && sha(text).slice(0, 8) !== logged) { console.error(`${file} does not match its hash.`); process.exit(2); }
  const [meta, ...ops] = text.trim().split('\n').map((l) => JSON.parse(l));
  if (meta.host !== host) { console.error('Plan is for another host.'); process.exit(2); }
  return { hash: sha(text).slice(0, 8), ops };
}

async function runApply() {
  const { hash, ops } = loadPlan();
  if (arg('confirm') !== hash) { console.error(`--confirm must equal the plan hash ${hash}.`); process.exit(2); }
  const logged = ledgerPlanHash(readJsonl(APPLIED));
  if (logged && logged !== hash) { console.error(`The apply log belongs to plan ${logged}; this plan is ${hash}. Use that plan or move the log aside.`); process.exit(2); }
  const approver = arg('approver');
  if (!approver) { console.error('--approver="<name>" is required'); process.exit(2); }
  const first = Number(arg('first')) || Infinity;
  const ledger = foldLedger(readJsonl(APPLIED));
  const runId = `${now()}-${crypto.randomBytes(3).toString('hex')}`;
  let counts;
  await bypassDynamicsRestrictions('research-copi-stage-b-apply', async () => {
    // Plan order puts each contact before its junction row, so one pass settles both.
    counts = await runOperations({
      ops, ledger, applyOp, first,
      base: () => ({ runId, planHash: hash, approver, host }),
      log: (line) => {
        append(APPLIED, line);
        if (line.phase === 'result' && (!['created', 'set', 'already_set', 'blocked'].includes(line.result) || line.detail)) console.log(`  ${line.kind} ${line.requestNum} ${line.result}${line.detail ? ` (${line.detail})` : ''}`);
      },
    });
  });
  console.log(`Apply this run: ${JSON.stringify(counts)}. Log: ${APPLIED}`);
  console.log(`Operations not yet applied: ${ops.filter((o) => !applyDone(ledger.get(`${o.op}|${o.id}`))).length} of ${ops.length}`);
}

async function runVerify() {
  const { ops } = loadPlan({ fromLedger: true });
  const ledger = foldLedger(readJsonl(APPLIED));
  let ok = 0; const bad = []; const open = []; const modified = []; const recovered = [];
  await bypassDynamicsRestrictions('research-copi-stage-b-verify', async () => {
    for (const o of ops) {
      const s = ledger.get(`${o.op}|${o.id}`);
      const label = `${o.op} ${o.source.requestNum || ''} ${o.id}`;
      if (!applyDone(s)) { open.push(`${label} (${s?.receipt?.result || (s?.interrupted ? 'interrupted' : 'not run')})`); continue; }
      if (s.undone) continue;
      if (s.receipt.result === 'recovered_modified') { modified.push(label); continue; }
      if (!['created', 'set', 'recovered'].includes(s.receipt.result)) continue;
      if (s.receipt.result === 'recovered') recovered.push(label);
      let good;
      if (o.op === 'contact-create') good = Boolean(await getOrNull('contacts', o.id, 'contactid'));
      else if (o.op === 'junction-create') { const j = await getOrNull(JUNCTION, o.id, ROW_SELECT); good = Boolean(j) && lc(j._wmkf_contact_value) === lc(o.contactId); }
      else if (o.op === 'contact-update') { const c = await getOrNull('contacts', o.id, CONTACT_SELECT); good = lc(c?.emailaddress1) === o.after.emailaddress1 && lc(c?._parentcustomerid_value) === o.after.parentcustomerid; }
      else good = SETS[o.op].value(await getOrNull(SETS[o.op].entitySet, o.id, SETS[o.op].select)) === o.value;
      if (good) ok += 1; else bad.push(label);
    }
  });
  console.log(`Verify: ${ok} applied writes hold; ${bad.length} mismatch; ${open.length} planned operations unresolved; ${recovered.length} recovered after an interrupted run; ${modified.length} edited by someone else after creation.`);
  for (const b of bad) console.log(`  MISMATCH ${b}`);
  for (const b of open) console.log(`  UNRESOLVED ${b}`);
  for (const b of recovered) console.log(`  RECOVERED ${b} (rollback needs --include-recovered)`);
  for (const b of modified) console.log(`  EDITED-SINCE-CREATE ${b} (never rolled back automatically)`);
}

async function runRollback() {
  const ids = arg('ids');
  if (!ids) { console.error('--ids=<file of ids | all> is required'); process.exit(2); }
  const { ops } = loadPlan({ fromLedger: true });
  const includeRecovered = flag('include-recovered');
  const wanted = ids === 'all' ? null : new Set(fs.readFileSync(ids, 'utf8').split(/\s+/).filter(Boolean).map((s) => s.toLowerCase()));
  const ledger = foldLedger(readJsonl(APPLIED));
  // Junction rows before the contacts they reference; plain sets after.
  const ORDER = ['junction-create', 'contact-create', 'iaa-set', 'contact-account-set', 'contact-update'];
  const todo = ops.filter((o) => !wanted || wanted.has(lc(o.id))).sort((a, b) => ORDER.indexOf(a.op) - ORDER.indexOf(b.op));
  const counts = {};
  await bypassDynamicsRestrictions('research-copi-stage-b-rollback', async () => {
    for (const o of todo) {
      const s = ledger.get(`${o.op}|${o.id}`);
      if (!s?.receipt) continue;
      let outcome;
      if (s.undone) outcome = 'already_undone';
      else if (!rollbackEligible(s, { includeRecovered })) outcome = s.receipt.result === 'recovered' ? 'not_eligible_recovered' : 'not_eligible';
      else {
        try {
          if (o.op === 'junction-create' || o.op === 'contact-create') {
            const entitySet = o.op === 'junction-create' ? JUNCTION : 'contacts';
            const cur = await getOrNull(entitySet, o.id, o.op === 'junction-create' ? ROW_SELECT : CONTACT_SELECT);
            if (!cur) outcome = 'missing';
            else if (cur._etag !== s.receipt.postEtag) outcome = 'changed_since_write';
            else if (o.op === 'contact-create' && ((await readAll(JUNCTION, { select: 'wmkf_apprequestpersonid', filter: `_wmkf_contact_value eq ${guid(o.id, 'id')}` })).length
              || (await readAll('wmkf_potentialreviewerses', { select: 'wmkf_potentialreviewersid', filter: `_wmkf_contact_value eq ${guid(o.id, 'id')}` })).length)) outcome = 'referenced';
            else { await DynamicsService.deleteRecord(entitySet, o.id, { ifMatch: s.receipt.postEtag }); outcome = 'deleted'; }
          } else if (o.op === 'contact-update') {
            const cur = await getOrNull('contacts', o.id, CONTACT_SELECT);
            if (cur?._etag !== s.receipt.postEtag) outcome = 'changed_since_write';
            else {
              await DynamicsService.updateRecord('contacts', o.id, {
                emailaddress1: o.before.emailaddress1 || null, emailaddress2: o.before.emailaddress2 || null,
                'parentcustomerid_account@odata.bind': o.before.parentcustomerid ? `/accounts(${guid(o.before.parentcustomerid, 'account')})` : null,
              }, { ifMatch: s.receipt.postEtag });
              outcome = 'restored';
            }
          } else {
            const t = SETS[o.op];
            const cur = await getOrNull(t.entitySet, o.id, t.select);
            if (cur?._etag !== s.receipt.postEtag || t.value(cur) !== o.value) outcome = 'changed_since_write';
            else { await DynamicsService.updateRecord(t.entitySet, o.id, t.bind(null), { ifMatch: s.receipt.postEtag }); outcome = 'cleared'; }
          }
        } catch (err) { outcome = err?.status === 412 ? 'changed_since_write' : `failed: ${String(err.message || err).slice(0, 120)}`; }
      }
      append(APPLIED, { kind: o.op, id: o.id, requestNum: o.source.requestNum || '', phase: 'rollback', outcome, at: now() });
      counts[outcome] = (counts[outcome] || 0) + 1;
    }
  });
  console.log(`Rollback: ${JSON.stringify(counts)}`);
}

await { plan: runPlan, apply: runApply, verify: runVerify, rollback: runRollback }[MODE]();
