/**
 * Cross-store reviewer identity lookup — the read/matching core behind
 * /api/workbench/reviewer-lookup and the manual-add resolution preflight.
 *
 * Pure orchestration over the potential-reviewer + contact adapters: tiered
 * ORCID → email → name matching with ambiguity-aware (top:2) candidate helpers,
 * cross-store conflict detection, and reverse-link collision checks. NO auth, NO
 * HTTP, NO writes — callers must already be inside the Dynamics restriction
 * context (the route wraps in bypassDynamicsRestrictions). Extracted from the API
 * page (S237) so it is unit/smoke-testable without the next-auth import chain and
 * so manual-reviewer.js no longer imports a sibling route.
 */

import { ContactParser } from '../utils/contact-parser';
import { normalizeOrcid } from '../utils/orcid-normalize';
import * as potentialReviewerAdapter from '../dataverse/adapters/potential-reviewer';
import * as contactAdapter from '../dataverse/adapters/contact';

const MAX_EMAIL = 254;

function cleanString(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function normalizeEmail(email) {
  return cleanString(email, MAX_EMAIL).toLowerCase();
}

function sameId(a, b) {
  return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
}

function displayReviewer(row) {
  return row?.wmkf_name || [row?.wmkf_firstname, row?.wmkf_lastname].filter(Boolean).join(' ');
}

function displayContact(row) {
  return row?.fullname || [row?.firstname, row?.lastname].filter(Boolean).join(' ');
}

function nameConsistent(typed, row, source) {
  const rowName = source === 'contact' ? displayContact(row) : displayReviewer(row);
  const a = ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(typed || ''));
  const b = ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(rowName || ''));
  return ContactParser.namesMatch(a, b);
}

function contextForReviewer(row) {
  return {
    name: displayReviewer(row) || null,
    email: row?.wmkf_emailaddress || null,
    affiliation: row?.wmkf_primaryaffiliation || row?.wmkf_organizationname || null,
    active: row?.statecode === undefined ? true : row.statecode === 0,
    hasOrcid: !!row?.wmkf_orcid,
    cycleHint: null,
  };
}

function contextForContact(row) {
  return {
    name: displayContact(row) || null,
    email: row?.emailaddress1 || null,
    affiliation: null,
    active: row?.statecode === undefined ? true : row.statecode === 0,
    hasOrcid: !!row?.wmkf_orcid,
    cycleHint: null,
  };
}

function reviewerCandidate(row, matchKey) {
  return {
    source: 'reviewer',
    matchKey,
    reviewerId: row.wmkf_potentialreviewersid,
    contactId: row._wmkf_contact_value || null,
    context: contextForReviewer(row),
  };
}

function contactCandidate(row, matchKey) {
  return {
    source: 'contact',
    matchKey,
    reviewerId: null,
    contactId: row.contactid,
    context: contextForContact(row),
  };
}

function sortCandidates(candidates) {
  return [...candidates].sort((a, b) => Number(b.context?.active !== false) - Number(a.context?.active !== false));
}

// `viaNameMatch` is a FACT the producer declares, not a policy: true only when the
// reviewer id was surfaced SOLELY by a fallback name search (matchKey === 'name'),
// i.e. an ambiguous same-name candidate that persistence would never reuse or link
// unless email/ORCID also matched. Save-time COI screening uses it to avoid hard-
// rejecting a distinct new reviewer just because a namesake sits at the applicant
// institution; exact email/ORCID/linked references stay `false` and are screened.
function referencedReviewer(reviewerId, affiliation, viaNameMatch = false) {
  const id = typeof reviewerId === 'string' ? reviewerId.trim() : '';
  if (!id) return null;
  const trimmedAffiliation = typeof affiliation === 'string' ? affiliation.trim() : '';
  return { reviewerId: id, affiliation: trimmedAffiliation || null, viaNameMatch: !!viaNameMatch };
}

function referencedContact(contactId, viaNameMatch = false) {
  const id = typeof contactId === 'string' ? contactId.trim() : '';
  if (!id) return null;
  return { contactId: id, viaNameMatch: !!viaNameMatch };
}

function referencedReviewersFromCandidates(candidates = []) {
  const out = [];
  const seen = new Map();
  for (const candidate of candidates || []) {
    const viaNameMatch = candidate?.matchKey === 'name';
    const ref = referencedReviewer(candidate?.reviewerId, candidate?.context?.affiliation, viaNameMatch);
    if (!ref) continue;
    const key = ref.reviewerId.toLowerCase();
    if (seen.has(key)) {
      const existing = seen.get(key);
      if (!existing.affiliation && ref.affiliation) existing.affiliation = ref.affiliation;
      // Sticky-strong: an id referenced by ANY exact (email/ORCID/linked) match is
      // a real reuse/link target even if a name-search hit also surfaced it.
      if (existing.viaNameMatch && !ref.viaNameMatch) existing.viaNameMatch = false;
      continue;
    }
    seen.set(key, ref);
    out.push(ref);
  }
  return out;
}

function referencedContactsFromCandidates(candidates = []) {
  const out = [];
  const seen = new Map();
  for (const candidate of candidates || []) {
    const viaNameMatch = candidate?.matchKey === 'name';
    const ref = referencedContact(candidate?.contactId, viaNameMatch);
    if (!ref) continue;
    const key = ref.contactId.toLowerCase();
    if (seen.has(key)) {
      const existing = seen.get(key);
      // Sticky-strong mirrors referencedReviewersFromCandidates: any exact
      // email/ORCID/linked contact reference makes the id screenable.
      if (existing.viaNameMatch && !ref.viaNameMatch) existing.viaNameMatch = false;
      continue;
    }
    seen.set(key, ref);
    out.push(ref);
  }
  return out;
}

const CONFLICT_REVIEWER_ID_KEYS = new Set([
  'reviewerId',
  'existingReviewerId',
  'orcidReviewerId',
  'emailReviewerId',
]);

const CONFLICT_CONTACT_ID_KEYS = new Set([
  'contactId',
  'orcidContactId',
  'emailContactId',
  'reviewerContactId',
]);

function referencedReviewersFromConflictDetails(details = {}) {
  const out = [];
  const seen = new Set();
  for (const key of CONFLICT_REVIEWER_ID_KEYS) {
    const ref = referencedReviewer(details?.[key], null);
    if (!ref) continue;
    const dedupeKey = ref.reviewerId.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(ref);
  }
  return out;
}

function referencedContactsFromConflictDetails(details = {}) {
  const out = [];
  const seen = new Set();
  for (const key of CONFLICT_CONTACT_ID_KEYS) {
    const ref = referencedContact(details?.[key], false);
    if (!ref) continue;
    const dedupeKey = ref.contactId.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(ref);
  }
  return out;
}

function confidentOutcome(match) {
  return {
    outcome: 'confident',
    match,
    referencedReviewers: match?.reviewerId
      ? referencedReviewersFromCandidates([{ reviewerId: match.reviewerId, context: match.context }])
      : [],
    referencedContacts: match?.contactId
      ? [referencedContact(match.contactId, false)].filter(Boolean)
      : [],
  };
}

function candidatesOutcome(candidates) {
  const sorted = sortCandidates(candidates);
  return {
    outcome: 'candidates',
    candidates: sorted,
    referencedReviewers: referencedReviewersFromCandidates(sorted),
    referencedContacts: referencedContactsFromCandidates(sorted),
  };
}

function conflict(reason, details) {
  return {
    outcome: 'conflict',
    reason,
    details,
    referencedReviewers: referencedReviewersFromConflictDetails(details),
    referencedContacts: referencedContactsFromConflictDetails(details),
  };
}

async function collisionForContact(contactId, reviewerId = null) {
  if (!contactId) return null;
  const linked = await potentialReviewerAdapter.findByContactId(contactId);
  if (linked && (!reviewerId || !sameId(linked.wmkf_potentialreviewersid, reviewerId))) {
    return linked;
  }
  return null;
}

async function evaluateKey({ name, email, key, reviewerResult, contactResult }) {
  const candidates = [];
  if (reviewerResult.ambiguous) {
    for (const row of reviewerResult.rows || []) candidates.push(reviewerCandidate(row, key));
  }
  if (contactResult.ambiguous) {
    for (const row of contactResult.rows || []) candidates.push(contactCandidate(row, key));
  }
  if (reviewerResult.ambiguous || contactResult.ambiguous) {
    return candidatesOutcome(candidates);
  }

  const reviewer = reviewerResult.one ? reviewerResult.row : null;
  const contact = contactResult.one ? contactResult.row : null;
  if (!reviewer && !contact) return null;

  if (contact && email && contact.emailaddress1 && normalizeEmail(contact.emailaddress1) !== email) {
    return conflict('email_mismatch', { contactId: contact.contactid, typedEmail: email, contactEmail: contact.emailaddress1 });
  }

  if (reviewer && contact) {
    if (reviewer._wmkf_contact_value && !sameId(reviewer._wmkf_contact_value, contact.contactid)) {
      return conflict('orcid_email_split', {
        reviewerId: reviewer.wmkf_potentialreviewersid,
        reviewerContactId: reviewer._wmkf_contact_value,
        contactId: contact.contactid,
      });
    }
    const collision = await collisionForContact(contact.contactid, reviewer.wmkf_potentialreviewersid);
    if (collision) {
      return conflict('contact_linked_elsewhere', {
        contactId: contact.contactid,
        existingReviewerId: collision.wmkf_potentialreviewersid,
        reviewerId: reviewer.wmkf_potentialreviewersid,
      });
    }
    const consistent = nameConsistent(name, reviewer, 'reviewer') || nameConsistent(name, contact, 'contact');
    if (!consistent) {
      return candidatesOutcome([{ ...reviewerCandidate(reviewer, key), source: 'linked', contactId: contact.contactid }]);
    }
    return confidentOutcome({
      reviewerId: reviewer.wmkf_potentialreviewersid,
      contactId: contact.contactid,
      matchKey: key,
      nameConsistent: consistent,
      context: contextForReviewer(reviewer),
    });
  }

  if (reviewer) {
    const consistent = nameConsistent(name, reviewer, 'reviewer');
    if (!consistent) return candidatesOutcome([reviewerCandidate(reviewer, key)]);
    return confidentOutcome({
      reviewerId: reviewer.wmkf_potentialreviewersid,
      contactId: reviewer._wmkf_contact_value || null,
      matchKey: key,
      nameConsistent: consistent,
      context: contextForReviewer(reviewer),
    });
  }

  const collision = await collisionForContact(contact.contactid);
  if (collision) {
    return conflict('contact_linked_elsewhere', {
      contactId: contact.contactid,
      existingReviewerId: collision.wmkf_potentialreviewersid,
    });
  }
  const consistent = nameConsistent(name, contact, 'contact');
  if (!consistent) return candidatesOutcome([contactCandidate(contact, key)]);
  return confidentOutcome({
    reviewerId: null,
    contactId: contact.contactid,
    matchKey: key,
    nameConsistent: consistent,
    context: contextForContact(contact),
  });
}

async function lookup({ name, email, orcid }) {
  if (orcid) {
    const [reviewerResult, contactResult] = await Promise.all([
      potentialReviewerAdapter.findByOrcidCandidates(orcid),
      contactAdapter.findByOrcidCandidates(orcid),
    ]);
    const out = await evaluateKey({ name, email, key: 'orcid', reviewerResult, contactResult });
    if (out && email) {
      const [emailReviewer, emailContact] = await Promise.all([
        potentialReviewerAdapter.findByEmailCandidates(email),
        contactAdapter.findByEmailCandidates(email),
      ]);
      if (emailReviewer.ambiguous || emailContact.ambiguous) {
        const candidates = [
          ...((emailReviewer.rows || []).map((row) => reviewerCandidate(row, 'email'))),
          ...((emailContact.rows || []).map((row) => contactCandidate(row, 'email'))),
        ];
        return candidatesOutcome(candidates);
      }
      if (out.outcome === 'confident') {
        if (emailReviewer.one && out.match.reviewerId && !sameId(emailReviewer.id, out.match.reviewerId)) {
          return conflict('orcid_email_split', { orcidReviewerId: out.match.reviewerId, emailReviewerId: emailReviewer.id });
        }
        if (emailContact.one && out.match.contactId && !sameId(emailContact.id, out.match.contactId)) {
          return conflict('orcid_email_split', { orcidContactId: out.match.contactId, emailContactId: emailContact.id });
        }
        if (emailContact.one && out.match.reviewerId && !out.match.contactId) {
          return conflict('orcid_email_split', { orcidReviewerId: out.match.reviewerId, emailContactId: emailContact.id });
        }
        if (emailReviewer.one && out.match.contactId && !out.match.reviewerId) {
          return conflict('orcid_email_split', { orcidContactId: out.match.contactId, emailReviewerId: emailReviewer.id });
        }
      }
    }
    if (out) return out;
  }

  if (email) {
    const [reviewerResult, contactResult] = await Promise.all([
      potentialReviewerAdapter.findByEmailCandidates(email),
      contactAdapter.findByEmailCandidates(email),
    ]);
    const out = await evaluateKey({ name, email, key: 'email', reviewerResult, contactResult });
    if (out) return out;
  }

  const [reviewers, contacts] = await Promise.all([
    potentialReviewerAdapter.searchByName(name, { top: 5 }),
    contactAdapter.searchByName(name, { top: 5 }),
  ]);
  const candidates = [
    ...(reviewers || []).map((row) => reviewerCandidate(row, 'name')),
    ...(contacts || []).map((row) => contactCandidate(row, 'name')),
  ];
  if (candidates.length > 0) return candidatesOutcome(sortCandidates(candidates).slice(0, 5));
  return { outcome: 'none', referencedReviewers: [], referencedContacts: [] };
}

export async function lookupReviewerIdentity(input) {
  return lookup(input);
}
