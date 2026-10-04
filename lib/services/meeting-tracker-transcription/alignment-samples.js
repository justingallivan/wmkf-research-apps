/**
 * Pure prompt-sample rendering and budget serialization for Zoom speaker alignment.
 *
 * Split out of alignment-service.js (2026-10-04, Codex review of the probe) so that the
 * read-only diagnostic scripts/probe-meeting-speaker-alignment.js can run the SAME
 * serialization and reserved-sample guards as the live runtime under plain Node ESM.
 * alignment-service.js has bundler-only extensionless imports; this module has none.
 * Budgets come from the prompt's variable declarations (single source of truth).
 */
import { PROMPT_VARIABLES } from '../../../shared/config/prompts/meeting-speaker-alignment.js';

export const VARIABLE_MAX = Object.freeze(Object.fromEntries(
  PROMPT_VARIABLES.variables.map(variable => [variable.name, variable.maxChars]),
));

export function renderSample(sample) {
  const lines = [`[${sample.pairId}] speaker ${sample.speakerId}: ${sample.text}`];
  for (const cue of sample.cues) lines.push(`  cue ${cue.name}: ${cue.text}`);
  return lines.join('\n');
}

/**
 * Round-robin by per-speaker rank (every speaker's first sample, then every second, ...) until the
 * budget, then render the kept set in original order. `droppedSpeaker` is true when a speaker that
 * had samples keeps none.
 */
export function serializeSpeakerSamples(samples, maxChars = VARIABLE_MAX.speaker_samples, reservedPairIds = new Set()) {
  const seen = new Map();
  const groupRank = new Map();
  const ranked = samples.map((sample, index) => {
    seen.set(sample.speakerId, (seen.get(sample.speakerId) || 0) + 1);
    const reserved = reservedPairIds.has(sample.pairId);
    const key = `${sample.speakerId}|${reserved}`;
    const rank = groupRank.get(key) || 0;
    groupRank.set(key, rank + 1);
    return { sample, index, rank, reserved };
  }).sort((left, right) => Number(!left.reserved) - Number(!right.reserved)
    || left.rank - right.rank || left.index - right.index);
  const chosen = new Set();
  let size = 0;
  for (const { sample, index } of ranked) {
    const cost = renderSample(sample).length + (chosen.size ? 2 : 0);
    if (size + cost > maxChars) break;
    chosen.add(index);
    size += cost;
  }
  const kept = samples.filter((_, index) => chosen.has(index));
  const keptSpeakers = new Set(kept.map(sample => sample.speakerId));
  return {
    text: kept.map(renderSample).join('\n\n'),
    kept,
    keptPairIds: new Set(kept.map(sample => sample.pairId)),
    droppedReserved: samples.filter((sample, index) => !chosen.has(index) && reservedPairIds.has(sample.pairId))
      .map(sample => sample.pairId),
    droppedSpeaker: [...seen.keys()].some(id => !keptSpeakers.has(id)),
  };
}
