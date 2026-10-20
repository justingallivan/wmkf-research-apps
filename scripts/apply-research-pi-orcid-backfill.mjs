/**
 * apply-research-pi-orcid-backfill.mjs — stage 2 of the Research PI/co-PI
 * ORCID backfill: writes owner-approved ORCIDs onto empty `contact.wmkf_orcid`.
 * Plan: docs/plans/RESEARCH_PI_ORCID_BACKFILL_STAGE2_PLAN_2026-10-19.md.
 * Owner-run only. Structure follows scripts/backfill-contact-orcid.js.
 *
 * Input: the reviewed workbook (one row per person; column A "Confirm?" =
 * Yes/No/Unsure, F = proposed ORCID, hidden M = contactid) and the stage-1
 * pool JSON (name snapshot). Only "Yes" rows are considered.
 *
 *   --resolve   (default) READ-ONLY. Classifies every approved row; writes
 *               <dir>/research-pi-orcid-resolve.jsonl and prints its hash.
 *   --apply --confirm=<8-char resolve hash> [--first=N]
 *               Writes only `write` rows via setOrcidIfAbsent(requireEtag).
 *               Appends intent/result lines to <dir>/research-pi-orcid-applied.jsonl.
 *   --verify    READ-ONLY. Re-reads every contact with result `write`.
 *   --rollback --ids=<file|all>
 *               Clears wmkf_orcid only where this run's `write` still stands:
 *               unchanged ETag since the post-write read AND same ORCID value.
 *
 * Common: --approvals=<xlsx> (required), --pool=<json> (default: research-pi-orcid-pool.json
 * next to the workbook), --dir=<checkpoint dir> (default: the workbook's folder),
 * --approver="<name>" (required for --resolve).
 * Write modes need DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD>" (the
 * Dataverse interlock's local→production write exception).
 * Checkpoints hold contact ids and ORCIDs only (no names).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { normalizeOrcid } from '../lib/utils/orcid-normalize.js';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const flag = (name) => process.argv.includes(`--${name}`);
const MODE = flag('apply') ? 'apply' : flag('verify') ? 'verify' : flag('rollback') ? 'rollback' : 'resolve';
const APPROVALS = arg('approvals');
if (!APPROVALS) { console.error('--approvals=<reviewed .xlsx> is required'); process.exit(2); }
const DIR = arg('dir') || path.dirname(APPROVALS);
const POOL = arg('pool') || path.join(path.dirname(APPROVALS), 'research-pi-orcid-pool.json');
const RESOLVE_LOG = path.join(DIR, 'research-pi-orcid-resolve.jsonl');
const APPLIED_LOG = path.join(DIR, 'research-pi-orcid-applied.jsonl');
if ((MODE === 'apply' || MODE === 'rollback') && !process.env.DATAVERSE_PROD_WRITE_ACK) {
  const today = new Date().toISOString().slice(0, 10);
  console.error(`Write mode needs DATAVERSE_PROD_WRITE_ACK, e.g. DATAVERSE_PROD_WRITE_ACK="research PI ORCID backfill ${today}"`);
  process.exit(2);
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { fetchWithTimeout } = await import('../lib/services/dynamics/http.js');
const contactAdapter = await import('../lib/dataverse/adapters/contact.js');
const potentialReviewer = await import('../lib/dataverse/adapters/potential-reviewer.js');
const { ORCIDService } = await import('../lib/services/orcid-service.js');
const { forenamesContradict } = await import('../lib/services/reviewer-identity-evidence.js');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
const host = (() => { try { return new URL(process.env.DYNAMICS_URL).host; } catch { return ''; } })();
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const append = (f, obj) => fs.appendFileSync(f, `${JSON.stringify(obj)}\n`);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ── Approvals: "Yes" rows from the workbook. The gate is a hash of the
// decision content (Excel rewrites file bytes on any save); the file hash is
// recorded for audit only.
async function loadApprovals() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(APPROVALS);
  const ws = wb.worksheets[0];
  // ExcelJS row values are 1-based and sparse; Array.from fills the holes.
  const head = Array.from(ws.getRow(1).values, (v) => String(v || ''));
  const col = (title) => head.findIndex((h) => h.startsWith(title));
  const [cConfirm, cPerson, cOrcid, cId] = [col('Confirm?'), col('Person'), col('Proposed ORCID'), col('contactid')];
  if ([cConfirm, cPerson, cOrcid, cId].some((c) => c < 1)) throw new Error('Workbook columns not recognized (Confirm?, Person, Proposed ORCID, contactid).');
  const text = (v) => (v && typeof v === 'object' ? v.text || v.result || '' : v ?? '');
  const rows = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    if (String(text(r.getCell(cConfirm).value)).trim() !== 'Yes') return;
    rows.push({
      contactid: String(text(r.getCell(cId).value)).trim().toLowerCase(),
      orcidRaw: String(text(r.getCell(cOrcid).value)).trim(),
      person: String(text(r.getCell(cPerson).value)).trim(),
    });
  });
  const content = rows.map((r) => `${r.contactid}|${normalizeOrcid(r.orcidRaw).id || r.orcidRaw}`).sort().join('\n');
  return { rows, contentHash: sha(content), fileHash: sha(fs.readFileSync(APPROVALS)) };
}

// ── Exhaustive ORCID index over contacts and potential reviewers. Paged via
// @odata.nextLink through the interlocked fetch (queryAllRecords caps at
// 5,000); any page failure throws, so the index is complete or absent.
async function readAllPages(set, select) {
  const token = await DynamicsService.getAccessToken();
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0', Prefer: 'odata.maxpagesize=5000' };
  let url = `${process.env.DYNAMICS_URL}/api/data/v9.2/${set}?$select=${select}&$filter=${encodeURIComponent('wmkf_orcid ne null')}`;
  const rows = [];
  while (url) {
    const res = await fetchWithTimeout(url, { headers }, 60000);
    if (!res.ok) throw new Error(`${set} index read failed (${res.status})`);
    const data = await res.json();
    rows.push(...(data.value || []));
    url = data['@odata.nextLink'] || null;
  }
  return rows;
}
async function buildIndex() {
  const contacts = await readAllPages('contacts', 'contactid,wmkf_orcid');
  const reviewers = await readAllPages('wmkf_potentialreviewerses', 'wmkf_potentialreviewersid,wmkf_orcid,_wmkf_contact_value');
  const contactsByOrcid = new Map(); const reviewersByOrcid = new Map(); const reviewersByContact = new Map();
  const push = (m, k, v) => m.set(k, [...(m.get(k) || []), v]);
  for (const c of contacts) {
    const n = normalizeOrcid(c.wmkf_orcid);
    if (n.state === 'valid') push(contactsByOrcid, n.id, String(c.contactid).toLowerCase());
  }
  for (const r of reviewers) {
    const n = normalizeOrcid(r.wmkf_orcid);
    const contact = r._wmkf_contact_value ? String(r._wmkf_contact_value).toLowerCase() : null;
    if (n.state !== 'valid') continue;
    push(reviewersByOrcid, n.id, contact);
    if (contact) push(reviewersByContact, contact, n.id);
  }
  console.log(`Index: ${contacts.length} contacts and ${reviewers.length} reviewer rows with an ORCID value.`);
  return { contactsByOrcid, reviewersByOrcid, reviewersByContact };
}
// Another contact or reviewer already holds this ORCID, or a reviewer linked
// to this contact holds a different one → the reason; else null.
function crossStoreBlock(index, contactid, orcid) {
  if ((index.contactsByOrcid.get(orcid) || []).some((id) => id !== contactid)) return 'held_by_other_contact';
  if ((index.reviewersByOrcid.get(orcid) || []).some((c) => c !== contactid)) return 'held_by_reviewer';
  if ((index.reviewersByContact.get(contactid) || []).some((o) => o !== orcid)) return 'reviewer_disagrees';
  return null;
}
async function readContact(id) {
  try {
    return await DynamicsService.getRecord('contacts', id, { select: 'contactid,firstname,lastname,wmkf_orcid,statecode' });
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

async function runResolve() {
  const approver = arg('approver');
  if (!approver) { console.error('--approver="<name>" is required for --resolve'); process.exit(2); }
  const approvals = await loadApprovals();
  const poolText = fs.existsSync(POOL) ? fs.readFileSync(POOL, 'utf8') : null;
  if (!poolText) { console.error(`Pool snapshot not found at ${POOL}; pass --pool.`); process.exit(2); }
  const pool = new Map(JSON.parse(poolText).people.map((p) => [p.contactId.toLowerCase(), p]));
  const meta = { runId: crypto.randomUUID(), approver, approvalsContentHash: approvals.contentHash, approvalsFileHash: approvals.fileHash, poolHash: sha(poolText), host };
  const orcidCreds = [process.env.ORCID_CLIENT_ID, process.env.ORCID_CLIENT_SECRET];

  const byOrcid = new Map(); const byContact = new Map();
  for (const r of approvals.rows) {
    const id = normalizeOrcid(r.orcidRaw).id;
    if (id) byOrcid.set(id, (byOrcid.get(id) || 0) + 1);
    byContact.set(r.contactid, (byContact.get(r.contactid) || 0) + 1);
  }

  const lines = [];
  await bypassDynamicsRestrictions('research-pi-orcid-resolve', async () => {
    const index = await buildIndex();
    for (const r of approvals.rows) {
      const n = normalizeOrcid(r.orcidRaw);
      let action = 'write'; let detail = '';
      const c = n.state === 'valid' ? await readContact(r.contactid) : null;
      const current = normalizeOrcid(c?.wmkf_orcid);
      const snap = pool.get(r.contactid);
      if (n.state !== 'valid') action = 'malformed';
      else if (byOrcid.get(n.id) > 1 || byContact.get(r.contactid) > 1) action = 'batch_conflict';
      else if (!c || c.statecode !== 0) action = 'nocontact';
      else if (current.state === 'valid') { action = current.id === n.id ? 'noop' : 'conflict'; detail = current.id; }
      else if (current.state === 'malformed') { action = 'conflict'; detail = 'stored value malformed'; }
      else if (!snap || norm(snap.firstname) !== norm(c.firstname) || norm(snap.lastname) !== norm(c.lastname)) action = 'changed_since_export';
      else {
        const block = crossStoreBlock(index, r.contactid, n.id);
        if (block) action = block;
        else {
          const p = await ORCIDService.getProfile(n.id, ...orcidCreds);
          const fam = norm(c.lastname).split(' ').filter((w) => w.length > 1);
          const pFam = norm(p?.familyName).split(' ').filter((w) => w.length > 1);
          const contactName = `${c.firstname || ''} ${c.lastname || ''}`;
          if (!p) { action = 'registry_mismatch'; detail = 'ORCID record not found'; }
          else if (!pFam.some((w) => fam.includes(w)) || forenamesContradict(contactName, `${p.givenNames} ${p.familyName}`)) {
            action = 'registry_mismatch'; detail = 'registry name differs';
          }
        }
      }
      lines.push({ ...meta, contactid: r.contactid, orcid: n.id || r.orcidRaw, action, detail, at: now() });
      if (action !== 'write') console.log(`  ${action.padEnd(22)} ${r.person}${detail ? ` (${detail})` : ''}`);
    }
  });
  const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(RESOLVE_LOG, text);
  const counts = {};
  for (const l of lines) counts[l.action] = (counts[l.action] || 0) + 1;
  console.log(`\nResolve: ${lines.length} approved rows → ${JSON.stringify(counts)}`);
  console.log(`Wrote ${RESOLVE_LOG}`);
  console.log(`Resolve hash (pass to --apply --confirm=): ${sha(text).slice(0, 8)}`);
}

async function runApply() {
  if (!fs.existsSync(RESOLVE_LOG)) { console.error('No resolve checkpoint; run --resolve first.'); process.exit(2); }
  const text = fs.readFileSync(RESOLVE_LOG, 'utf8');
  if (arg('confirm') !== sha(text).slice(0, 8)) { console.error(`--confirm must equal the resolve hash ${sha(text).slice(0, 8)}.`); process.exit(2); }
  const resolved = readJsonl(RESOLVE_LOG);
  const approvals = await loadApprovals();
  const poolHash = sha(fs.readFileSync(POOL, 'utf8'));
  const m = resolved[0];
  if (m.approvalsContentHash !== approvals.contentHash || m.poolHash !== poolHash || m.host !== host) {
    console.error('Approvals, pool or Dataverse host changed since --resolve. Re-run --resolve.');
    process.exit(2);
  }
  const first = Number(arg('first')) || Infinity;
  const latest = new Map();
  for (const l of readJsonl(APPLIED_LOG)) latest.set(`${l.contactid}|${l.orcid}`, l);

  let done = 0; const counts = {};
  await bypassDynamicsRestrictions('research-pi-orcid-apply', async () => {
    // Crash recovery: an intent without a result.
    for (const [key, l] of latest) {
      if (l.kind !== 'intent') continue;
      const c = await readContact(l.contactid);
      const cur = normalizeOrcid(c?.wmkf_orcid);
      if (cur.state === 'valid' && cur.id === l.orcid) {
        const rec = { ...l, kind: 'result', result: 'present_unattributed', at: now() };
        append(APPLIED_LOG, rec); latest.set(key, rec);
      } else if (cur.state !== 'empty') {
        const rec = { ...l, kind: 'result', result: 'conflict', detail: 'changed during interrupted run', at: now() };
        append(APPLIED_LOG, rec); latest.set(key, rec);
      } // still empty: falls through and is retried below
    }
    const index = await buildIndex();
    for (const r of resolved.filter((x) => x.action === 'write')) {
      const key = `${r.contactid}|${r.orcid}`;
      const prev = latest.get(key);
      if (prev?.kind === 'result' && prev.result !== 'failed') continue;
      if (done >= first) break;
      done += 1;
      const base = { runId: m.runId, contactid: r.contactid, orcid: r.orcid, approver: m.approver, approvalsContentHash: m.approvalsContentHash, poolHash: m.poolHash, host };
      append(APPLIED_LOG, { ...base, kind: 'intent', at: now() });
      let result; let detail = ''; let etag = null; let after = null;
      try {
        // State can change between resolve and apply: repeat the lookups.
        // Adapter result shape: { none } | { one, row } | { ambiguous, rows } (+ contact inactiveRows).
        const rowsOf = (res) => [...(res?.one ? [res.row] : res?.rows || []), ...(res?.inactiveRows || [])];
        const [contactHits, reviewerHits] = await Promise.all([contactAdapter.findByOrcidCandidates(r.orcid), potentialReviewer.findByOrcidCandidates(r.orcid)]);
        const otherContact = rowsOf(contactHits).some((x) => String(x.contactid).toLowerCase() !== r.contactid);
        const otherReviewer = rowsOf(reviewerHits).some((x) => String(x._wmkf_contact_value || '').toLowerCase() !== r.contactid);
        const block = crossStoreBlock(index, r.contactid, r.orcid) || (otherContact && 'held_by_other_contact') || (otherReviewer && 'held_by_reviewer');
        if (block) { result = 'blocked'; detail = block; }
        else {
          const out = await contactAdapter.setOrcidIfAbsent(r.contactid, r.orcid, { requireEtag: true });
          const post = await DynamicsService.getRecord('contacts', r.contactid, { select: 'contactid,wmkf_orcid' });
          etag = post?._etag || null;
          after = normalizeOrcid(post?.wmkf_orcid).id || post?.wmkf_orcid || null;
          if (out.action === 'write') result = after === r.orcid && etag ? 'write' : 'write_then_changed';
          else { result = out.action; detail = out.existing || out.reason || ''; }
        }
      } catch (err) { result = 'failed'; detail = String(err.message || err).slice(0, 200); }
      const rec = { ...base, kind: 'result', result, detail, postWriteEtag: etag, postWriteOrcid: after, at: now() };
      append(APPLIED_LOG, rec); latest.set(key, rec);
      counts[result] = (counts[result] || 0) + 1;
    }
  });
  console.log(`Apply this run: ${JSON.stringify(counts)}. Log: ${APPLIED_LOG}`);
  const remaining = resolved.filter((x) => x.action === 'write' && !(latest.get(`${x.contactid}|${x.orcid}`)?.kind === 'result' && latest.get(`${x.contactid}|${x.orcid}`).result !== 'failed')).length;
  console.log(`Write rows not yet applied: ${remaining}`);
}

async function runVerify() {
  const latest = new Map();
  for (const l of readJsonl(APPLIED_LOG)) latest.set(`${l.contactid}|${l.orcid}`, l);
  const written = [...latest.values()].filter((l) => l.kind === 'result' && l.result === 'write');
  let ok = 0; const bad = [];
  await bypassDynamicsRestrictions('research-pi-orcid-verify', async () => {
    for (const l of written) {
      const c = await readContact(l.contactid);
      if (normalizeOrcid(c?.wmkf_orcid).id === l.orcid) ok += 1; else bad.push(`${l.contactid} expected ${l.orcid} found ${c?.wmkf_orcid ?? '(missing)'}`);
    }
  });
  console.log(`Verify: ${ok}/${written.length} contacts hold the written ORCID.`);
  for (const b of bad) console.log(`  MISMATCH ${b}`);
}

async function runRollback() {
  const ids = arg('ids');
  if (!ids) { console.error('--ids=<file of contact ids | all> is required'); process.exit(2); }
  const latest = new Map();
  for (const l of readJsonl(APPLIED_LOG)) if (l.kind === 'result' || l.kind === 'rollback') latest.set(l.contactid, l);
  const wanted = ids === 'all' ? [...latest.keys()] : fs.readFileSync(ids, 'utf8').split(/\s+/).filter(Boolean).map((s) => s.toLowerCase());
  const counts = {};
  await bypassDynamicsRestrictions('research-pi-orcid-rollback', async () => {
    for (const id of wanted) {
      const l = latest.get(id);
      let outcome; let before = null;
      if (!l || l.kind !== 'result' || l.result !== 'write' || !l.postWriteEtag) outcome = 'not_eligible';
      else {
        const c = await DynamicsService.getRecord('contacts', id, { select: 'contactid,wmkf_orcid' });
        before = c?.wmkf_orcid ?? null;
        if (c?._etag !== l.postWriteEtag || normalizeOrcid(before).id !== l.orcid) outcome = 'changed_since_write';
        else {
          try { await contactAdapter.updateFields(id, { wmkf_orcid: null }, { ifMatch: l.postWriteEtag }); outcome = 'cleared'; }
          catch (err) { outcome = err?.status === 412 ? 'changed_since_write' : `failed: ${String(err.message || err).slice(0, 120)}`; }
        }
      }
      if (l) append(APPLIED_LOG, { runId: l.runId, contactid: id, orcid: l.orcid, kind: 'rollback', outcome, before, after: outcome === 'cleared' ? null : before, at: now() });
      counts[outcome] = (counts[outcome] || 0) + 1;
    }
  });
  console.log(`Rollback: ${JSON.stringify(counts)}`);
}

await { resolve: runResolve, apply: runApply, verify: runVerify, rollback: runRollback }[MODE]();
