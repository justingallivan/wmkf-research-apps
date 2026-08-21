/**
 * Pure projections for applicant-recommended reviewers that are already linked
 * to an exact Dataverse Potential Reviewer row.
 *
 * These helpers deliberately do not import Dataverse adapters. The client uses
 * the same bounded projections for display, while server services remain
 * responsible for loading and revalidating the person row.
 */

import { emailConfidence } from './reviewer-invite.js';
import { isAntiScrapeMunge } from './reviewer-vetted-email.js';
import {
  addressTrustDecision,
  staffAddressChoiceProjection,
  STAFF_ADDRESS_CHOICE_REASON,
} from './reviewer-address-trust.js';

const KNOWN_STATUSES = new Set(['known', 'inactive', 'unavailable', 'email_conflict']);

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeId(value) {
  return text(value)?.toLowerCase() || null;
}

function normalizeEmail(value) {
  return text(value)?.toLowerCase() || null;
}

function isActiveState(statecode) {
  return statecode === undefined || statecode === 0;
}

function normalizedAddressChoice(value, email) {
  const selectedEmail = normalizeEmail(value?.selectedEmail);
  return value
    && ['keep_stored', 'use_found'].includes(value.decision)
    && selectedEmail
    && selectedEmail === normalizeEmail(email)
    ? { decision: value.decision, selectedEmail }
    : null;
}

function boundedReadiness(email, emailSource, {
  addressTrustStateJson = null,
  addressTrustVerified = false,
  addressConflictPending = false,
  addressChoice = null,
} = {}) {
  let readiness;
  if (addressConflictPending) {
    readiness = {
      level: 'low',
      action: 'blocked',
      code: 'address_conflict_pending',
      reason: 'A newly found address conflicts with the stored reviewer address',
    };
  } else if (addressTrustVerified && emailSource === 'staff_verified') {
    const choice = normalizedAddressChoice(addressChoice, email);
    readiness = {
      level: 'high',
      action: 'ready',
      reason: choice
        ? STAFF_ADDRESS_CHOICE_REASON
        : 'Exact address verified by staff against recorded evidence',
    };
  } else {
    readiness = emailConfidence({
      email: email ?? null,
      emailSource: emailSource ?? null,
      addressTrustStateJson,
    });
  }
  return {
    level: readiness.level,
    action: readiness.action,
    reason: readiness.reason,
  };
}

export function projectApplicantKnownReviewer(person, {
  expectedPersonId,
  emailOwners,
} = {}) {
  if (!person || typeof person !== 'object') {
    return {
      status: 'unavailable',
      code: 'person_unavailable',
      potentialReviewerId: normalizeId(expectedPersonId),
      name: null,
      affiliation: null,
      email: null,
      emailSource: null,
      emailReadiness: boundedReadiness(null, null),
      addressTrustVerified: false,
      addressConflictPending: false,
      orcid: null,
      contactLinked: false,
    };
  }

  const personId = normalizeId(
    person.wmkf_potentialreviewersid || expectedPersonId,
  );
  const email = normalizeEmail(person.wmkf_emailaddress);
  const emailSource = text(person.wmkf_emailsource);
  const fullReadiness = emailConfidence({
    email,
    emailSource,
    addressTrustStateJson: person.wmkf_addresstruststatejson || null,
  });
  const trust = addressTrustDecision({
    email,
    emailSource,
    addressTrustStateJson: person.wmkf_addresstruststatejson || null,
  });
  const addressChoice = staffAddressChoiceProjection(trust.state, { email });
  const base = {
    status: 'known',
    code: null,
    potentialReviewerId: personId,
    name: text(person.wmkf_name)
      || [text(person.wmkf_firstname), text(person.wmkf_lastname)].filter(Boolean).join(' ')
      || null,
    affiliation: text(person.wmkf_primaryaffiliation)
      || text(person.wmkf_organizationname),
    email,
    emailSource,
    emailReadiness: boundedReadiness(email, emailSource, {
      addressTrustStateJson: person.wmkf_addresstruststatejson || null,
    }),
    addressTrustVerified: emailSource === 'staff_verified' && fullReadiness.action === 'ready',
    addressConflictPending: fullReadiness.action === 'blocked',
    addressChoice,
    orcid: text(person.wmkf_orcid),
    contactLinked: !!text(person._wmkf_contact_value),
  };

  if (!isActiveState(person.statecode)) {
    return { ...base, status: 'inactive', code: 'person_inactive' };
  }
  if (!email) return base;

  const owner = emailOwners;
  if (owner?.none === true) {
    return { ...base, status: 'unavailable', code: 'email_owner_unavailable' };
  }
  const ownerId = normalizeId(owner?.id || owner?.row?.wmkf_potentialreviewersid);
  const ownerActive = owner?.one === true && isActiveState(owner?.row?.statecode);
  if (!ownerActive || ownerId !== personId) {
    return { ...base, status: 'email_conflict', code: 'email_conflict' };
  }

  return base;
}

export function pruneApplicantKnownReviewer(value) {
  if (!value || typeof value !== 'object') return null;
  const status = KNOWN_STATUSES.has(value.status) ? value.status : 'unavailable';
  const email = normalizeEmail(value.email);
  const emailSource = text(value.emailSource);
  const addressTrustVerified = value.addressTrustVerified === true;
  const addressConflictPending = value.addressConflictPending === true;
  const addressChoice = normalizedAddressChoice(value.addressChoice, email);
  return {
    status,
    code: text(value.code),
    potentialReviewerId: normalizeId(value.potentialReviewerId),
    name: text(value.name),
    affiliation: text(value.affiliation),
    email,
    emailSource,
    emailReadiness: boundedReadiness(email, emailSource, {
      addressTrustVerified,
      addressConflictPending,
      addressChoice,
    }),
    addressTrustVerified,
    addressConflictPending,
    addressChoice,
    orcid: text(value.orcid),
    contactLinked: value.contactLinked === true,
  };
}

/**
 * Decide whether an exact, freshly-read canonical person contact can be reused
 * for applicant promotion without writing an email.
 */
export function projectCanonicalApplicantContact({
  applicantKnownReviewer,
  candidate,
  allowStaffManualContact = false,
} = {}) {
  const known = pruneApplicantKnownReviewer(applicantKnownReviewer);
  if (!known || known.status === 'unavailable') {
    return { decision: 'person_unavailable', code: 'person_unavailable', reusable: false };
  }
  if (known.status === 'inactive') {
    return { decision: 'person_inactive', code: 'person_inactive', reusable: false };
  }
  if (known.status === 'email_conflict') {
    return { decision: 'email_conflict', code: 'email_conflict', reusable: false };
  }
  if (known.status !== 'known') {
    return { decision: 'unknown_status', code: 'unknown_applicant_contact_status', reusable: false };
  }
  const candidateEmail = normalizeEmail(
    candidate?.contactEnrichment?.email || candidate?.email,
  );
  const staffManualEmail = allowStaffManualContact
    && candidate?.pdIdentityConfirmed === true
    && Array.isArray(candidate?.manualContactFields)
    && candidate.manualContactFields.includes('email')
    && candidateEmail;
  if (staffManualEmail) {
    if (isAntiScrapeMunge(staffManualEmail)) {
      return {
        decision: 'missing_email',
        code: 'anti_scrape_email',
        reusable: false,
        emailReadiness: boundedReadiness(null, null),
      };
    }
    return {
      decision: 'ready',
      code: null,
      reusable: false,
      email: staffManualEmail,
      emailSource: 'manual',
      emailReadiness: boundedReadiness(staffManualEmail, 'manual'),
    };
  }

  if (!known.email || isAntiScrapeMunge(known.email)) {
    return {
      decision: 'missing_email',
      code: known.email ? 'anti_scrape_email' : 'missing_verified_email',
      reusable: false,
      emailReadiness: known.emailReadiness,
    };
  }

  if (
    candidate?.applicantContactMismatch === true
    && candidateEmail !== known.email
  ) {
    return {
      decision: 'contact_claim_mismatch',
      code: 'contact_claim_mismatch',
      reusable: false,
      email: known.email,
      emailSource: known.emailSource,
      emailReadiness: known.emailReadiness,
    };
  }

  if (candidateEmail && candidateEmail !== known.email) {
    return {
      decision: 'contact_claim_mismatch',
      code: 'contact_claim_mismatch',
      reusable: false,
      email: known.email,
      emailSource: known.emailSource,
      emailReadiness: known.emailReadiness,
    };
  }

  return {
    decision: 'ready',
    code: null,
    reusable: true,
    email: known.email,
    emailSource: known.emailSource,
    emailReadiness: known.emailReadiness,
  };
}
