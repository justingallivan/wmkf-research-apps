/**
 * API: /api/workbench/reviewer-lookup
 *
 * Read-only cross-store identity lookup for the manual reviewer add form.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { ContactParser } from '../../../lib/utils/contact-parser';
import { normalizeOrcid } from '../../../lib/utils/orcid-normalize';
import * as potentialReviewerAdapter from '../../../lib/dataverse/adapters/potential-reviewer';
import * as contactAdapter from '../../../lib/dataverse/adapters/contact';

const MAX_NAME = 180;
const MAX_EMAIL = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

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

function conflict(reason, details) {
  return { outcome: 'conflict', reason, details };
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
    return candidates.length > 0 ? { outcome: 'candidates', candidates: sortCandidates(candidates) } : { outcome: 'candidates', candidates: [] };
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
      return { outcome: 'candidates', candidates: sortCandidates([{ ...reviewerCandidate(reviewer, key), source: 'linked', contactId: contact.contactid }]) };
    }
    return {
      outcome: 'confident',
      match: {
        reviewerId: reviewer.wmkf_potentialreviewersid,
        contactId: contact.contactid,
        matchKey: key,
        nameConsistent: consistent,
        context: contextForReviewer(reviewer),
      },
    };
  }

  if (reviewer) {
    const consistent = nameConsistent(name, reviewer, 'reviewer');
    if (!consistent) return { outcome: 'candidates', candidates: [reviewerCandidate(reviewer, key)] };
    return {
      outcome: 'confident',
      match: {
        reviewerId: reviewer.wmkf_potentialreviewersid,
        contactId: reviewer._wmkf_contact_value || null,
        matchKey: key,
        nameConsistent: consistent,
        context: contextForReviewer(reviewer),
      },
    };
  }

  const collision = await collisionForContact(contact.contactid);
  if (collision) {
    return conflict('contact_linked_elsewhere', {
      contactId: contact.contactid,
      existingReviewerId: collision.wmkf_potentialreviewersid,
    });
  }
  const consistent = nameConsistent(name, contact, 'contact');
  if (!consistent) return { outcome: 'candidates', candidates: [contactCandidate(contact, key)] };
  return {
    outcome: 'confident',
    match: {
      reviewerId: null,
      contactId: contact.contactid,
      matchKey: key,
      nameConsistent: consistent,
      context: contextForContact(contact),
    },
  };
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
        return { outcome: 'candidates', candidates: sortCandidates(candidates) };
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
  if (candidates.length > 0) return { outcome: 'candidates', candidates: sortCandidates(candidates).slice(0, 5) };
  return { outcome: 'none' };
}

export async function lookupReviewerIdentity(input) {
  return lookup(input);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const body = req.body || {};
  const name = cleanString(body.name, MAX_NAME);
  const email = normalizeEmail(body.email);
  const orcidRaw = cleanString(body.orcid, 64);
  const orcidNorm = orcidRaw ? normalizeOrcid(orcidRaw) : { state: 'empty' };
  const orcid = orcidNorm.state === 'valid' ? orcidNorm.id : null;

  if (!name) return res.status(400).json({ error: 'name is required' });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'email must be a valid email address' });
  if (orcidRaw && !orcid) return res.status(400).json({ error: 'orcid must be a valid ORCID iD' });

  return bypassDynamicsRestrictions('workbench-reviewer-lookup', async () => {
    try {
      const out = await lookup({ name, email: email || null, orcid });
      return res.status(200).json(out);
    } catch (error) {
      console.error('reviewer-lookup error:', error);
      return res.status(500).json({
        error: 'Failed to look up reviewer',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  });
}
