/**
 * Server-owned exact-person hydration for applicant-recommended reviewers.
 * Reads only; never creates, merges, relinks, or updates a Dataverse row.
 */

import * as potentialReviewerAdapter from '../../dataverse/adapters/potential-reviewer';
import { projectApplicantKnownReviewer } from '../../utils/applicant-known-reviewer';

export async function loadApplicantKnownReviewerContext(personId) {
  let person;
  try {
    person = await potentialReviewerAdapter.getById(personId);
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
      emailOwners = await potentialReviewerAdapter.findByEmailCandidates(email);
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

export async function loadApplicantKnownReviewer(personId) {
  const context = await loadApplicantKnownReviewerContext(personId);
  return context.applicantKnownReviewer;
}
