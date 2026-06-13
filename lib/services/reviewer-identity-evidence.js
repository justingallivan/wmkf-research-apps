const { OpenAlexService } = require('./openalex-service');
const { ORCIDService } = require('./orcid-service');
const { resolveIdentity } = require('./reviewer-identity-resolver');
const { ContactParser } = require('../utils/contact-parser');

const DEFAULT_ORCID_TIMEOUT_MS = 5000;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'college', 'department', 'for', 'inc', 'institute',
  'laboratory', 'lab', 'of', 'school', 'sciences', 'the', 'university', 'universite',
]);

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function hasTokenOverlap(left, right) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = tokenize(right);
  if (!leftTokens.size || !rightTokens.length) return false;
  return rightTokens.some((token) => leftTokens.has(token));
}

function normalizeOrcid(orcid) {
  if (!orcid) return null;
  return String(orcid).replace(/^https?:\/\/orcid\.org\//i, '').trim() || null;
}

function retryableStatus(status) {
  return status === 429 || status >= 500;
}

function composeSignals(signal, timeoutMs = DEFAULT_ORCID_TIMEOUT_MS) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    const err = new Error('orcid_timeout');
    err.code = 'orcid_timeout';
    timeoutController.abort(err);
  }, timeoutMs);

  if (!signal) {
    return { signal: timeoutController.signal, cleanup: () => clearTimeout(timeoutId) };
  }

  if (signal.aborted) {
    clearTimeout(timeoutId);
    return { signal, cleanup: () => {} };
  }

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return {
      signal: AbortSignal.any([signal, timeoutController.signal]),
      cleanup: () => clearTimeout(timeoutId),
    };
  }

  const combined = new AbortController();
  const abort = (event) => combined.abort(event?.target?.reason || new Error('orcid_aborted'));
  signal.addEventListener('abort', abort, { once: true });
  timeoutController.signal.addEventListener('abort', abort, { once: true });
  return {
    signal: combined.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', abort);
      timeoutController.signal.removeEventListener('abort', abort);
    },
  };
}

async function withOrcidRetry(operation, { signal, timeoutMs = DEFAULT_ORCID_TIMEOUT_MS } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const composed = composeSignals(signal, timeoutMs);
    try {
      return await operation(composed.signal);
    } catch (err) {
      lastError = err;
      if (err?.name === 'AbortError' || err?.code === 'orcid_timeout' || !retryableStatus(err?.status) || attempt > 0) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      composed.cleanup();
    }
  }
  throw lastError || new Error('ORCID request failed');
}

function fieldTextFor(suggestion = {}, proposalInfo = {}) {
  return [
    proposalInfo.primaryResearchArea,
    proposalInfo.title,
    suggestion.field,
    ...(Array.isArray(suggestion.expertiseAreas) ? suggestion.expertiseAreas : []),
  ].filter(Boolean).join(' ');
}

function scoreRecord(record, suggestion, fieldText) {
  const affiliationMatched = hasTokenOverlap(suggestion.suggestedInstitution, record.lastKnownInstitution);
  const topicMatched = hasTokenOverlap(fieldText, (record.topics || []).join(' '));
  return {
    record,
    affiliationMatched,
    topicMatched,
    score: (affiliationMatched ? 2 : 0) + (topicMatched ? 1 : 0),
  };
}

function stableRecordSort(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (Number(b.affiliationMatched) !== Number(a.affiliationMatched)) {
    return Number(b.affiliationMatched) - Number(a.affiliationMatched);
  }
  if (Number(b.topicMatched) !== Number(a.topicMatched)) {
    return Number(b.topicMatched) - Number(a.topicMatched);
  }
  return String(a.record.openAlexId || '').localeCompare(String(b.record.openAlexId || ''));
}

async function selectRecord(scored, suggestion, opts) {
  const matches = scored.filter((item) => item.score > 0).sort(stableRecordSort);
  if (!matches.length) return { abstainReason: 'no_openalex_affiliation_or_topic_match' };

  const bestScore = matches[0].score;
  const tied = matches.filter((item) => item.score === bestScore);
  if (tied.length === 1) return { selected: tied[0], collision: false };

  const direct = await fetchOrcidDirect(suggestion, opts);
  if (direct?.status === 'resolved' && direct.orcidId) {
    const directId = normalizeOrcid(direct.orcidId);
    const agreeing = tied.filter((item) => normalizeOrcid(item.record.orcid) === directId);
    if (agreeing.length === 1) {
      return { selected: agreeing[0], collision: true, directOrcid: direct };
    }
  }

  return {
    abstainReason: 'openalex_collision',
    collision: true,
    directOrcid: direct,
  };
}

async function fetchOrcidDirect(suggestion, { signal } = {}) {
  const clientId = process.env.ORCID_CLIENT_ID;
  const clientSecret = process.env.ORCID_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  return withOrcidRetry((orcidSignal) => ORCIDService.findContact({
    name: suggestion.name,
    affiliation: suggestion.suggestedInstitution,
    clientId,
    clientSecret,
    signal: orcidSignal,
    throwOnError: true,
  }), { signal });
}

// --- Work-grounding rescue (S249) -------------------------------------------
// When field-aware selection abstains with `no_openalex_affiliation_or_topic_match`
// — a CORRECT low-footprint researcher dropped because her coarse OpenAlex x_concepts
// don't token-overlap the proposal field text and Claude gave no usable institution —
// rescue her by checking her actual recent WORK TITLES (not just aggregate concepts).
// A directly-on-topic recent paper grounds the identity. This is PURELY ADDITIVE: it
// only runs when the normal path already abstained, so it can never change an existing
// confirmed/probable verdict. Safety (project-reviewer-verify-fail-dangerous): it
// requires a FULL forename agreement (strict) and EXACTLY ONE work-grounded candidate;
// the ceiling is `probable` (authorship_grounded alone). ORCID's own works list is a
// second, merge-immune corroborator (project-openalex-merge-use-orcid-works) used as a
// VETO/confirm — never to lower the bar.
const RESCUE_FETCH_LIMIT = 3;       // forename-agreeing candidates to probe (latency cap)
const RESCUE_WORKS_LIMIT = 15;      // recent works per source to title-match against
const ORCID_WORKS_VETO_MIN = 5;     // below this the ORCID list is "uninformative" — no veto

async function fetchOrcidWorks(orcid, { signal } = {}) {
  const id = normalizeOrcid(orcid);
  const clientId = process.env.ORCID_CLIENT_ID;
  const clientSecret = process.env.ORCID_CLIENT_SECRET;
  if (!id || !clientId || !clientSecret) return [];
  return withOrcidRetry(
    (orcidSignal) => ORCIDService.getWorks(id, clientId, clientSecret, { signal: orcidSignal, limit: RESCUE_WORKS_LIMIT }),
    { signal },
  );
}

// Returns { selected } (rescued record, same shape selectRecord emits + worksGrounded
// flags), { abstainReason } on an ambiguous multi-match, or null when no rescue applies
// (caller keeps the original safe abstain). Never throws — a fetch failure for one
// candidate just means that candidate isn't grounded.
async function rescueByWorkGrounding(scored, suggestion, fieldText, { signal } = {}) {
  if (!fieldText || !String(fieldText).trim()) return null;
  // Only probe records whose forename FULLY agrees — work-title overlap is weaker
  // evidence than an affiliation match, so the namesake gate is strict here.
  const candidates = (scored || [])
    .map((item) => item.record)
    .filter((record) => record && record.openAlexId && forenameFullyAgrees(suggestion.name, record.displayName))
    .slice(0, RESCUE_FETCH_LIMIT);
  if (!candidates.length) return null;

  const grounded = [];
  for (const record of candidates) {
    if (signal?.aborted) break;
    let titles = [];
    try {
      const works = await OpenAlexService.getWorksByAuthor(record.openAlexId, { signal, limit: RESCUE_WORKS_LIMIT });
      titles = (works.records || []).map((w) => w.title).filter(Boolean);
    } catch {
      continue; // OpenAlex hiccup for this candidate → not grounded, fail safe
    }
    if (!hasTokenOverlap(fieldText, titles.join(' '))) continue;

    // OpenAlex work titles are on-topic. Corroborate against the ORCID record's OWN
    // works (merge-immune). A well-populated ORCID list that is OFF-topic VETOES the
    // candidate (contaminated cluster / wrong person); a sparse list is uninformative.
    let orcidWorksCorroborated = false;
    if (normalizeOrcid(record.orcid)) {
      let orcidTitles = [];
      try {
        orcidTitles = await fetchOrcidWorks(record.orcid, { signal });
      } catch {
        orcidTitles = []; // ORCID outage → treat as uninformative, don't veto
      }
      if (orcidTitles.length) {
        const orcidOnTopic = hasTokenOverlap(fieldText, orcidTitles.join(' '));
        if (orcidOnTopic) {
          orcidWorksCorroborated = true;
        } else if (orcidTitles.length >= ORCID_WORKS_VETO_MIN) {
          continue; // informative ORCID corpus disagrees → veto this candidate
        }
        // else: sparse ORCID list, off-topic → uninformative, keep OpenAlex grounding
      }
    }

    grounded.push({
      record,
      affiliationMatched: false,
      topicMatched: false,
      worksGrounded: true,
      orcidWorksCorroborated,
    });
  }

  if (grounded.length === 1) return { selected: grounded[0], rescued: true };
  if (grounded.length > 1) return { abstainReason: 'rescue_work_grounding_collision', collision: true };
  return null;
}

// First given-name token, honorifics stripped, letters only, lowercased.
function givenNameToken(fullName) {
  const stripped = ContactParser.stripHonorifics(String(fullName || ''));
  const first = stripped.trim().split(/\s+/)[0] || '';
  return first.toLowerCase().normalize('NFKD').replace(/[^\p{L}]/gu, '');
}

// Strict forename agreement between the suggestion and the SELECTED OpenAlex record's
// displayName — REQUIRED before the resolver may promote on that record's ORCID-employment
// without an OpenAlex affiliation_match (Codex CRITICAL): selection is institution/topic-token
// based with NO name gate, so a fabricated wrong-forename ("Olaf Smirnova") could select a real
// same-surname namesake ("Olga Smirnova") and inherit its ORCID. Passes ONLY when BOTH sides
// carry a FULL given name (≥2 letters, not an initial) and they're equal. An initial-only record
// (OpenAlex "O. Smirnova") fails closed — an initial cannot confirm a full forename.
function forenameFullyAgrees(suggestionName, recordDisplayName) {
  const a = givenNameToken(suggestionName);
  const b = givenNameToken(recordDisplayName);
  if (a.length < 2 || b.length < 2) return false;
  return a === b;
}

// True only when BOTH forenames are full (≥2 chars) AND differ — the
// fabrication signature ("Alfred" vs "Alain"). An initial-only record ("U." for
// "Ursula") does NOT contradict: it can't disconfirm the full forename, and the
// memory's rule (project-reviewer-verify-fail-dangerous) accepts an initial-only
// match WHEN a 2nd independent signal corroborates (affiliation / ORCID
// employment). This is the demoter for the affiliation/topic spine promotions —
// `forenameFullyAgrees` (above) over-blocked real reviewers whose OpenAlex record
// is stored as an initial (S236 regression on Ursula Keller / Robert Sang).
function forenamesContradict(suggestionName, recordDisplayName) {
  const a = givenNameToken(suggestionName);
  const b = givenNameToken(recordDisplayName);
  if (a.length < 2 || b.length < 2) return false;
  return a !== b;
}

function institutionMatchesAny(claimedInstitution, profile) {
  if (!claimedInstitution || !profile) return false;
  const affiliations = Array.isArray(profile.affiliations) ? profile.affiliations : [];
  const candidates = [
    profile.currentAffiliation,
    ...affiliations.map((a) => a.organization),
  ].filter(Boolean);
  return candidates.some((inst) => hasTokenOverlap(claimedInstitution, inst));
}

async function fetchSelectedOrcidProfile(record, { signal } = {}) {
  const orcid = normalizeOrcid(record?.orcid);
  const clientId = process.env.ORCID_CLIENT_ID;
  const clientSecret = process.env.ORCID_CLIENT_SECRET;
  if (!orcid || !clientId || !clientSecret) return null;
  return withOrcidRetry((orcidSignal) => ORCIDService.getProfile(orcid, clientId, clientSecret, { signal: orcidSignal }), { signal });
}

function anchor(type, weight, value, parserOutput = {}) {
  return {
    type,
    weight,
    value: value || null,
    canonicalKey: value ? `${type}:${value}` : null,
    parserOutput,
    verifier: 'reviewerIdentityEvidence@1.0.0',
    verdict: 'pass',
  };
}

function buildAnchors({ selected, suggestion, orcidProfile, directOrcid, collision }) {
  const anchors = [];
  const record = selected.record;
  const orcid = normalizeOrcid(record.orcid);
  const employmentCorroborated = institutionMatchesAny(suggestion.suggestedInstitution, orcidProfile);

  if (selected.affiliationMatched) {
    anchors.push(anchor('affiliation_match', employmentCorroborated ? 'strong' : 'weak', record.lastKnownInstitution, {
      claimedInstitution: suggestion.suggestedInstitution || null,
      openAlexInstitution: record.lastKnownInstitution || null,
    }));
  }

  if (selected.worksGrounded) {
    // S249 rescue: the selected author's recent WORK TITLES (and, when present and
    // informative, the ORCID record's own works) overlap the proposal field — a
    // forename-gated work-grounded match for a low-footprint researcher whose aggregate
    // x_concepts missed. STRONG → resolver reaches `probable` (or `confirmed` only if
    // ORCID employment also corroborates). The selected record carries no
    // affiliation/topic anchor, so this is the sole positive signal by design.
    anchors.push(anchor('authorship_grounded', 'strong', record.openAlexId, {
      matchedAgainst: 'work_titles',
      source: selected.orcidWorksCorroborated ? 'openalex_works+orcid_works' : 'openalex_works',
    }));
  }

  if (selected.topicMatched) {
    anchors.push(anchor('topic_match', 'weak', record.openAlexId, {
      topics: record.topics || [],
    }));
  }

  if (orcid) {
    anchors.push(anchor('orcid_present', 'weak', orcid, {
      source: 'openalex',
    }));
  }

  if (employmentCorroborated) {
    anchors.push(anchor('orcid_employment_corroborated', 'strong', orcid, {
      currentAffiliation: orcidProfile?.currentAffiliation || null,
    }));
  }

  const directId = normalizeOrcid(directOrcid?.orcidId);
  if (directId && orcid && directId === orcid) {
    anchors.push(anchor('cross_source_orcid_agreement', 'weak', orcid, {
      openAlexOrcid: orcid,
      orcidSearchOrcid: directId,
    }));
  }

  return {
    anchors,
    metadata: {
      collision: !!collision,
      crossSourceOrcidDisagreement: !!(directId && orcid && directId !== orcid),
    },
  };
}

// Plain-language note for the bottom of the candidate card: what corroborated the
// identity and (for `probable`) what kept it from `confirmed`. One sentence.
function buildIdentityNote(status, anchors = [], record = null, orcid = null) {
  const has = (type) => anchors.some((a) => a.type === type);
  const inst = record?.lastKnownInstitution || null;
  const idText = orcid ? `ORCID ${orcid}` : 'no public ORCID';

  if (status === 'confirmed' || status === 'probable') {
    const corroborated = [];
    if (has('affiliation_match')) corroborated.push(inst ? `affiliation (${inst})` : 'affiliation');
    if (has('authorship_grounded')) corroborated.push('work-grounded authorship');
    if (has('orcid_employment_corroborated')) corroborated.push('current ORCID employment');
    if (has('cross_source_orcid_agreement')) corroborated.push('cross-source ORCID agreement');
    if (has('topic_match')) corroborated.push('research-topic overlap');
    const corroText = corroborated.length ? corroborated.join(', ') : 'name match only';
    if (status === 'confirmed') {
      return `Identity confirmed (${idText}): corroborated by ${corroText}.`;
    }
    const missing = [];
    if (!has('topic_match')) missing.push('research-topic overlap');
    if (!has('orcid_employment_corroborated')) missing.push('current-employment confirmation');
    const missingText = missing.length ? ` Not fully confirmed because ${missing.join(' and ')} could not be verified.` : '';
    return `Identity probable (${idText}): corroborated by ${corroText}.${missingText} Verify identity before outreach.`;
  }
  if (status === 'ambiguous') {
    return 'Identity needs review: sources disagree on which researcher this name refers to (namesake risk). Confirm manually before use.';
  }
  return 'Identity not verified: could not confidently match this name to a single researcher (no affiliation/topic match, or multiple namesakes). Confirm manually before use.';
}

function abstainResult(reason, sources = {}) {
  const resolved = resolveIdentity({}, { identityAnchors: [], spine: { abstainReason: reason } });
  return {
    status: 'abstain',
    resolverStatus: resolved.status,
    orcid: null,
    selectedRecord: null,
    anchors: [],
    sources,
    reason,
    identityNote: buildIdentityNote(resolved.status, [], null, null),
    identity: resolved,
  };
}

let _orcidCredsWarned = false;

class ReviewerIdentityEvidence {
  static async evaluateSuggestion(suggestion = {}, { proposalInfo = {}, signal } = {}) {
    if (!_orcidCredsWarned && !(process.env.ORCID_CLIENT_ID && process.env.ORCID_CLIENT_SECRET)) {
      _orcidCredsWarned = true;
      console.warn('[identity-spine] ORCID_CLIENT_ID/SECRET absent — employment corroboration disabled; spine will degrade toward needs-review (fails safe). See docs/CREDENTIALS_RUNBOOK.md.');
    }
    const sources = { openalex: 'not_run', orcid: 'not_run' };
    let openAlexResult;

    try {
      openAlexResult = await OpenAlexService.searchAuthors(suggestion.name, { signal, limit: 10 });
      sources.openalex = 'ok';
    } catch (err) {
      sources.openalex = err?.name === 'AbortError' ? 'timeout' : 'error';
      return abstainResult('openalex_outage', sources);
    }

    const fieldText = fieldTextFor(suggestion, proposalInfo);
    const scored = (openAlexResult.records || []).map((record) => scoreRecord(record, suggestion, fieldText));
    let selection = await selectRecord(scored, suggestion, { signal });

    // S249 work-grounding rescue: a correct low-footprint researcher abstains here when her
    // coarse x_concepts miss the proposal field text and Claude gave no usable institution.
    // Re-test her actual recent work titles (forename-gated, ORCID-corroborated). Only on
    // THIS specific abstain — additive, never overrides an existing match.
    if (!selection.selected && selection.abstainReason === 'no_openalex_affiliation_or_topic_match') {
      try {
        const rescued = await rescueByWorkGrounding(scored, suggestion, fieldText, { signal });
        if (rescued) {
          selection = rescued;
          if (rescued.selected) sources.orcid = normalizeOrcid(rescued.selected.record.orcid) ? 'ok' : sources.orcid;
        }
      } catch {
        // Rescue is best-effort; on any failure keep the original safe abstain.
      }
    }

    if (!selection.selected) {
      if (selection.directOrcid) sources.orcid = 'ok';
      return abstainResult(selection.abstainReason || 'openalex_abstain', sources);
    }

    let orcidProfile = null;
    try {
      orcidProfile = await fetchSelectedOrcidProfile(selection.selected.record, { signal });
      sources.orcid = normalizeOrcid(selection.selected.record.orcid) ? 'ok' : 'not_run';
    } catch (err) {
      sources.orcid = err?.name === 'AbortError' ? 'timeout' : 'error';
      return abstainResult('orcid_outage', sources);
    }

    const directOrcid = selection.directOrcid || null;
    if (directOrcid) sources.orcid = 'ok';

    const { anchors, metadata } = buildAnchors({
      selected: selection.selected,
      suggestion,
      orcidProfile,
      directOrcid,
      collision: selection.collision || openAlexResult.totalCount > 1,
    });

    const identity = resolveIdentity(
      {
        name: suggestion.name,
        claimedInstitution: suggestion.suggestedInstitution || null,
      },
      {
        identityAnchors: anchors,
        spine: {
          collision: metadata.collision,
          crossSourceOrcidDisagreement: metadata.crossSourceOrcidDisagreement,
          // Gate for the ORCID-employment promotion (resolver): the selected record's forename
          // must FULLY agree with the suggestion before we trust its ORCID amid namesakes.
          forenameAgrees: forenameFullyAgrees(suggestion.name, selection.selected.record.displayName),
          // Demoter for the affiliation/topic promotions: true only on a full-forename
          // CONTRADICTION (not on initial-only). See forenamesContradict.
          forenameContradicts: forenamesContradict(suggestion.name, selection.selected.record.displayName),
        },
      },
    );

    return {
      status: identity.status,
      resolverStatus: identity.status,
      orcid: normalizeOrcid(selection.selected.record.orcid),
      selectedRecord: selection.selected.record,
      // Full ORCID employment history (org names, most-recent-first as ORCID returns
      // them) so a spine-verified candidate carries affiliationHistory for the
      // former-institution COI scan (deduplication-service). The PubMed path builds
      // this from article affiliations; the spine path's source is the ORCID profile.
      orcidAffiliations: Array.isArray(orcidProfile?.affiliations)
        ? orcidProfile.affiliations.map((a) => a && a.organization).filter(Boolean)
        : [],
      anchors,
      sources,
      reason: identity.evidenceSummary,
      identityNote: buildIdentityNote(identity.status, anchors, selection.selected.record, normalizeOrcid(selection.selected.record.orcid)),
      identity,
    };
  }

  static _internals = {
    tokenize,
    hasTokenOverlap,
    scoreRecord,
    selectRecord,
    rescueByWorkGrounding,
    fieldTextFor,
    forenameFullyAgrees,
    forenamesContradict,
  };
}

module.exports = {
  ReviewerIdentityEvidence,
  buildIdentityNote,
  // Forename agreement gates — the canonical fail-dangerous name guard (S231/S236).
  // Exported (additive; also still on `_internals` for existing tests) so other
  // identity paths reuse ONE implementation instead of re-deriving a weaker check
  // (Codex S240 #3): e.g. the structured-PI ORCID guard in proposal-pi-identity.js.
  forenameFullyAgrees,
  forenamesContradict,
};
