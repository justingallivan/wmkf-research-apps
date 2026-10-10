/** Offline mutation evidence: disable one guard, require a failing regression, restore exact bytes. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'zoom-attendance-mutations-'));
const core = 'tests/unit/zoom-attendance-attribution.test.js';
const service = 'tests/unit/meeting-tracker-transcription-recovery.test.js';
const card = 'tests/unit/recording-and-transcript-card.test.js';
const mutations = [
  ['discussion-only resolver', 'lib/services/meeting-tracker-transcription/presentation-boundary.js', '  const excluded = new Set(decision.excludedSpeakerIds);', '  const excluded = new Set();', core],
  ['boundary partition', 'lib/services/meeting-tracker-transcription/presentation-boundary.js', 'row.end <= endMs) && excluded.has', 'row.end < endMs) && excluded.has', core],
  ['waiting-only hidden', 'lib/services/meeting-tracker-transcription/attendance-service.js', '.filter(person => person.lastLeaveAt).map', '.filter(() => true).map', core],
  ['duplicate-name merge', 'lib/services/meeting-tracker-transcription/attendance-service.js', 'if (!people.has(row.name))', 'if (true)', core],
  ['frozen occurrence only', 'lib/services/meeting-tracker-transcription/attendance-service.js', 'fetchReport(origin.provenance.zoom.meetingUuid)', "fetchReport('newest-import')", core],
  ['partial report fallback', 'lib/services/meeting-tracker-transcription/attendance-service.js', "malformed ? 'partial' : report.status", "malformed ? 'partial' : 'complete'", core],
  ['recording alignment hint', 'lib/services/meeting-tracker-transcription/attendance-service.js', 'z?.audioOnlyFileCount === 1 &&', 'true &&', core],
  ['review replay guard', 'lib/services/meeting-tracker-transcription/discussion-attribution.js', 'confirmation.reviewId !== review.id', 'false', core],
  ['shared microphone isolation', 'lib/services/meeting-tracker-transcription/discussion-attribution.js', 'row.speakerIds.filter(id => !shared.has(id))', 'row.speakerIds', core],
  ['rename invalidation SQL', 'lib/services/transcription-pilot/store.js', 'speaker_names IS DISTINCT FROM $4::jsonb', 'FALSE', 'tests/unit/transcription-pilot-store.test.js'],
  ['confirmation context guard', 'lib/services/meeting-tracker-transcription/service.js', 'source.receipt.attendance_review.context !== attendanceContext(source)', 'false', service],
  ['recovery frozen decision', 'lib/services/meeting-tracker-transcription/service.js', ', discussionAttribution: recovering.frozen_discussion_attribution ?? null', '', service],
  ['legacy rejects policy', 'lib/services/meeting-tracker-transcription/bundle.js', "else if (Object.prototype.hasOwnProperty.call(identity, 'discussionAttribution')) fail();", 'else if (false) fail();', core],
  ['pilot byte compatibility', 'lib/services/transcription-pilot/transcript-format.js', '`${formatTranscriptTurnTime(turn.start)}', '`${formatTranscriptTurnTime(turn.start)}', core],
  ['registered recovery decision', 'lib/services/meeting-tracker-transcription/service.js', '          sourceProvenance: manifest.sourceProvenance ?? null, discussionAttribution: manifest.discussionAttribution ?? null,', '          sourceProvenance: manifest.sourceProvenance ?? null,', service],
  ['shared mic preserves choices', 'shared/components/meeting-tracker/RecordingAndTranscriptCard.js', 'if (index < attendanceReview.decision.rows.length) return attendanceKept[index];', 'if (index < attendanceReview.decision.rows.length) return true;', card],
  ['late attendance success', 'shared/components/meeting-tracker/RecordingAndTranscriptCard.js', 'if (current()) setCorrectionDetail(detail =>', 'if (true) setCorrectionDetail(detail =>', card],
  ['late attendance failure', 'shared/components/meeting-tracker/RecordingAndTranscriptCard.js', "if (current()) setError(errorMessage(error, 'Attendance", "if (true) setError(errorMessage(error, 'Attendance", card],
  ['explicit attendance retry', 'shared/components/meeting-tracker/RecordingAndTranscriptCard.js', '    attendanceAttemptRef.current = null;', '    // disabled retry reset', card],
];
// Mutate actual rendered TXT while keeping valid syntax; the fixture must detect it.
mutations[13][2] = 'return `[${formatTranscriptTurnTime(turn.start)}]';
mutations[13][3] = 'return `[${formatTranscriptTurnTime(turn.start)}] changed';
mutations.push(['derivative attribution', 'lib/services/post-presentation-materials/presentation-transcript-service.js', 'return { ...source, content: resolveDiscussionAttribution(source.content, source.presentationEnd?.endMs, source.discussionAttribution) };', 'return source;', 'tests/unit/presentation-transcript-service.test.js']);
const filter = process.argv[2];
const run = suite => spawnSync('npx', ['jest', suite, '--runInBand'], { cwd: root, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
let failed = false;
for (const [index, [name, relative, needle, replacement, suite]] of mutations.entries()) {
  if (filter && !name.includes(filter)) continue;
  const file = path.join(root, relative);
  const original = fs.readFileSync(file);
  const source = original.toString();
  if (!source.includes(needle)) throw new Error(`Missing mutation anchor: ${name}`);
  try {
    let mutated = source.replace(needle, replacement);
    // Request isolation includes both the keyed owner and its post-await guard.
    if (name.startsWith('late attendance')) mutated = mutated.replace('key={requestId} requestId={requestId}', 'requestId={requestId}');
    fs.writeFileSync(file, mutated);
    const broken = run(suite);
    fs.writeFileSync(path.join(output, `${index + 1}-broken.log`), broken.stdout + broken.stderr);
    const caught = broken.status !== 0 && /Tests:\s+.*failed/.test(broken.stdout + broken.stderr);
    fs.writeFileSync(file, original);
    const restored = run(suite);
    fs.writeFileSync(path.join(output, `${index + 1}-restored.log`), restored.stdout + restored.stderr);
    console.log(`${name}: reverted ${caught ? 'FAIL (expected)' : 'NOT CAUGHT'}; restored ${restored.status === 0 ? 'PASS' : 'FAIL'}`);
    if (!caught || restored.status !== 0) failed = true;
  } finally { fs.writeFileSync(file, original); }
}
console.log(`Evidence: ${output}`);
if (failed) process.exitCode = 1;
