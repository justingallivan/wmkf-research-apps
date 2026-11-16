import { Button } from '../Layout';
import { reviewStatusLabel } from './reviewer-modes';

const RESPONSE_LABELS = {
  accepted: 'Accepted',
  declined: 'Declined',
  held: 'On hold',
  no_response: 'No response',
  withdrawn_sufficient: 'Released',
};

export default function ReviewerRosterOverview({ candidates, reviewers, loading, incomplete, onRetry }) {
  const reviewersById = new Map(reviewers.map((reviewer) => [reviewer.suggestionId, reviewer]));
  const people = new Map(candidates.map((candidate) => [candidate.suggestionId, candidate]));
  for (const reviewer of reviewers) {
    if (!people.has(reviewer.suggestionId)) people.set(reviewer.suggestionId, reviewer);
  }

  return (
    // No visible heading: the Roster view button above already names it (owner,
    // 2026-11-11). The accessible name stays for assistive technology.
    <section aria-label="Reviewer roster" className="overflow-hidden rounded-xl border border-gray-200 bg-white">

      {loading ? (
        <p role="status" className="px-5 py-4 text-sm text-gray-600">Loading reviewer roster…</p>
      ) : (
        <>
          {incomplete && (
            <p role="status" className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
              Some reviewer information couldn’t be loaded.{' '}
              <Button type="button" variant="link" onClick={onRetry}>Retry</Button>
            </p>
          )}
          {people.size > 0 ? (
            <div className="overflow-x-auto">
              <table aria-label="Reviewer roster" className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-gray-700">
                  <tr>
                    <th scope="col" className="px-5 py-2 font-semibold">Reviewer</th>
                    <th scope="col" className="px-4 py-2 font-semibold">Invitation</th>
                    <th scope="col" className="px-4 py-2 font-semibold">Response</th>
                    <th scope="col" className="px-4 py-2 font-semibold">Review progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {[...people].map(([id, person]) => {
                    const reviewer = reviewersById.get(id);
                    const invited = person.invited || person.emailSentAt || reviewer?.invited || reviewer?.emailSentAt;
                    const accepted = person.accepted || Boolean(reviewer?.reviewStatus);
                    const responseType = person.responseType || reviewer?.responseType
                      || (person.declined ? 'declined' : accepted ? 'accepted' : null);
                    const invitation = invited ? 'Invited' : (responseType || incomplete) ? 'Unconfirmed' : 'Not invited';
                    const affiliation = person.affiliation || reviewer?.affiliation;
                    const response = RESPONSE_LABELS[responseType] || (invited ? 'Awaiting response' : '—');

                    return (
                      <tr key={id} className="align-top">
                        <th scope="row" className="px-5 py-3 font-medium text-gray-900">
                          {person.name || reviewer?.name || 'Unnamed reviewer'}
                          {affiliation && (
                            <span className="block text-gray-600 font-normal">{affiliation}</span>
                          )}
                        </th>
                        <td className="px-4 py-3 text-gray-700">{invitation}</td>
                        <td className={response === 'Awaiting response' ? 'px-4 py-3 font-medium text-amber-800' : 'px-4 py-3 text-gray-700'}>
                          {response}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{reviewer?.reviewStatus ? reviewStatusLabel(reviewer) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : !incomplete && (
            <p className="px-5 py-4 text-sm text-gray-600">
              No reviewers on this roster yet. Use Find to search for or add a reviewer.
            </p>
          )}
        </>
      )}
    </section>
  );
}
