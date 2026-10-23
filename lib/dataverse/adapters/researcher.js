/**
 * Adapter: bibliometric write-back onto wmkf_potentialreviewers (the person).
 *
 * S213 appresearcher collapse: the bibliometric data that used to live on the
 * `wmkf_appresearcher` 1:1 sidecar now lives directly on the person row. This
 * module keeps its original method names (callers unchanged) but operates on
 * `wmkf_potentialreviewerses` + the bibliometric fields added in collapse Phase 1.
 * `affiliation` maps to the canonical `wmkf_primaryaffiliation` (500) — NOT the
 * legacy 100-char `wmkf_organizationname`. Identity fields (name, email) are NOT
 * written here — those belong to the person-identity adapter (potential-reviewer.js).
 * The stored email is read only to prove that a stronger source label describes
 * that exact address before upgrading provenance.
 *
 * (Folding this into potential-reviewer.js is a later tidy-up; kept separate now
 * to minimize caller churn during the collapse.)
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import * as odata from '../core/odata.js';
import { entitySet } from '../core/entity-registry.js';
import { adapterError } from '../core/errors.js';
// Address-provenance precedence lives with the send-gate classifier that defines the
// tiers, so the adapter cannot disagree with the gate about which source is stronger.
import { emailSourceUpgradeAllowed } from '../../utils/reviewer-invite.js';
import { translateDuplicateKeyError } from '../duplicate-key.js';
import { isConcreteEtag } from '../../utils/etag.js';
import { normalizeOrcid } from '../../utils/orcid-normalize.js';

const ENTITY_SET = entitySet('wmkf_potentialreviewerses');

// Bibliometric fields now carried on the person (collapse Phase 1).
const BIBLIO_SELECT = [
  'wmkf_potentialreviewersid',
  'wmkf_emailaddress',
  'wmkf_primaryaffiliation',
  'wmkf_department',
  'wmkf_orcid',
  'wmkf_orcidurl',
  'wmkf_googlescholarid',
  'wmkf_googlescholarurl',
  'wmkf_hindex',
  'wmkf_i10index',
  'wmkf_totalcitations',
  'wmkf_website',
  'wmkf_facultypageurl',
  'wmkf_keywords',
  'wmkf_emailsource',
  'wmkf_lastchecked',
  'wmkf_metricsupdatedat',
  'wmkf_contactenrichedat',
  'wmkf_contactenrichmentsource',
  'wmkf_identitystatus',
  'wmkf_identityverifiedanchorsjson',
  'wmkf_identityconfidenceband',
  'wmkf_identityresolverversion',
  'wmkf_identityresolvedat',
  'wmkf_identityevidencesummary',
];

const IDENTITY_BINDING_FIELDS = Object.freeze([
  'wmkf_identitybindingversion',
  'wmkf_identitybindingsource',
  'wmkf_identitybindinganchor',
  'wmkf_identityboundat',
  'wmkf_identityderivedbindingversion',
  'wmkf_identityfieldlineagejson',
]);

const IDENTITY_LINEAGE_VALUE_FIELDS = Object.freeze([
  'wmkf_googlescholarid',
  'wmkf_googlescholarurl',
  'wmkf_hindex',
  'wmkf_i10index',
  'wmkf_totalcitations',
  'wmkf_orcid',
  'wmkf_orcidurl',
]);

const IDENTITY_DECISION_FIELDS = Object.freeze([
  'wmkf_identitystatus',
  'wmkf_identityconfidenceband',
  'wmkf_identityresolverversion',
  'wmkf_identityresolvedat',
  'wmkf_identityevidencesummary',
  'wmkf_identityverifiedanchorsjson',
]);

const IDENTITY_BINDING_SELECT = Object.freeze([
  'wmkf_potentialreviewersid',
  ...IDENTITY_BINDING_FIELDS,
  ...IDENTITY_LINEAGE_VALUE_FIELDS,
  ...IDENTITY_DECISION_FIELDS,
]);

const IDENTITY_BINDING_COMPLETE_PATCH_FIELDS = Object.freeze([
  ...IDENTITY_BINDING_FIELDS,
  ...IDENTITY_LINEAGE_VALUE_FIELDS,
  ...IDENTITY_DECISION_FIELDS,
]);
const IDENTITY_BINDING_PATCH_FIELDS = new Set(IDENTITY_BINDING_COMPLETE_PATCH_FIELDS);

function pruneEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

function isEmpty(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

// Hard Dynamics caps on the FREE-TEXT string columns this adapter writes — a value
// over the cap 400s the WHOLE write (observed prod: req 1002833, "Hongjun Song", a
// long multi-institution OpenAlex affiliation). Caps are the ACTUAL schema maxLengths
// (lib/dataverse/schema/wave6/02_wmkf_potentialreviewers_bibliometric.json), not
// guesses. Only free-text fields are listed: an enrichment string can plausibly
// overflow them, and ellipsis-truncation keeps them legible. Structured columns
// (orcid/url/scholar-id, the URL fields) are deliberately omitted — they're bounded
// upstream and a mid-string ellipsis would corrupt a URL/ID rather than help; if one
// ever 400s it needs a drop-not-truncate strategy, not this. Mirrors the
// wmkf_primaryaffiliation:500 entry in potential-reviewer.js FIELD_MAX.
const FIELD_MAX = {
  wmkf_primaryaffiliation: 500,
  wmkf_department: 255,
};
function clampField(key, v) {
  const max = FIELD_MAX[key];
  if (max && typeof v === 'string' && v.length > max) {
    return v.slice(0, max - 1).trimEnd() + '…';
  }
  return v;
}

/**
 * Read the bibliometric fields for a person. Returns the person row (bibliometric
 * subset), or null. (Name kept for call-site compatibility — the "potential
 * reviewer" IS the row now, so this is just a by-id read.)
 */
export async function getByPotentialReviewer(potentialReviewerId) {
  if (!potentialReviewerId) return null;
  try {
    return await DynamicsService.getRecord(ENTITY_SET, potentialReviewerId, {
      select: odata.select(BIBLIO_SELECT),
    });
  } catch {
    return null;
  }
}

/**
 * Write the bibliometric snapshot onto the person (1:1 — no separate row).
 * Metric fields (hIndex, i10Index, totalCitations) always overwrite (snapshots);
 * other fields fill empty only (preserve manual edits). Identity fields
 * (name/email/normalizedName) are ignored here. Returns { id, created:false }.
 *
 * The PATCH is ETag-conditional whenever the read row carries an `_etag`
 * (S530) — not only for the email-source upgrade — so a staff edit landing
 * between the read and the write wins: the write retries once against a
 * fresh read on a 412, recomputing fill-if-empty and the source-upgrade
 * decision from that fresh row. No `_etag` on the read row (test fixtures
 * that don't model one) retains pre-S530 behavior only for the manual/legacy
 * caller contract. Automated callers opt into `automatedIdentityDecision`: a
 * concrete ETag is mandatory, protected rows require overlapping validated
 * person anchors, and optional `expectedStoredEmail` pins the original owner
 * through the initial read and conflict retry. Decision and enrichment share
 * one conditional PATCH; confirmed decision metadata stays immutable.
 */
export async function upsertByPotentialReviewer(potentialReviewerId, {
  email,
  emailSource,
  orcid,
  orcidUrl,
  googleScholarId,
  googleScholarUrl,
  hIndex,
  i10Index,
  totalCitations,
  affiliation,
  department,
  website,
  facultyPageUrl,
  keywords,
}, options = {}) {
  const { actingUserSystemId, automatedIdentityDecision, expectedStoredEmail } = options;
  const pinExpectedStoredEmail = Object.prototype.hasOwnProperty.call(options, 'expectedStoredEmail');
  if (!potentialReviewerId) {
    throw new Error('researcher adapter: potentialReviewerId is required');
  }
  if (automatedIdentityDecision?.decision
    && !IDENTITY_DECISION_STATUSES.has(automatedIdentityDecision.decision.status)) {
    throw new Error('researcher.upsertByPotentialReviewer: known automated decision status required');
  }
  if (automatedIdentityDecision?.persistDecision && !automatedIdentityDecision.decision) {
    throw new Error('researcher.upsertByPotentialReviewer: known automated decision status required');
  }
  const now = new Date().toISOString();

  const metrics = pruneEmpty({
    wmkf_hindex: hIndex,
    wmkf_i10index: i10Index,
    wmkf_totalcitations: totalCitations,
  });
  const hasMetrics = Object.keys(metrics).length > 0;

  const fillIfEmpty = pruneEmpty({
    wmkf_emailsource: emailSource,
    wmkf_orcid: orcid,
    wmkf_orcidurl: orcidUrl,
    wmkf_googlescholarid: googleScholarId,
    wmkf_googlescholarurl: googleScholarUrl,
    wmkf_primaryaffiliation: clampField('wmkf_primaryaffiliation', affiliation),
    wmkf_department: clampField('wmkf_department', department),
    wmkf_website: website,
    wmkf_facultypageurl: facultyPageUrl,
    wmkf_keywords: keywords,
  });

  // Compute the PATCH body against a given row read. Extracted so the 412
  // retry below recomputes fill-if-empty + the source-upgrade decision from
  // the FRESH row rather than the stale one that lost the race — a retry
  // built from the original `existing` could re-clobber the very edit the
  // 412 was reporting.
  const buildDecisionPatch = (decision) => {
    if (!decision || !IDENTITY_DECISION_STATUSES.has(decision.status)) return null;
    let persisted = decision;
    if (decision.status === 'confirmed') {
      const detail = String(decision.evidenceSummary || '').replace(/^confirmed\s+[—-]\s*/i, '').trim();
      persisted = {
        ...decision,
        status: 'probable',
        confidenceBand: 'medium',
        evidenceSummary: `probable — automated high-confidence decision capped at persistence boundary${detail ? `; ${detail}` : ''}`,
      };
    }
    const compact = JSON.stringify((persisted.anchors || []).map((a) => ({
      type: a.type, canonicalKey: a.canonicalKey, sourceUrl: a.sourceUrl || null, verifier: a.verifier,
    })));
    return {
      wmkf_identitystatus: persisted.status,
      wmkf_identityconfidenceband: persisted.confidenceBand || null,
      wmkf_identityresolverversion: persisted.resolverVersion || null,
      wmkf_identityresolvedat: persisted.resolvedAt || null,
      wmkf_identityevidencesummary: (persisted.evidenceSummary || '').slice(0, 2000) || null,
      wmkf_identityverifiedanchorsjson: compact.length <= 50000 ? compact : '[]',
    };
  };

  const computeMerge = (row) => {
    if (automatedIdentityDecision !== undefined) {
      const storedStatus = String(row?.wmkf_identitystatus || '').trim().toLowerCase();
      const protectedState = storedStatus === 'confirmed' || storedStatus === 'probable';
      const incomingDecision = automatedIdentityDecision?.decision || null;
      if (pinExpectedStoredEmail) {
        const normalizedEmail = (value) => typeof value === 'string' && value.trim()
          ? value.trim().toLowerCase() : null;
        if (normalizedEmail(row?.wmkf_emailaddress) !== normalizedEmail(expectedStoredEmail)) {
          return { abstain: 'binding_conflict' };
        }
      }
      if (protectedState) {
        const parseStoredAnchors = () => {
          if (typeof row?.wmkf_identityverifiedanchorsjson !== 'string') return [];
          try { return JSON.parse(row.wmkf_identityverifiedanchorsjson); } catch { return []; }
        };
        const storedAnchors = personBindingAnchorKeys(parseStoredAnchors());
        const incomingAnchors = personBindingAnchorKeys(incomingDecision?.anchors);
        if (!storedAnchors.size || !incomingAnchors.size) {
          return { abstain: 'continuity_unproven' };
        }
        if (!anchorsOverlap(storedAnchors, incomingAnchors)) {
          return { abstain: 'binding_conflict' };
        }
        if (storedStatus === 'probable'
          && (!incomingDecision || ['unresolved', 'ambiguous'].includes(incomingDecision.status))) {
          return { abstain: 'probable_sticky' };
        }
      }
    }
    const merge = { ...metrics };
    if (hasMetrics) merge.wmkf_metricsupdatedat = now;
    merge.wmkf_lastchecked = now;
    for (const [k, v] of Object.entries(fillIfEmpty)) {
      if (isEmpty(row?.[k])) merge[k] = v;
    }

    // Manual and contested sources are explicit safety assertions and must be
    // AUTHORITATIVE — overwrite any stale trusted source (the other descriptive
    // fields stay fill-only to preserve staff edits). Without this, a row whose
    // address was downgraded to quick-check/research-only could still read ready from an
    // old `wmkf_emailsource` value on the live person record.
    if (emailSource === 'manual' || emailSource === 'search_contested') merge.wmkf_emailsource = emailSource;
    const incomingEmail = String(email || '').trim().toLowerCase();
    const sameStoredEmail = !!incomingEmail
      && incomingEmail === String(row?.wmkf_emailaddress || '').trim().toLowerCase();
    const storedSource = String(row?.wmkf_emailsource || '').trim().toLowerCase();

    // Provenance PRECEDENCE (S387). `wmkf_emailsource` is otherwise fill-if-empty, so the
    // FIRST source ever recorded for a person pinned their address tier forever: a reviewer
    // whose address was captured as `serp_search` on one request stayed `research_only` —
    // unsendable — even after another request's enrichment found the SAME address embedded
    // in their own PubMed affiliation string (`affiliation`, a quick-check source). Observed
    // live on request 1002874: the roster row said `affiliation` while the person row said
    // `serp_search`, so the reviewer could not be invited at all.
    //
    // Now a strictly stronger tier supersedes a weaker one. Preconditions are the ones the
    // narrow `scholarly_multi` upgrade this replaces already enforced, and they matter:
    //   - SAME address only. A source describes one specific address; promoting the tier
    //     while the address differs would relabel evidence onto a different string.
    //   - ETag-conditional, so a concurrent write cannot be clobbered by the upgrade.
    //   - strictly greater, so an equal tier never churns the value (and a staff attestation
    //     is not displaced by a same-tier machine source).
    //   - both sides KNOWN (`emailSourceTier` returns null otherwise), so an unrecognized
    //     source neither upgrades nor is upgraded.
    //   - the stored value is NOT a human assertion. `manual`/`staff_verified` are terminal
    //     against machine evidence (see `emailSourceUpgradeAllowed`): upgrading one to
    //     `ready` would delete that recipient's send-time acknowledgement across every
    //     request sharing this person row, including the one where a staffer vouched for the
    //     address. A human still supersedes a human via the unconditional overwrite above.
    // Downgrades stay explicit: only `manual`/`search_contested` overwrite above, because
    // those are safety assertions rather than evidence claims.
    const sourceUpgrade = sameStoredEmail
      && !!row?._etag
      && emailSourceUpgradeAllowed(emailSource, storedSource);
    if (sourceUpgrade) {
      merge.wmkf_emailsource = emailSource;
    }
    if (automatedIdentityDecision !== undefined && automatedIdentityDecision?.persistDecision) {
      const decisionPatch = buildDecisionPatch(automatedIdentityDecision.decision);
      if (decisionPatch) {
        const storedStatus = String(row?.wmkf_identitystatus || '').trim().toLowerCase();
        // A confirmed decision is immutable; compatible evidence may refresh
        // enrichment, but must not rewrite its attestation metadata.
        if (storedStatus !== 'confirmed') Object.assign(merge, decisionPatch);
      }
    }
    return { patch: merge };
  };

  // The PATCH is ETag-conditional whenever the row we read carries one — not
  // only for the email-source upgrade. Before S530 only that upgrade locked
  // the write, so a staff edit landing between this GET and the PATCH below
  // (e.g. a manual keyword correction) was silently overwritten by a
  // concurrent enrichment write. A row with no `_etag` (test fixtures that
  // don't model one) keeps the legacy behavior only outside the automated guard.
  const ifMatchOf = (row) => (typeof row?._etag === 'string' && row._etag ? { ifMatch: row._etag } : {});

  const readCurrent = () => DynamicsService.getRecord(ENTITY_SET, potentialReviewerId, {
    select: odata.select(BIBLIO_SELECT),
  });
  const existing = await readCurrent();
  const apply = async (row) => {
    const computed = computeMerge(row);
    if (computed.abstain) return { id: potentialReviewerId, created: false, updated: false, reason: computed.abstain };
    const patch = computed.patch || computed;
    if (Object.keys(patch).length === 0) {
      return automatedIdentityDecision !== undefined
        ? { id: potentialReviewerId, created: false, updated: false }
        : { id: potentialReviewerId, created: false };
    }
    if (automatedIdentityDecision !== undefined && !isConcreteEtag(row?._etag)) {
      throw adapterError('Automated person enrichment requires a current person ETag.', {
        code: 'identity_etag_missing', status: 409,
      });
    }
    await DynamicsService.updateRecord(ENTITY_SET, potentialReviewerId, patch, {
      actingUserSystemId,
      ...(automatedIdentityDecision !== undefined ? { ifMatch: row._etag } : ifMatchOf(row)),
    });
    return automatedIdentityDecision !== undefined
      ? { id: potentialReviewerId, created: false, updated: true }
      : { id: potentialReviewerId, created: false };
  };

  try {
    return await apply(existing);
  } catch (err) {
    if (err?.status !== 412) throw err;
    // An alternate-key collision, not a concurrency conflict — no re-read
    // will resolve it, and re-reading would mask the real error.
    if (translateDuplicateKeyError(err)) throw err;
    const fresh = await readCurrent();
    return await apply(fresh);
  }
}

/**
 * Edit bibliometric metadata on the person. `id` is the person's
 * wmkf_potentialreviewersid. Touches wmkf_lastchecked; advances
 * wmkf_metricsupdatedat only when a metric field is supplied.
 */
/**
 * @param {object} [options]
 * @param {string} [options.actingUserSystemId]
 * @param {string} [options.ifMatch] - row ETag for an optimistic-concurrency write.
 *   Opt-in: existing callers pass nothing and keep last-write-wins. Supplying it makes
 *   Dataverse reject the PATCH with 412 when ANY field on the row changed since the
 *   caller's read — required by callers whose write is only valid for the exact row
 *   state they validated (S387: a staff address attestation must not land on an address
 *   another session substituted after the check).
 */
export async function updateById(id, updates, { actingUserSystemId, ifMatch } = {}) {
  if (!id) throw new Error('researcher.updateById: id required');
  const map = {
    emailSource: 'wmkf_emailsource',
    orcid: 'wmkf_orcid',
    orcidUrl: 'wmkf_orcidurl',
    googleScholarId: 'wmkf_googlescholarid',
    googleScholarUrl: 'wmkf_googlescholarurl',
    hIndex: 'wmkf_hindex',
    i10Index: 'wmkf_i10index',
    totalCitations: 'wmkf_totalcitations',
    affiliation: 'wmkf_primaryaffiliation',
    department: 'wmkf_department',
    website: 'wmkf_website',
    facultyPageUrl: 'wmkf_facultypageurl',
    keywords: 'wmkf_keywords',
  };
  const payload = {};
  let touchesMetrics = false;
  for (const [k, v] of Object.entries(updates || {})) {
    if (k in map && v !== undefined) {
      payload[map[k]] = clampField(map[k], v);
      if (k === 'hIndex' || k === 'i10Index' || k === 'totalCitations') touchesMetrics = true;
    }
  }
  if (Object.keys(payload).length === 0) return;

  const existing = await DynamicsService.getRecord(ENTITY_SET, id, { select: odata.select(BIBLIO_SELECT) });
  const diff = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!fieldsEqual(existing?.[k], v)) diff[k] = v;
  }
  if (Object.keys(diff).length === 0) return;

  const now = new Date().toISOString();
  diff.wmkf_lastchecked = now;
  if (touchesMetrics) diff.wmkf_metricsupdatedat = now;
  await DynamicsService.updateRecord(ENTITY_SET, id, diff, {
    actingUserSystemId,
    ...(ifMatch ? { ifMatch } : {}),
  });
}

function fieldsEqual(a, b) {
  const norm = (x) => {
    if (x === null || x === undefined) return '';
    if (typeof x === 'string') return x.trim().toLowerCase();
    return String(x);
  };
  return norm(a) === norm(b);
}

export const IDENTITY_DECISION_ORIGIN = Object.freeze({
  SELF_REPORT: 'self_report',
  AUTOMATED: 'automated',
});

const IDENTITY_DECISION_STATUSES = new Set(['confirmed', 'probable', 'unresolved', 'ambiguous']);

function identityAnchorKeys(anchors) {
  return new Set((Array.isArray(anchors) ? anchors : [])
    .map((anchor) => String(anchor?.canonicalKey || '').trim().toLowerCase())
    .filter(Boolean));
}

// Automated overwrite continuity accepts only stable person identifiers.
// Keep legacy writeIdentityDecision's broader parser and semantics unchanged.
function personBindingAnchorKeys(anchors) {
  const keys = new Set();
  for (const anchor of Array.isArray(anchors) ? anchors : []) {
    const raw = anchor?.canonicalKey;
    if (typeof raw !== 'string') continue;
    const match = /^(orcid|openalex|scholar|orcid_present|orcid_employment_corroborated|cross_source_orcid_agreement|orcid_name_confirmed|authorship_grounded|topic_match):(.+)$/i.exec(raw.trim());
    if (!match) continue;
    const [, namespace, value] = match;
    const kind = namespace.toLowerCase();
    if (['orcid', 'orcid_present', 'orcid_employment_corroborated', 'cross_source_orcid_agreement', 'orcid_name_confirmed'].includes(kind)) {
      const normalized = normalizeOrcid(value);
      if (normalized.state === 'valid') {
        keys.add(`orcid:${normalized.id.toLowerCase()}`);
      }
    } else if (['openalex', 'authorship_grounded', 'topic_match'].includes(kind) && /^a[1-9]\d*$/i.test(value)) {
      keys.add(`openalex:${value.toUpperCase()}`);
    } else if (kind === 'scholar' && /^[a-z0-9_-]{1,100}$/i.test(value)) {
      keys.add(`scholar:${value}`);
    }
  }
  return keys;
}

function storedIdentityAnchorKeys(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return new Set();
  try {
    return identityAnchorKeys(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function anchorsOverlap(left, right) {
  for (const key of left) {
    if (right.has(key)) return true;
  }
  return false;
}

function assertIdentityOrigin(identityOrigin, allowedOrigins, operation) {
  if (!allowedOrigins.includes(identityOrigin)) {
    throw new Error(`${operation}: explicit identityOrigin required (${allowedOrigins.join(' or ')})`);
  }
}

/**
 * Write the CURRENT reviewer-identity decision onto the person. `identityOrigin`
 * is a transitional, server-only trust marker: only a reviewer self-report may
 * persist `confirmed`; automated decisions are persisted as at most `probable`.
 * `decision` is a ResolvedIdentity (lib/services/reviewer-identity-resolver.js).
 * verifiedAnchorsJson is a COMPACT projection (kept well under the Memo cap).
 */
export async function writeIdentityDecision(potentialReviewerId, decision, { actingUserSystemId, identityOrigin } = {}) {
  if (!potentialReviewerId) throw new Error('researcher.writeIdentityDecision: id required');
  if (!decision || !IDENTITY_DECISION_STATUSES.has(decision.status)) {
    throw new Error('researcher.writeIdentityDecision: known decision status required');
  }
  assertIdentityOrigin(
    identityOrigin,
    [IDENTITY_DECISION_ORIGIN.SELF_REPORT, IDENTITY_DECISION_ORIGIN.AUTOMATED],
    'researcher.writeIdentityDecision',
  );
  if (identityOrigin === IDENTITY_DECISION_ORIGIN.SELF_REPORT && decision.status !== 'confirmed') {
    throw new Error('researcher.writeIdentityDecision: self_report origin requires confirmed status');
  }

  let decisionToPersist = decision;
  if (identityOrigin === IDENTITY_DECISION_ORIGIN.AUTOMATED) {
    // Fail closed: every automated write must prove it will not overwrite a
    // stronger or differently-bound shared-person decision. Read errors and a
    // missing ETag intentionally propagate rather than falling back to
    // last-writer-wins.
    const cur = await DynamicsService.getRecord(ENTITY_SET, potentialReviewerId, {
      select: 'wmkf_potentialreviewersid,wmkf_identitystatus,wmkf_identityverifiedanchorsjson',
    });
    if (cur?.wmkf_identitystatus === 'confirmed') {
      return { updated: false, reason: 'confirmed_sticky' };
    }
    if (decision.status === 'confirmed') {
      const summaryDetail = String(decision.evidenceSummary || '')
        .replace(/^confirmed\s+[—-]\s*/i, '')
        .trim();
      decisionToPersist = {
        ...decision,
        status: 'probable',
        confidenceBand: 'medium',
        evidenceSummary: `probable — automated high-confidence decision capped at persistence boundary${summaryDetail ? `; ${summaryDetail}` : ''}`,
      };
    }
    if (cur?.wmkf_identitystatus === 'probable') {
      if (decisionToPersist.status === 'unresolved' || decisionToPersist.status === 'ambiguous') {
        return { updated: false, reason: 'probable_sticky' };
      }
      const storedAnchors = storedIdentityAnchorKeys(cur.wmkf_identityverifiedanchorsjson);
      const incomingAnchors = identityAnchorKeys(decisionToPersist.anchors);
      if (
        storedAnchors.size === 0
        || incomingAnchors.size === 0
        || !anchorsOverlap(storedAnchors, incomingAnchors)
      ) {
        return { updated: false, reason: 'binding_conflict' };
      }
    }
    if (!cur?._etag) {
      throw adapterError('Reviewer identity write requires a current person ETag.', {
        code: 'identity_etag_missing',
        status: 409,
      });
    }
    decisionToPersist = { ...decisionToPersist, _ifMatch: cur._etag };
  }
  const anchorsCompact = JSON.stringify(
    (decisionToPersist.anchors || []).map((a) => ({ type: a.type, canonicalKey: a.canonicalKey, sourceUrl: a.sourceUrl || null, verifier: a.verifier })),
  );
  const patch = {
    wmkf_identitystatus: decisionToPersist.status,
    wmkf_identityconfidenceband: decisionToPersist.confidenceBand || null,
    wmkf_identityresolverversion: decisionToPersist.resolverVersion || null,
    wmkf_identityresolvedat: decisionToPersist.resolvedAt || null,
    wmkf_identityevidencesummary: (decisionToPersist.evidenceSummary || '').slice(0, 2000) || null,
    wmkf_identityverifiedanchorsjson: anchorsCompact.length <= 50000 ? anchorsCompact : '[]',
  };
  await DynamicsService.updateRecord(ENTITY_SET, potentialReviewerId, patch, {
    actingUserSystemId,
    ...(decisionToPersist._ifMatch ? { ifMatch: decisionToPersist._ifMatch } : {}),
  });
  return { updated: true };
}

/**
 * Compatibility guard for the old blanket-clear call sites. Shared-person fields
 * cannot be cleared safely until stored lineage proves that the same automated
 * binding wrote each field. The current rows do not provide that proof, so
 * automated clears deliberately abstain.
 */
export async function clearIdentityFields(potentialReviewerId, fields, { actingUserSystemId, identityOrigin } = {}) {
  if (!potentialReviewerId) throw new Error('researcher.clearIdentityFields: id required');
  assertIdentityOrigin(identityOrigin, [IDENTITY_DECISION_ORIGIN.AUTOMATED], 'researcher.clearIdentityFields');
  if (!Array.isArray(fields) || fields.length === 0) return;
  // Fail closed on the read, then abstain for every stored state. Keeping the
  // read makes confirmed/probable protection explicit and prevents a future
  // caller from mistaking this compatibility shim for an unconditional no-op.
  const cur = await DynamicsService.getRecord(ENTITY_SET, potentialReviewerId, {
    select: 'wmkf_potentialreviewersid,wmkf_identitystatus',
  });
  return {
    cleared: false,
    reason: cur?.wmkf_identitystatus === 'confirmed'
      ? 'confirmed_sticky'
      : cur?.wmkf_identitystatus === 'probable'
        ? 'probable_sticky'
        : 'lineage_unavailable',
  };
}

/**
 * Fail-closed read for the versioned identity-binding writer. Dataverse supplies
 * `@odata.etag` outside `$select`; processAnnotations exposes it as `_etag`.
 * Unlike getByPotentialReviewer, read errors intentionally propagate.
 */
export async function getIdentityBindingForUpdate(potentialReviewerId) {
  if (!potentialReviewerId) throw new Error('researcher.getIdentityBindingForUpdate: id required');
  return DynamicsService.getRecord(ENTITY_SET, potentialReviewerId, {
    select: odata.select(IDENTITY_BINDING_SELECT),
  });
}

/**
 * Apply one complete, conditional identity-binding PATCH. Explicit nulls are
 * preserved. The strict allowlist prevents this narrow concurrency seam from
 * becoming a generic person-row writer.
 */
export async function patchIdentityBinding(
  potentialReviewerId,
  patch,
  { ifMatch, actingUserSystemId } = {},
) {
  if (!potentialReviewerId) throw new Error('researcher.patchIdentityBinding: id required');
  if (typeof ifMatch !== 'string' || !ifMatch.trim()) {
    throw new Error('researcher.patchIdentityBinding: non-empty ifMatch required');
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
    throw new Error('researcher.patchIdentityBinding: non-empty patch required');
  }
  const unknown = Object.keys(patch).filter((field) => !IDENTITY_BINDING_PATCH_FIELDS.has(field));
  if (unknown.length > 0) {
    throw new Error(`researcher.patchIdentityBinding: unsupported fields (${unknown.join(', ')})`);
  }
  const missingBindingFields = IDENTITY_BINDING_COMPLETE_PATCH_FIELDS.filter(
    (field) => !Object.prototype.hasOwnProperty.call(patch, field),
  );
  if (missingBindingFields.length > 0) {
    throw new Error(`researcher.patchIdentityBinding: incomplete identity patch (${missingBindingFields.join(', ')})`);
  }
  const undefinedFields = IDENTITY_BINDING_COMPLETE_PATCH_FIELDS.filter((field) => patch[field] === undefined);
  if (undefinedFields.length > 0) {
    throw new Error(`researcher.patchIdentityBinding: undefined identity fields (${undefinedFields.join(', ')})`);
  }

  await DynamicsService.updateRecord(ENTITY_SET, potentialReviewerId, patch, {
    ifMatch,
    actingUserSystemId,
  });
}

export const ENTITY_SET_NAME = ENTITY_SET;
