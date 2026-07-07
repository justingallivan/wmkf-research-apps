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

function cleanId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return id || null;
}

function cleanOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function reviewerAffiliation(row) {
  return cleanOptionalString(row?.wmkf_primaryaffiliation)
    || cleanOptionalString(row?.wmkf_organizationname)
    || null;
}

function createDiscoveries() {
  return {
    reviewers: new Map(),
    contacts: new Map(),
  };
}

function fetchRows(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result.filter(Boolean);
  if (result.none) return [];
  if (result.one) return result.row ? [result.row] : [];
  if (result.ambiguous) return Array.isArray(result.rows) ? result.rows.filter(Boolean) : [];
  return typeof result === 'object' ? [result] : [];
}

function upsertDiscovery(map, id, signal, row = null) {
  const clean = cleanId(id);
  if (!clean) return null;
  const key = clean.toLowerCase();
  let entry = map.get(key);
  if (!entry) {
    entry = { id: clean, row: null, signals: new Set() };
    map.set(key, entry);
  }
  entry.signals.add(signal);
  if (row && (!entry.row || (!reviewerAffiliation(entry.row) && reviewerAffiliation(row)))) {
    entry.row = row;
  }
  return entry;
}

function recordContactId(discoveries, contactId, signal, row = null) {
  upsertDiscovery(discoveries.contacts, contactId, signal, row);
}

function recordReviewerRow(discoveries, row, signal) {
  if (!row) return;
  upsertDiscovery(discoveries.reviewers, row.wmkf_potentialreviewersid, signal, row);
  recordContactId(discoveries, row._wmkf_contact_value, signal);
}

function recordContactRow(discoveries, row, signal) {
  if (!row) return;
  recordContactId(discoveries, row.contactid, signal, row);
}

function recordAdapterFetch(discoveries, entityType, signal, result) {
  for (const row of fetchRows(result)) {
    if (entityType === 'reviewer') recordReviewerRow(discoveries, row, signal);
    if (entityType === 'contact') recordContactRow(discoveries, row, signal);
  }
}

const REVIEWER_FETCH_SIGNALS = {
  findByOrcidCandidates: 'orcid',
  findByEmailCandidates: 'email',
  searchByName: 'name',
  findByContactId: 'linked',
};

const CONTACT_FETCH_SIGNALS = {
  findByOrcidCandidates: 'orcid',
  findByEmailCandidates: 'email',
  searchByName: 'name',
};

function recordingAdapter(adapter, entityType, discoveries, signalByMethod) {
  return new Proxy(adapter, {
    get(target, prop) {
      const value = target[prop];
      const signal = signalByMethod[prop];
      if (!signal || typeof value !== 'function') return value;
      return async (...args) => {
        const result = await value(...args);
        recordAdapterFetch(discoveries, entityType, signal, result);
        return result;
      };
    },
  });
}

function recordingAdapters(discoveries) {
  return {
    potentialReviewer: recordingAdapter(potentialReviewerAdapter, 'reviewer', discoveries, REVIEWER_FETCH_SIGNALS),
    contact: recordingAdapter(contactAdapter, 'contact', discoveries, CONTACT_FETCH_SIGNALS),
  };
}

// `viaNameMatch` is a FACT the producer declares, not a policy: true only when the
// id was surfaced SOLELY by a fallback name search. Any exact email/ORCID/linked
// discovery for the same id makes it screenable.
function viaNameMatch(signals) {
  return signals.size > 0 && [...signals].every((signal) => signal === 'name');
}

function stampReferences(out, discoveries) {
  const referencedReviewers = [...discoveries.reviewers.values()].map((entry) => ({
    reviewerId: entry.id,
    affiliation: reviewerAffiliation(entry.row),
    viaNameMatch: viaNameMatch(entry.signals),
  }));
  const referencedContacts = [...discoveries.contacts.values()].map((entry) => ({
    contactId: entry.id,
    viaNameMatch: viaNameMatch(entry.signals),
  }));

  return {
    ...out,
    referencedReviewers,
    referencedContacts,
  };
}

function confidentOutcome(match) {
  return {
    outcome: 'confident',
    match,
  };
}

function candidatesOutcome(candidates) {
  const sorted = sortCandidates(candidates);
  return {
    outcome: 'candidates',
    candidates: sorted,
  };
}

function conflict(reason, details) {
  return {
    outcome: 'conflict',
    reason,
    details,
  };
}

async function collisionForContact(adapters, contactId, reviewerId = null) {
  if (!contactId) return null;
  const linked = await adapters.potentialReviewer.findByContactId(contactId);
  if (linked && (!reviewerId || !sameId(linked.wmkf_potentialreviewersid, reviewerId))) {
    return linked;
  }
  return null;
}

async function evaluateKey({ adapters, name, email, key, reviewerResult, contactResult }) {
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
    const collision = await collisionForContact(adapters, contact.contactid, reviewer.wmkf_potentialreviewersid);
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

  const collision = await collisionForContact(adapters, contact.contactid);
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

async function lookup({ name, email, orcid }, adapters) {
  if (orcid) {
    const [reviewerResult, contactResult] = await Promise.all([
      adapters.potentialReviewer.findByOrcidCandidates(orcid),
      adapters.contact.findByOrcidCandidates(orcid),
    ]);
    const out = await evaluateKey({ adapters, name, email, key: 'orcid', reviewerResult, contactResult });
    if (out && email) {
      const [emailReviewer, emailContact] = await Promise.all([
        adapters.potentialReviewer.findByEmailCandidates(email),
        adapters.contact.findByEmailCandidates(email),
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
      adapters.potentialReviewer.findByEmailCandidates(email),
      adapters.contact.findByEmailCandidates(email),
    ]);
    const out = await evaluateKey({ adapters, name, email, key: 'email', reviewerResult, contactResult });
    if (out) return out;
  }

  const [reviewers, contacts] = await Promise.all([
    adapters.potentialReviewer.searchByName(name, { top: 5 }),
    adapters.contact.searchByName(name, { top: 5 }),
  ]);
  const candidates = [
    ...(reviewers || []).map((row) => reviewerCandidate(row, 'name')),
    ...(contacts || []).map((row) => contactCandidate(row, 'name')),
  ];
  if (candidates.length > 0) return candidatesOutcome(sortCandidates(candidates).slice(0, 5));
  return { outcome: 'none' };
}

export async function lookupReviewerIdentity(input) {
  const discoveries = createDiscoveries();
  const adapters = recordingAdapters(discoveries);
  const out = await lookup(input, adapters);
  return stampReferences(out, discoveries);
}
