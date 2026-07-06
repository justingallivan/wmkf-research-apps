/**
 * ContactEnrichmentService — email-adjudication cluster.
 *
 * Stage 3 of the ContactEnrichmentService decomposition
 * (docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md). Behavior-freeze, pure
 * code motion: the 5 email-adjudication / contact-lead helpers moved verbatim out
 * of contact-enrichment-service.js; internal `this._x(...)` self-calls became
 * direct sibling-function calls. The facade keeps a thin delegating wrapper for
 * each. Depends only on domain-evidence (`emailDomainRelatedToAny`) and constants
 * (`SEARCH_EMAIL_SOURCES`) — both stateless.
 */

const { emailDomainRelatedToAny } = require('./domain-evidence');
const { SEARCH_EMAIL_SOURCES } = require('./constants');

function markEmailContested(ce, reason) {
  if (!ce?.email) return;
  ce.emailSource = 'search_contested';
  ce.emailPersistAllowed = true;
  ce.websitePersistAllowed = false;
  ce.contactStatus = null;
  ce.contactStatusReason = reason || 'search_contested';
}

function readjudicateNameMismatchRejectedEmail(ce) {
  if (!ce || ce.email) return;
  const plausibleDomains = Array.isArray(ce.plausibleInstitutionDomains) ? ce.plausibleInstitutionDomains : [];
  if (!plausibleDomains.length) return;
  const tr = ce.tierResults || {};
  for (const source of ['claude_search', 'serp_search']) {
    const r = tr[source];
    if (!r || r.emailRejectedReason !== 'name_mismatch' || !r.rejectedEmail) continue;
    if (!emailDomainRelatedToAny(r.rejectedEmail, plausibleDomains)) continue;
    ce.email = r.rejectedEmail;
    ce.emailIsRecent = true;
    markEmailContested(ce, 'name_mismatch_plausible_contested');
    if (r.facultyPageUrl && !ce.facultyPageUrl) ce.facultyPageUrl = r.facultyPageUrl;
    if (r.website && !ce.website) ce.website = r.website;
    return;
  }
}

// ---- Slice 2a: quarantined contact leads (docs/REVIEWER_CONTACT_LEADS_SPEC.md) ----

/**
 * Single push point for a contact lead. Quarantine guarantee: it FORCE-sets
 * `persistable: false` (no caller can override it), normalizes the spec shape,
 * and dedups by (type, value, source). Leads are staff-facing breadcrumbs only
 * — they never populate email/website/facultyPageUrl or any *_PersistAllowed
 * flag, never make an unresolved identity saveable, and never reach an invite
 * (SPEC §7). Mutates `ce.contactLeads` in place.
 */
function addContactLead(ce, lead = {}) {
  if (!ce || !lead || !lead.value) return;
  if (!Array.isArray(ce.contactLeads)) ce.contactLeads = [];
  const value = String(lead.value).trim();
  if (!value) return;
  const type = lead.type || 'email'; // email | website | faculty_page | profile
  const source = lead.source || null;
  const dupe = ce.contactLeads.some((l) => l.type === type && l.value === value && l.source === source);
  if (dupe) return;
  ce.contactLeads.push({
    type,
    value,
    sourceUrl: lead.sourceUrl || null,
    source,
    confidence: lead.confidence || 'low', // high | medium | low | rejected
    persistable: false, // INVARIANT — a lead is never a sendable contact
    rejectedReason: lead.rejectedReason || null,
    warnings: Array.isArray(lead.warnings) ? lead.warnings : [],
    evidence: lead.evidence && typeof lead.evidence === 'object' ? lead.evidence : {},
  });
}

/**
 * Slice 2a: surface already-fetched-but-discarded contacts as quarantined
 * leads — NO new network calls. Reads the markers the tiers already stamped on
 * `tierResults` (identity-anchor contradiction + name-mismatch, the latter with
 * the value preserved on `rejectedEmail` before the in-place null) and promotes
 * any faculty/profile page found when no usable email survived. Runs in
 * _finalize AFTER _validateEmailAgainstVerifiedDomain (which captures the
 * verified-domain-contradiction class itself, before it nulls the fields).
 */
function collectContactLeads(ce) {
  if (!ce) return;
  // NOTE: this runs regardless of whether a primary email was resolved. A
  // fully-resolved candidate can still carry rejected-tier leads — a tier that
  // ran before the winning tier may have discarded a contact — and surfacing
  // those quarantined discards is intended (they are audit/staff breadcrumbs,
  // never the shown contact). The has_page_no_email page lead below is the only
  // part gated on `!ce.email`, so a resolved candidate is not given a duplicate
  // page lead for the contact it already shows.
  const tr = ce.tierResults || {};
  for (const source of ['claude_search', 'serp_search']) {
    const r = tr[source];
    if (!r || typeof r !== 'object') continue;
    // Anchor contradiction: the whole result is a different person — every
    // field is a rejected lead (kept for audit/staff, never the primary).
    if (r.rejectedReason === 'identity_anchor_contradiction') {
      const sourceUrl = r.facultyPageUrl || r.website || null;
      if (r.email) addContactLead(ce, { type: 'email', value: r.email, source, sourceUrl, confidence: 'rejected', rejectedReason: 'identity_anchor_contradiction' });
      if (r.facultyPageUrl) addContactLead(ce, { type: 'faculty_page', value: r.facultyPageUrl, source, sourceUrl: r.facultyPageUrl, confidence: 'rejected', rejectedReason: 'identity_anchor_contradiction' });
      if (r.website) addContactLead(ce, { type: 'website', value: r.website, source, sourceUrl: r.website, confidence: 'rejected', rejectedReason: 'identity_anchor_contradiction' });
    }
    // Name-mismatch email: local part didn't match this person; the value was
    // preserved on rejectedEmail by the pre-null capture hook in each tier.
    if (r.emailRejectedReason === 'name_mismatch' && r.rejectedEmail) {
      if (ce.emailSource === 'search_contested' && String(ce.email || '').toLowerCase() === String(r.rejectedEmail).toLowerCase()) continue;
      addContactLead(ce, { type: 'email', value: r.rejectedEmail, source, confidence: 'rejected', rejectedReason: 'name_mismatch' });
    }
  }
  // Faculty/profile page found but no usable email survived → low-confidence
  // breadcrumb so staff can open it (the has_page_no_email recovery).
  if (!ce.email) {
    if (ce.facultyPageUrl) addContactLead(ce, { type: 'faculty_page', value: ce.facultyPageUrl, source: ce.websiteSource || null, sourceUrl: ce.facultyPageUrl, confidence: 'low' });
    if (ce.website) addContactLead(ce, { type: 'website', value: ce.website, source: ce.websiteSource || null, sourceUrl: ce.website, confidence: 'low' });
  }
}

// Validate the captured contact email against identity-anchored institutional
// domains, with name-resolved domains allowed only to route into contested LOW.
// Slice 1b re-sources this domain from the OpenAlex author's institution homepage
// (`web.mit.edu` → `mit.edu`), ORCID/spine-anchored — a harder identity than the
// retired Google Scholar self-reported "Verified email at X" hint. This is the
// precise, signal-grounded replacement for the brittle lexical institution-NAME
// guard (which wrongly rejected the REAL olga.smirnova@mbi-berlin.de). Runs in
// _finalize, AFTER the OpenAlex metrics/domain are fetched. Keep-biased: only acts
// when a verified domain is known — a clear MATCH confirms the contact for
// persistence; a clear SEARCH-sourced contradiction is kept only as
// `search_contested` so send time requires staff confirmation. With no domain
// evidence it trusts the institution-scoped search and leaves the email untouched.
function validateEmailAgainstVerifiedDomain(ce) {
  if (!ce || !ce.email) return;
  const anchoredDomains = Array.isArray(ce.anchoredInstitutionDomains)
    ? ce.anchoredInstitutionDomains
    : [ce.verifiedInstitutionDomain].filter(Boolean);
  const plausibleDomains = Array.isArray(ce.plausibleInstitutionDomains)
    ? ce.plausibleInstitutionDomains
    : anchoredDomains;
  if (emailDomainRelatedToAny(ce.email, anchoredDomains)) {
    ce.emailPersistAllowed = true;
    return;
  }
  // Only a SEARCH-sourced email (Serp/Claude web scrape) is contested on a domain
  // contradiction — that is the namesake-collapse risk. ORCID/PubMed/affiliation
  // emails are researcher-maintained / publication-grounded and OUTRANK an OpenAlex
  // institutional-domain heuristic (a researcher may publish a personal or
  // cross-institution address), so a domain mismatch never overrides them.
  if (!SEARCH_EMAIL_SOURCES.has(ce.emailSource)) return;
  if (!anchoredDomains.length && !plausibleDomains.length) return;
  const reason = emailDomainRelatedToAny(ce.email, plausibleDomains)
    ? 'verified_domain_plausible_contested'
    : 'verified_domain_contradiction_contested';
  markEmailContested(ce, reason);
}

module.exports = {
  markEmailContested,
  readjudicateNameMismatchRejectedEmail,
  addContactLead,
  collectContactLeads,
  validateEmailAgainstVerifiedDomain,
};
