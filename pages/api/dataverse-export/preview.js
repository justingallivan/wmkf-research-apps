/**
 * Dataverse Power Tools — Track B — POST /api/dataverse-export/preview
 *
 * The human-confirm gate (build plan §5). Validates the QuerySpec (§2.1 →
 * 422 + violations), resolves operational-exclusion labels against the LIVE
 * taxonomy, compiles, computes the TRUE total via FetchXML aggregate (NEVER
 * OData /$count) + an era split, surfaces unknown-filter-literal warnings
 * (§2.1 point 4), and mints a signed `resultToken` binding the exact
 * validated spec so /run cannot execute something unpreviewed.
 *
 * FAIL-LOUD: if excludeOperational is set but the operational labels cannot
 * be resolved from the live taxonomy, the preview REFUSES (422) and mints no
 * token — never a run that silently lets operational rows through (§3b/§9;
 * Codex S160 P1).
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { compile, validateQuerySpec } from '../../../lib/services/dataverse-export/compiler';
import { fetchXmlAggregateCount } from '../../../lib/services/dataverse-export/fetch-client';
import { testRequestIsolationEnabled } from '../../../lib/services/test-requests/isolation.js';
import { mintResultToken } from '../../../lib/services/dataverse-export/result-token';
import { fetchLiveTaxonomy, buildResolver } from '../../../lib/services/dataverse-export/live-taxonomy';

const ENTITY_SET = 'akoya_requests';

export const config = {
  api: { bodyParser: { sizeLimit: '256kb' }, externalResolver: true },
};

// §2.1 point 4 — a filter literal NOT in the live taxonomy is NOT a 422 and
// NOT the post-query UNCLASSIFIED sentinel; it is a PREVIEW warning so the
// user sees "this will match 0 rows" before confirming.
function taxonomyWarnings(spec, tax) {
  const sets = {
    program: new Set(tax.programs.map(p => p.id)),
    fundingCategory: new Set(tax.fundingCategories.map(g => g.id)),
    type: new Set(tax.types.map(t => t.id)),
    status: new Set(tax.statuses),
    requestType: new Set((tax.requestTypeOptions || []).map(o => String(o.value))),
  };
  const warnings = [];
  for (const f of spec.filters || []) {
    const set = sets[f.axis];
    if (!set) continue;
    if (f.op !== 'eq' && f.op !== 'in') continue; // only literal-match ops
    const vals = Array.isArray(f.value) ? f.value : (f.value === undefined ? [] : [f.value]);
    for (const v of vals) {
      const probe = f.axis === 'requestType' ? String(v) : v;
      if (!set.has(probe)) {
        warnings.push({
          axis: f.axis,
          value: v,
          message: `filter value ${JSON.stringify(v)} on ${f.axis} is not in `
            + `the current taxonomy — will match 0 rows unless newly added`,
        });
      }
    }
  }
  return warnings;
}

export default async function handler(req, res) {
  const access = await requireAppAccess(req, res, 'dataverse-bulk-export');
  if (!access) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const spec = req.body && req.body.querySpec;

  // §2.1 — validate first; 422 + the full violation list, never a 500.
  const check = validateQuerySpec(spec);
  if (!check.valid) {
    return res.status(check.status).json(check.body);
  }

  try {
    // Live taxonomy → operational resolver + unknown-literal warnings.
    const tax = await fetchLiveTaxonomy();
    const resolver = buildResolver(tax);

    const markedIsolation = testRequestIsolationEnabled();
    const compileOptions = { resolver, excludeMarkedTestRequests: markedIsolation };
    const compiled = compile(spec, compileOptions);

    // FAIL-LOUD: excludeOperational requested but a label did not resolve ⇒
    // refuse (never mint a token that /run would execute with operational
    // rows silently included). §3b/§9.
    if (spec.excludeOperational && compiled.requiresResolver) {
      return res.status(422).json({
        error: 'OPERATIONAL_EXCLUSION_UNRESOLVED',
        message: 'excludeOperational=true but one or more operational labels '
          + '(Office/Site Visit, Phone, Research Reviewer, Honorarium) did not '
          + 'resolve against the live taxonomy. Refusing to preview a spec '
          + 'whose run would silently include operational rows.',
        appliedRules: compiled.appliedRules,
      });
    }

    const warnings = taxonomyWarnings(spec, tax);

    // TRUE total (FetchXML aggregate, never /$count). Era split only when
    // the spec is era-agnostic — for an already era-scoped spec the other
    // era is out of scope and migrated+native==total would false-alarm
    // (Codex S160 P2).
    const eraScoped = spec.eraScope && spec.eraScope !== 'all';
    const countOf = (c) =>
      fetchXmlAggregateCount(ENTITY_SET, c.countFetchXml, compiled.countAlias);

    // Loud-exclusion waterfall (the tool's core honesty promise — a
    // surprising-but-correct number must never be misread):
    //   matched      = user filters + eraScope ONLY (no operational/test)
    //   afterOp      = + operational exclusion (as the user set it)
    //   afterMarked  = + marked Test Request exclusion (only while
    //                  TEST_REQUEST_ISOLATION is on; deployment-owned)
    //   exported     = + test-record exclusion = trueTotal (full spec)
    // Attribution is SEQUENTIAL (operational, marked, then legacy test); a
    // row matching more than one is counted at the first step that removes
    // it, never doubled.
    const unmarkedOptions = { resolver, excludeMarkedTestRequests: false };
    const matchedCompiled = compile(
      { ...spec, excludeOperational: false, excludeTestRecords: false },
      unmarkedOptions);
    const afterOpCompiled = compile(
      { ...spec, excludeTestRecords: false }, unmarkedOptions);
    // Appended last so the positional count order is unchanged while off.
    const afterMarkedCount = () => (markedIsolation
      ? [countOf(compile({ ...spec, excludeTestRecords: false }, compileOptions))]
      : []);

    let trueTotal, matched, afterOperational, afterMarked, eraSplit;
    if (eraScoped) {
      [trueTotal, matched, afterOperational, afterMarked] = await Promise.all([
        countOf(compiled), countOf(matchedCompiled), countOf(afterOpCompiled),
        ...afterMarkedCount(),
      ]);
      eraSplit = { scope: spec.eraScope, count: trueTotal, otherEraOutOfScope: true };
    } else {
      let migrated, native;
      [trueTotal, matched, afterOperational, migrated, native, afterMarked] = await Promise.all([
        countOf(compiled), countOf(matchedCompiled), countOf(afterOpCompiled),
        countOf(compile({ ...spec, eraScope: 'migrated' }, compileOptions)),
        countOf(compile({ ...spec, eraScope: 'native' }, compileOptions)),
        ...afterMarkedCount(),
      ]);
      eraSplit = { migrated, native, reconciles: migrated + native === trueTotal };
    }
    if (!markedIsolation) afterMarked = afterOperational;

    // FAIL LOUD on a broken count invariant — exclusions only ever ADD
    // filter conditions, so the waterfall MUST be monotone non-increasing:
    // matched ≥ afterOperational ≥ afterMarked ≥ trueTotal. A violation means a compiler
    // / count-order / Dataverse regression; clamping it to 0 would emit a
    // plausible-wrong composition (the exact failure this tool exists to
    // prevent — Codex S161 P2). Surfaces via the existing catch → 502.
    if (![matched, afterOperational, afterMarked, trueTotal].every(Number.isFinite)
        || !(matched >= afterOperational && afterOperational >= afterMarked
          && afterMarked >= trueTotal)) {
      const e = new Error(
        `count invariant violated (matched=${matched} `
        + `afterOperational=${afterOperational} afterMarked=${afterMarked} `
        + `exported=${trueTotal})`);
      e.name = 'CountInvariantError';
      throw e;
    }

    const composition = {
      matched,
      excludedOperational: spec.excludeOperational
        ? matched - afterOperational : 0,
      ...(markedIsolation ? {
        excludedMarkedTestRequests: afterOperational - afterMarked,
        markedTestRequestsApplied: true,
      } : {}),
      excludedTestRecords: spec.excludeTestRecords
        ? afterMarked - trueTotal : 0,
      exported: trueTotal,
      operationalApplied: !!spec.excludeOperational,
      testRecordsApplied: !!spec.excludeTestRecords,
      sequencing: markedIsolation
        ? 'Sequential attribution (operational, then marked Test Requests, '
          + 'then Foundation-applicant test records). A row matching more than '
          + 'one is counted at the first step, never double-counted.'
        : 'Sequential attribution (operational, then test records — '
          + 'the compiler order). A row that is both is counted at the '
          + 'operational step, never double-counted.',
    };

    const { token, expiresInSec } = await mintResultToken(spec, { trueTotal });

    return res.status(200).json({
      trueTotal,
      composition,
      eraSplit,
      compiledFetchXml: compiled.fetchXml,
      countFetchXml: compiled.countFetchXml,
      appliedRules: compiled.appliedRules,
      taxonomyWarnings: warnings,
      estimate: {
        rows: trueTotal,
        note: trueTotal > 50000
          ? 'Exceeds the 50,000-row hard cap — the run will be truncated '
            + '(loud). Narrow by program / year / status / institution.'
          : 'Within hard limits.',
      },
      compositionNote:
        'True total + era composition shown pre-run. The per-row disclosure '
        + '(UNCLASSIFIED set, exact Option-B program roll-up $, decline '
        + 'trifurcation, institution resolution) is discovered from returned '
        + 'values and baked into the artifact Methods sheet at /run — '
        + 'sequenced, never hidden.',
      resultToken: token,
      resultTokenExpiresInSec: expiresInSec,
    });
  } catch (err) {
    // Sanitized client payload; raw error to the server log only (Codex
    // S160 P2 — lower-layer errors can carry a truncated Dataverse body).
    const code = err && err.status === 422 ? 'INVALID_QUERYSPEC'
      : err && err.name === 'FetchXmlError' ? 'TRUE_COUNT_FAILED'
        : 'PREVIEW_FAILED';
    console.error('[dataverse-export/preview] failed:', err);
    if (code === 'INVALID_QUERYSPEC') return res.status(422).json(err.body);
    return res.status(code === 'TRUE_COUNT_FAILED' ? 502 : 500).json({
      error: code,
      message: 'Refusing to show a guessed total. Retry; if the result '
        + 'exceeds the 50,000 aggregate-count limit, narrow the filter.',
    });
  }
}
