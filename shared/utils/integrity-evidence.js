/** Staff-facing evidence labels shared by both screens and their exports.
 * Never turn heuristic name scores or unknown/legacy evidence into identity proof.
 */
function integrityIdentityLabel(match) {
  if (match?.matchingVersion !== 2) return 'Earlier matching rules · identity not established';
  if (match.identityStatus !== 'unverified') return 'Identity unverified';
  const labels = {
    exact_name: 'Exact name match',
    compatible_initials: 'Initials match',
    recognized_variant: 'Name variant',
    ambiguous_name: 'Possible namesake',
  };
  return Object.hasOwn(labels, match.nameEvidence)
    ? `${labels[match.nameEvidence]} · identity unverified` : 'Identity unverified';
}

function integrityIncomplete(result) {
  return ['retraction_watch', 'pubpeer', 'news'].some((key) => (
    result?.sources?.[key]?.searched !== true || Boolean(result.sources[key].error)
  ));
}

function integritySourceLabel(source) {
  if (!source || source.searched !== true || source.error) return 'Incomplete source';
  return source.hasConcerns ? 'Flagged for human review' : 'No concerns reported';
}

function integrityResultLabel(result) {
  if (integrityIncomplete(result)) return 'Incomplete screen';
  return result?.hasConcerns ? 'Items for human review' : 'No concerns reported';
}

module.exports = { integrityIdentityLabel, integrityIncomplete, integritySourceLabel, integrityResultLabel };
