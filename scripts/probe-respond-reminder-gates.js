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
 * original, so each GATES entry is annotated with the reviewer-reminder-sweep.js
 * line it mirrors, and `classify` is unit-tested gate by gate including ladder
 * order. If that sweep's ladder changes, this probe is stale: re-verify the
 * annotations or delete it. It is a diagnostic, not a second source of truth.
 *
 * Writes nothing: GETs only, no marker, no token mint, no email.
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-respond-reminder-gates.js \
 *     --target=prod --output outputs/respond-reminder-gates.json
 *
 *   Add --name="Jane Reviewer" to also dump that one reviewer's raw gate inputs.
 *   Add --assume-enabled to ALSO report where rows would land if the enabled flag
 *     were on — the blast radius of arming the reminder, without arming it.
 *
 * Every run also reports `tokenAudit` / per-request `tokens`: invitation-link state
 * for all scanned rows, computed independently of the ladder, in the verifier's own
 * order. A `live` token on a closed cycle is its own finding — that reviewer can
 * still accept today. `no_expiry_recorded` is UNRESOLVED, not safe: see auditToken.
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
  // Accept BOTH `--flag=value` and `--flag value`. The usage block advertised the
  // space form while only the `=` form parsed, so every documented invocation
  // silently produced no artifact — the probe printed its findings and wrote
  // nothing, and a plan then cited a file that had never existed.
  const valueOf = (flag) => {
    const eq = argv.find((a) => a.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    const i = argv.indexOf(flag);
    if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
    return null;
  };
  const name = valueOf('--name');
  return {
    target,
    outputPath: valueOf('--output'),
    name: name ? name.trim().toLowerCase() : null,
    assumeEnabled: argv.includes('--assume-enabled'),
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

/**
 * Token state for one row, computed INDEPENDENTLY of the gate ladder.
 *
 * The ladder reports only the first gate that closes, so a row stopping at
 * `offset_unset` never reaches the token check and its link state stays unknown.
 * That matters on its own terms: a live token on a closed cycle means that
 * reviewer can still accept an invitation today — `token-lifecycle.js:130-132`
 * validates hash + not-revoked + not-expired and asks nothing about the campaign.
 */
function auditToken(row, now) {
  // Hash first, exactly as the verifier does: no hash means no access at all,
  // whatever the expiry column says.
  if (!row.wmkf_externaltokenhash) return 'no_token';
  if (row.wmkf_externaltokenrevoked === true) return 'revoked';
  // The verifier's expiry check is guarded by `if (wmkf_externaltokenexpires)`
  // (:183) — a null column SKIPS it, so the row is bounded only by the JWT's own
  // `exp` claim, which this probe cannot see without the token itself. Reported
  // as its own state rather than folded into live/expired: calling it either
  // would assert something unmeasured.
  if (!row.wmkf_externaltokenexpires) return 'no_expiry_recorded';
  const expiresAt = new Date(row.wmkf_externaltokenexpires).getTime();
  if (!Number.isFinite(expiresAt)) return 'no_expiry_recorded';
  return expiresAt > now ? 'live' : 'expired';
}

const TOKEN_STATES = ['live', 'expired', 'no_token', 'revoked', 'no_expiry_recorded'];

/**
 * @param {{ assumeEnabled?: boolean }} [opts] - assumeEnabled forces gate 2 open to
 *   answer "what would actually send if the flag were turned on?". The flag is the
 *   FIRST gate that closes in production, so it masks every later gate: without
 *   this, the real blast radius of arming the reminder is unknowable short of
 *   sending. Hypothetical only — it never changes what the sweep does.
 */
function classify(row, request, pd, reviewer, now, { assumeEnabled = false } = {}) {
  if (!request) return 'request_not_loaded';
  // Single site in the sweep (`!enabled || offset == null || !emailSentAt`) —
  // split three ways here, since which of the three fired is the whole question.
  if (!assumeEnabled && request.wmkf_respondreminderenabled !== true) return 'reminder_disabled';
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
  const { target, outputPath, name, assumeEnabled } = parseCli(process.argv.slice(2));
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
  // The hash is selected for PRESENCE only and never printed (it is a SHA of the
  // JWT, not the link, but there is no reason to emit it).
  const select = 'wmkf_appreviewersuggestionid,_wmkf_request_value,_wmkf_potentialreviewer_value,'
    + 'wmkf_emailsentat,wmkf_externaltokenexpires,wmkf_externaltokenhash,wmkf_externaltokenrevoked,wmkf_selected';

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
  const countsIfEnabled = assumeEnabled ? Object.fromEntries(GATES.map((g) => [g.key, 0])) : null;
  const perRequest = {};
  let named = null;

  for (const row of rows) {
    const request = requests[row._wmkf_request_value] || null;
    const pd = request?._wmkf_programdirector_value ? pds[request._wmkf_programdirector_value] : null;
    const reviewer = people[row._wmkf_potentialreviewer_value] || null;
    const verdict = classify(row, request, pd, reviewer, now);
    counts[verdict] += 1;
    // Real verdict and projection are computed together so the artifact can never
    // show one without the other — a projection read as current state is exactly
    // the mistake this flag could otherwise cause.
    const ifEnabled = assumeEnabled
      ? classify(row, request, pd, reviewer, now, { assumeEnabled: true })
      : null;
    if (ifEnabled) countsIfEnabled[ifEnabled] += 1;

    const key = request?.akoya_requestnum || row._wmkf_request_value || 'unknown';
    perRequest[key] = perRequest[key] || { respondReminderEnabled: request?.wmkf_respondreminderenabled ?? null,
      respondOffsetDays: request?.wmkf_respondoffsetdays ?? null,
      respondReminderLeadDays: request?.wmkf_respondreminderleaddays ?? null,
      reviewDueDate: request?.wmkf_reviewduedate ?? null,
      verdicts: {},
      tokens: Object.fromEntries(TOKEN_STATES.map((s) => [s, 0])),
      latestLiveTokenExpiry: null,
      ...(assumeEnabled ? { wouldSendIfEnabled: 0 } : {}) };
    perRequest[key].verdicts[verdict] = (perRequest[key].verdicts[verdict] || 0) + 1;
    if (ifEnabled === 'ELIGIBLE') perRequest[key].wouldSendIfEnabled += 1;

    // Independent of the ladder — see auditToken.
    const tokenState = auditToken(row, now);
    perRequest[key].tokens[tokenState] += 1;
    if (tokenState === 'live') {
      const current = perRequest[key].latestLiveTokenExpiry;
      if (!current || new Date(row.wmkf_externaltokenexpires) > new Date(current)) {
        perRequest[key].latestLiveTokenExpiry = row.wmkf_externaltokenexpires;
      }
    }

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
    ...(assumeEnabled ? {
      ifEnabled: {
        note: 'HYPOTHETICAL — where these rows would land if wmkf_respondreminderenabled were true on every request. Nothing was sent or changed. `wouldSendNow` is the number of reminder emails the NEXT cron run would produce.',
        wouldSendNow: countsIfEnabled.ELIGIBLE,
        of: rows.length,
        counts: countsIfEnabled,
      },
    } : {}),
    tokenAudit: {
      note: 'Invitation-link state for every scanned row, computed independently of the gate ladder, in the verifier’s own order (hash → revoked → expiry). `live` means that reviewer can still ACCEPT today: verify-suggestion-token.js checks hash/revoked/expiry and asks nothing about whether the campaign is still open.',
      states: Object.fromEntries(TOKEN_STATES.map((s) => [s, rows.filter((r) => auditToken(r, now) === s).length])),
      of: rows.length,
      // Neither sweep filters on wmkf_selected (grep: no hits in
      // reviewer-reminder-sweep.js), so a candidate REMOVED from a proposal —
      // softDelete writes selected=false + tokenRevoked=true in one PATCH
      // (my-candidates-service.js:880) — still matches the respond-by query.
      unselectedButStillMatched: rows.filter((r) => r.wmkf_selected === false).length,
      unselectedAndRevoked: rows.filter((r) => r.wmkf_selected === false && r.wmkf_externaltokenrevoked === true).length,
      caveat: '`no_expiry_recorded` is NOT proof of safety: the verifier skips its expiry check when that column is null (verify-suggestion-token.js:183), leaving the JWT’s own `exp` claim — set at mint (external-token.js:102) and enforced by jwtVerify — as the only bound. This probe cannot read that claim without the token, so those rows are UNRESOLVED here, not clean.',
    },
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
module.exports = { classify, auditToken, parseCli, GATES, TOKEN_STATES, DAY_MS };
