/**
 * Optional, review-only pass after final Zoom reconciliation. One bounded Executor invocation.
 * References and explanations live only in the existing private, expiring speaker_alignment JSON;
 * excerpts are reconstructed from the draft. No transcript/name/overlay writes. Missing prompt,
 * deadline, malformed output and provider errors are advisory failures, never alignment failures.
 */
import { executePrompt } from '../execute-prompt.js';
import { applySpeakerReassignments } from '../transcription-pilot/transcript-format.js';
import { collectFragmentCandidates } from '../../../shared/utils/transcript-fragment-review.js';
import { PROMPT_NAME } from '../../../shared/config/prompts/meeting-fragment-review.js';

export async function reviewSentenceFragments(content, verdict, deadlineMs) {
  const attach = fragmentReview => {
    const alignment = { ...verdict.alignment, fragmentReview };
    // Preserve all alignment evidence if the optional addition would exceed the existing bound.
    return Buffer.byteLength(JSON.stringify(alignment), 'utf8') <= 65536 ? { ...verdict, alignment } : verdict;
  };
  try {
    const corrected = applySpeakerReassignments(content, verdict.alignment.reassigned, verdict.alignment.additionalSpeakerIds);
    const names = Object.fromEntries(Object.entries(verdict.alignment.speakers || {})
      .filter(([, value]) => value?.name).map(([id, value]) => [id, value.name]));
    const { candidates, limited } = collectFragmentCandidates(corrected, names);
    if (!candidates.length) return attach({ status: 'complete', limited, warnings: [] });
    if (!Number.isFinite(deadlineMs) || deadlineMs - Date.now() < 5000) return attach({ status: 'skipped', limited, warnings: [] });
    const passages = JSON.stringify(candidates.map(({ id, before, middle, after }) => ({ id, before, middle, after })));
    if (passages.length > 40000) return attach({ status: 'skipped', limited, warnings: [] });
    const result = await executePrompt({
      promptName: PROMPT_NAME,
      overrideVariables: { passages },
      runSource: 'Vercel Interactive', requireNoPersistence: true, auditRetention: 'content-free',
      deadlineMs: Math.min(deadlineMs - 2000, Date.now() + 20000), maxTokensOverride: 2048, forceOverwrite: true,
    });
    const parsed = result?.parsed;
    if (result?.blocked || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || Object.keys(parsed).length !== candidates.length
      || candidates.some(c => !Object.hasOwn(parsed, c.id)
        || !['sentence_fragment', 'interjection', 'uncertain'].includes(parsed[c.id]?.classification)
        || typeof parsed[c.id]?.reason !== 'string' || !parsed[c.id].reason.trim() || parsed[c.id].reason.length > 240)) {
      return attach({ status: 'unavailable', limited, warnings: [] });
    }
    const warnings = candidates.filter(c => parsed[c.id].classification === 'sentence_fragment')
      .map(c => ({ index: c.index, speakerId: c.speakerId, reason: parsed[c.id].reason }));
    return attach({ status: 'complete', limited, warnings });
  } catch {
    // Never log private passages, model output or provider error messages.
    return attach({ status: 'unavailable', limited: false, warnings: [] });
  }
}
