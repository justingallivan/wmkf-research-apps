import { buildGoogleSearchUrl } from '../../../lib/utils/google-search-url';

export default function FindMailboxReview({ name, institution, review, verifiedEmail, leads, savedContact = false }) {
  if (!review) return null;
  if (verifiedEmail && review.reason === 'search_ownership' && review.disposition === 'staff_review') {
    const emails = (Array.isArray(leads) ? leads : []).filter(lead => lead?.type === 'email');
    const matches = value => typeof value === 'string' && value.trim().toLowerCase() === verifiedEmail.toLowerCase();
    if (emails.length && emails.every(lead => matches(lead.value))
        && (!review.profile || matches(review.profile.email))) {
      return savedContact ? null : <p className="mt-3 text-sm">Staff verified {verifiedEmail}.</p>;
    }
  }
  const pages = Array.isArray(review.pages)
    ? review.pages.filter(url => typeof url === 'string' && /^https:\/\//i.test(url) && URL.canParse(url))
    : [];
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <strong>Verify the reviewer’s contact</strong>
      <p>{review.reason === 'missing_address'
        ? 'A profile lookup found a possible contact.'
        : review.reason === 'search_ownership'
        ? ({
          contested_hold: 'The contested address is held. Staff must resolve the conflict before using it.',
          identity_conflict: 'The institution and research expertise conflict with the suggested identity. The address has been cleared.',
          staff_review: 'Review the unconfirmed address in Possible contact leads.',
        }[review.disposition] || 'The original search address needs verification.')
        : review.reason === 'orcid_institution_unconfirmed'
        ? 'The ORCID record could not be tied to the suggested institution.'
        : 'The publication affiliation differs from the suggested institution.'}
        {' '}Find suggested {name} at {institution}.</p>
      {typeof review.previousEmail === 'string' && <p>The original lookup returned {review.previousEmail}. Its ownership needs verification.</p>}
      {review.profile && <p>The institutional page lists {review.profile.email}. Check ownership and current use before inviting.</p>}
      {pages.map(url => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="mr-3 underline">
          {url === review.profile?.sourceUrl ? 'Check address on ' : 'Review page on '}{new URL(url).hostname}
        </a>
      ))}
      <a href={buildGoogleSearchUrl(name, institution)} target="_blank" rel="noopener noreferrer" className="underline">
        Find an institutional profile
      </a>
    </div>
  );
}
