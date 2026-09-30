/**
 * Server-owned exact-person hydration for applicant-recommended reviewers.
 * Reads only; never creates, merges, relinks, or updates a Dataverse row.
 */

import * as potentialReviewerAdapter from '../../dataverse/adapters/potential-reviewer';
import { projectApplicantKnownReviewer } from '../../utils/applicant-known-reviewer';
import { resolveReviewerBindCapability } from '../test-requests/synthetic-reviewer-capability.js';

export async function loadApplicantKnownReviewerContext(personId, requestId = null) {
  let person;
  let capability = null;
  try {
    if (requestId) {
      capability = await resolveReviewerBindCapability({ personId, requestId });
      person = capability.person;
    } else {
      person = await potentialReviewerAdapter.getById(personId);
    }
  } catch (error) {
    console.error(
      `applicant-known-reviewer: could not load person ${personId}:`,
      error?.message || error,
    );
    return {
      applicantKnownReviewer: projectApplicantKnownReviewer(null, { expectedPersonId: personId }),
      contactId: null,
    };
  }

  const email = person?.wmkf_emailaddress || null;
  let emailOwners = { none: true };
  if (email) {
    try {
      if (capability?.kind === 'synthetic') {
        const rows = await potentialReviewerAdapter.findAllByExactEmail(email);
        emailOwners = rows.length === 1
          ? { one: true, id: rows[0].wmkf_potentialreviewersid, row: rows[0] }
          : rows.length === 0 ? { none: true } : { ambiguous: true, count: rows.length, rows };
      } else {
        emailOwners = await potentialReviewerAdapter.findByEmailCandidates(email);
      }
    } catch (error) {
      console.error(
        `applicant-known-reviewer: could not verify email ownership for ${personId}:`,
        error?.message || error,
      );
      return {
        applicantKnownReviewer: {
          ...projectApplicantKnownReviewer(person, {
            expectedPersonId: personId,
            emailOwners: { none: true },
          }),
          status: 'unavailable',
          code: 'email_owner_unavailable',
        },
        contactId: person?._wmkf_contact_value || null,
      };
    }
  }

  return {
    applicantKnownReviewer: projectApplicantKnownReviewer(person, {
      expectedPersonId: personId,
      emailOwners,
    }),
    contactId: person?._wmkf_contact_value || null,
  };
}

export async function loadApplicantKnownReviewer(personId, requestId = null) {
  const context = await loadApplicantKnownReviewerContext(personId, requestId);
  return context.applicantKnownReviewer;
}
