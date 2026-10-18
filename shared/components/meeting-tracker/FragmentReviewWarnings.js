import { fragmentCandidateAt, projectFragmentReview } from '../../utils/transcript-fragment-review';
import { formatTranscriptTurnTime } from '../../../lib/services/transcription-pilot/transcript-format';

/** Advisory only: deliberately has no action that changes a name, turn or publication. */
export default function FragmentReviewWarnings({ review, content, names, presentationEndMs = null }) {
  const checked = projectFragmentReview(review);
  if (!checked) return null;
  if (checked.status !== 'complete') return <p className="mt-3 text-sm text-gray-600">The sentence-fragment check did not complete. Speaker assignments are unchanged.</p>;
  const warnings = checked.warnings.flatMap(warning => {
    const passage = fragmentCandidateAt(content, names, warning.index, presentationEndMs);
    return passage && passage.speakerId === warning.speakerId ? [{ ...passage, reason: warning.reason }] : [];
  });
  if (!warnings.length && !checked.limited) return null;
  return <aside className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" aria-label="Sentence-fragment review">
    <p className="text-sm font-semibold">Possible sentence fragments</p>
    <p className="mt-1 text-sm">Review these passages against the recording. These are AI suggestions; no speaker assignments have changed.</p>
    {checked.limited && <p className="mt-1 text-sm">Only the first 10 candidate passages were checked.</p>}
    <ul className="mt-2 space-y-3">
      {warnings.map(w => <li key={w.id} className="text-sm">
        <p><span className="font-mono">{formatTranscriptTurnTime(w.start)}</span>{' · '}Possible speaker for “{w.middle}”: {names[w.speakerId]}</p>
        <p className="mt-1">{w.before} / <strong>{w.middle}</strong> / {w.after}</p>
        <p className="mt-1">{w.reason}</p>
      </li>)}
    </ul>
  </aside>;
}
