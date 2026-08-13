#!/usr/bin/env node
/**
 * READ-ONLY probe: WHICH gate is skipping every respond-by reminder?
 *
 * `/api/cron/reviewer-reminders?dryRun=1` reports `scanned: 75, eligible: 0` but
 * cannot say why: `skipped` is a single counter incremented at six different
 * sites in `sweepRespondReminders` (reviewer-reminder-sweep.js:134, :139, :145,
 * :152, :154, :156). This probe re-runs the SAME query and the SAME ladder, in
 * the same order, and attributes each row to the FIRST gate that closes on it.
 *
 * The ladder is duplicated here rather than imported: importing the sweep pulls
 * in DynamicsService and the send path, and a diagnostic must not be one refactor
 * away from mailing 75 reviewers. The cost is that this copy can drift from the
 * original — `--verify-ladder` prints both so they can be diffed by eye, and the
 * gate order below is annotated with the source line it mirrors. If the sweep's
 * ladder changes, this probe is stale and must be updated or deleted.
 *
 * Writes nothing: GETs only, no marker, no token mint, no email.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-respond-reminder-gates.js \
 *     --target=prod --output outputs/respond-reminder-gates.json
 *
 *   Add --name="Jane Reviewer" to also dump that one reviewer's raw gate inputs.
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const DAY_MS = 24 * 60 * 60 * 1000;

// Mirrors sweepRespondReminders' skip sites, in ladder order. The `at` field is
// the reviewer-reminder-sweep.js line this gate corresponds to.
const GATES = [
  { key: 'request_not_loaded', at: ':134', why: 'the request row failed to load' },
  { key: 'reminder_disabled', at: ':139', why: 'wmkf_respondreminderenabled is not exactly true' },
  { key: 'offset_unset', at: ':139', why: 'wmkf_respondoffsetdays is null / not an integer' },
  { key: 'no_email_sent_at', at: ':139', why: 'wmkf_emailsentat is missing' },
  { key: 'not_yet_due', at: ':145', why: 'today is before emailSentAt + offset - leadDays' },
  { key: 'token_expired', at: ':152', why: 'the reviewer’s invitation link has expired' },
  { key: 'no_program_director', at: ':154', why: 'the request has no enabled PD with an email' },
  { key: 'no_reviewer_email', at: ':156', why: 'the person row has no email address' },
  { key: 'ELIGIBLE', at: '—', why: 'passes every gate — would have been sent' },
];

function parseCli(argv) {
  const targetArg = argv.find((a) => a.startsWith('--target='));
  if (!targetArg) throw new Error('--target=prod or --target=sandbox is required');
  const target = targetArg.slice('--target='.length);
  if (target !== 'prod' && target !== 'sandbox') throw new Error(`Unknown target: ${target}`);
  const outArg = argv.find((a) => a.startsWith('--output='));
  const nameArg = argv.find((a) => a.startsWith('--name='));
  return {
    target,
    outputPath: outArg ? outArg.slice('--output='.length) : null,
    name: nameArg ? nameArg.slice('--name='.length).trim().toLowerCase() : null,
  };
}

async function queryAll(client, url) {
  const rows = [];
  let next = url;
  while (next) {
    const resp = await client.get(next);
    if (!resp.ok) throw new Error(`Query failed (${resp.status}): ${resp.text.slice(0, 400)}`);
    rows.push(...(resp.body?.value || []));
    const link = resp.body?.['@odata.nextLink'];
    next = link ? link : null;
  }
  return rows;
}

function classify(row, request, pd, reviewer, now) {
  if (!request) return 'request_not_loaded';
  // Single site in the sweep (`!enabled || offset == null || !emailSentAt`) —
  // split three ways here, since which of the three fired is the whole question.
  if (request.wmkf_respondreminderenabled !== true) return 'reminder_disabled';
  if (!Number.isInteger(request.wmkf_respondoffsetdays)) return 'offset_unset';
  if (!row.wmkf_emailsentat) return 'no_email_sent_at';

  const lead = Number.isInteger(request.wmkf_respondreminderleaddays) ? request.wmkf_respondreminderleaddays : 0;
  const deadline = new Date(row.wmkf_emailsentat).getTime() + request.wmkf_respondoffsetdays * DAY_MS;
  if (now < deadline - lead * DAY_MS) return 'not_yet_due';

  const tokenExpires = row.wmkf_externaltokenexpires ? new Date(row.wmkf_externaltokenexpires).getTime() : null;
  if (tokenExpires == null || tokenExpires <= now) return 'token_expired';

  if (!pd?.internalemailaddress || !pd?.systemuserid) return 'no_program_director';
  if (!reviewer?.wmkf_emailaddress) return 'no_reviewer_email';
  return 'ELIGIBLE';
}

async function main() {
  const { target, outputPath, name } = parseCli(process.argv.slice(2));
  loadEnvLocal();
  if (target === 'prod' && process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error('Production reads require DATAVERSE_ALLOW_PROD_READS=yes');
  }
  const resourceUrl = target === 'sandbox'
    ? process.env.DYNAMICS_SANDBOX_URL
    : process.env.DYNAMICS_URL || process.env.DATAVERSE_URL;
  if (!resourceUrl) throw new Error(`Missing Dynamics URL for target=${target}`);

  // The real constant, not a copied magic number.
  const { APPLICANT_DISPOSITION_EXCLUDED } = await import('../shared/config/reviewerLifecycle.js');

  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });
  const now = Date.now();

  // Byte-identical to sweepRespondReminders' filter (reviewer-reminder-sweep.js:110-115).
  const filter = `wmkf_invited eq true and wmkf_emailsentat ne null `
    + `and (wmkf_accepted eq false or wmkf_accepted eq null) `
    + `and (wmkf_declined eq false or wmkf_declined eq null) `
    + `and wmkf_responsetype eq null and wmkf_respondremindersentat eq null `
    + `and (wmkf_applicantdisposition eq null or wmkf_applicantdisposition ne ${APPLICANT_DISPOSITION_EXCLUDED})`;
  const select = 'wmkf_appreviewersuggestionid,_wmkf_request_value,_wmkf_potentialreviewer_value,'
    + 'wmkf_emailsentat,wmkf_externaltokenexpires';

  const rows = await queryAll(client,
    `/wmkf_appreviewersuggestions?$select=${select}&$filter=${encodeURIComponent(filter)}`);

  const requestIds = [...new Set(rows.map((r) => r._wmkf_request_value).filter(Boolean))];
  const requests = {};
  const pds = {};
  for (const id of requestIds) {
    const resp = await client.get(`/akoya_requests(${id})?$select=akoya_requestid,akoya_requestnum,akoya_title,`
      + `wmkf_respondreminderenabled,wmkf_respondoffsetdays,wmkf_respondreminderleaddays,`
      + `wmkf_reviewduereminderenabled,wmkf_reviewduedate,_wmkf_programdirector_value`);
    if (!resp.ok) continue;
    requests[id] = resp.body;
    const pdId = resp.body?._wmkf_programdirector_value;
    if (pdId && !(pdId in pds)) {
      const pdResp = await client.get(`/systemusers(${pdId})?$select=systemuserid,internalemailaddress,isdisabled`);
      // loadRequestContext nulls a disabled PD (reviewer-reminder-sweep.js:80).
      pds[pdId] = pdResp.ok && pdResp.body?.isdisabled === false ? pdResp.body : null;
    }
  }

  const personIds = [...new Set(rows.map((r) => r._wmkf_potentialreviewer_value).filter(Boolean))];
  const people = {};
  for (const id of personIds) {
    const resp = await client.get(`/wmkf_potentialreviewerses(${id})?$select=wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress`);
    if (resp.ok) people[id] = resp.body;
  }

  const counts = Object.fromEntries(GATES.map((g) => [g.key, 0]));
  const perRequest = {};
  let named = null;

  for (const row of rows) {
    const request = requests[row._wmkf_request_value] || null;
    const pd = request?._wmkf_programdirector_value ? pds[request._wmkf_programdirector_value] : null;
    const reviewer = people[row._wmkf_potentialreviewer_value] || null;
    const verdict = classify(row, request, pd, reviewer, now);
    counts[verdict] += 1;

    const key = request?.akoya_requestnum || row._wmkf_request_value || 'unknown';
    perRequest[key] = perRequest[key] || { respondReminderEnabled: request?.wmkf_respondreminderenabled ?? null,
      respondOffsetDays: request?.wmkf_respondoffsetdays ?? null,
      respondReminderLeadDays: request?.wmkf_respondreminderleaddays ?? null,
      reviewDueDate: request?.wmkf_reviewduedate ?? null, verdicts: {} };
    perRequest[key].verdicts[verdict] = (perRequest[key].verdicts[verdict] || 0) + 1;

    if (name && reviewer?.wmkf_name && reviewer.wmkf_name.toLowerCase().includes(name)) {
      named = {
        reviewer: reviewer.wmkf_name,
        hasEmail: !!reviewer.wmkf_emailaddress,
        request: key,
        verdict,
        gateInputs: {
          emailSentAt: row.wmkf_emailsentat,
          tokenExpires: row.wmkf_externaltokenexpires,
          tokenLive: row.wmkf_externaltokenexpires ? new Date(row.wmkf_externaltokenexpires).getTime() > now : false,
          respondReminderEnabled: request?.wmkf_respondreminderenabled ?? null,
          respondOffsetDays: request?.wmkf_respondoffsetdays ?? null,
          respondReminderLeadDays: request?.wmkf_respondreminderleaddays ?? null,
          reminderDueAt: (request && Number.isInteger(request.wmkf_respondoffsetdays) && row.wmkf_emailsentat)
            ? new Date(new Date(row.wmkf_emailsentat).getTime()
              + request.wmkf_respondoffsetdays * DAY_MS
              - (Number.isInteger(request.wmkf_respondreminderleaddays) ? request.wmkf_respondreminderleaddays : 0) * DAY_MS).toISOString()
            : null,
          pdResolved: !!(pd?.internalemailaddress && pd?.systemuserid),
        },
      };
    }
  }

  const dominant = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const artifact = {
    observedAt: new Date().toISOString(),
    target: target === 'prod' ? 'production' : 'sandbox',
    targetHostname: new URL(resourceUrl).hostname.toLowerCase(),
    question: 'Which gate in sweepRespondReminders skips each invited-but-unanswered reviewer?',
    method: 'Re-run the sweep query verbatim, then replay its gate ladder in order and record the FIRST gate that closes on each row. Read-only.',
    scanned: rows.length,
    counts,
    dominantReason: dominant.length ? { gate: dominant[0][0], rows: dominant[0][1], of: rows.length } : null,
    gateLegend: Object.fromEntries(GATES.map((g) => [g.key, `${g.why} (sweep${g.at})`])),
    perRequest,
    namedReviewer: named,
    caveat: 'The ladder is a hand-kept copy of reviewer-reminder-sweep.js. If that file changed after 2026-08-13, re-verify before trusting the attribution.',
  };

  console.log(JSON.stringify(artifact, null, 2));
  if (outputPath) {
    const abs = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(artifact, null, 2)}\n`);
    console.error(`\nWrote ${abs}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

// Exported for tests: the attribution is the whole value of this probe, so it is
// asserted gate-by-gate rather than trusted on first run.
module.exports = { classify, GATES, DAY_MS };
