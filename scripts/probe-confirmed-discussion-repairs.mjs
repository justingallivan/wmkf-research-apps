/** Offline verification only; no network, credentials, uploads, or production writes.
 * Run with: node --import ./scripts/lib/use-extensionless.mjs scripts/probe-confirmed-discussion-repairs.mjs /path/to/attribution-sources.json
 * Input is the private, previously verified [{source: <bundle source>}] export; never commit it.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { applyConfirmedDiscussionRepair } from '../lib/services/meeting-tracker-transcription/confirmed-discussion-repairs.js';
import { parseVerifiedMeetingTranscriptSource, buildMeetingTranscriptFiles } from '../lib/services/meeting-tracker-transcription/bundle.js';
import { buildStaffDiscussionTranscriptText } from '../lib/services/meeting-tracker-transcription/presentation-boundary.js';

if (!process.argv[2]) throw new Error('A private source export path is required.');
let verified = 0;
for (const { source: saved } of JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))) {
  const bytes = Buffer.from(JSON.stringify(saved));
  const source = parseVerifiedMeetingTranscriptSource(bytes, {
    size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }, saved);
  const fixed = applyConfirmedDiscussionRepair({ requestId: saved.requestId, revisionId: saved.revisionId, sourceBytes: bytes, source });
  if (!fixed.repairId) continue;
  assert.deepEqual(fixed.content.utterances.filter(row => row.end <= saved.presentationEnd.endMs),
    source.content.utterances.filter(row => row.end <= saved.presentationEnd.endMs));
  assert.equal(fixed.content.utterances.map(row => row.text).join(' '), source.content.utterances.map(row => row.text).join(' '));
  assert.deepEqual(fixed.content.utterances.flatMap(row => row.words || []), source.content.utterances.flatMap(row => row.words || []));
  const speakerNames = { ...source.speakerNames, ...fixed.unknownSpeakerNames };
  const revisionId = crypto.randomUUID();
  const identity = { ...saved, revisionId, operationId: revisionId, discussionAttribution: null };
  const built = buildMeetingTranscriptFiles({ content: fixed.content, speakerNames, identity });
  const file = built.files.source;
  const reread = parseVerifiedMeetingTranscriptSource(file.bytes, { size: file.bytes.length, sha256: file.sha256 }, identity);
  const text = buildStaffDiscussionTranscriptText(reread.content, reread.speakerNames, saved.presentationEnd.endMs);
  assert(!/(Ted Abel[^:]*|jingli|evaan):/i.test(text));
  if (saved.requestId === '8a0efbb3-8d45-f111-88b4-000d3a306da2') {
    assert.equal(reread.speakerNames[reread.content.utterances[80].speaker], 'Justin Gallivan');
    assert.equal(reread.speakerNames[reread.content.utterances[82].speaker], 'Beth Pruitt');
    assert(text.includes('Beth Pruitt: I was really impressed'));
  } else {
    assert.equal(reread.content.utterances[145].text, 'This is a steaming pile of garbage.');
    assert.equal(reread.speakerNames[reread.content.utterances[145].speaker], 'Justin Gallivan');
    assert.equal(reread.speakerNames[reread.content.utterances[146].speaker], 'Unidentified speaker');
  }
  verified += 1;
  console.log(JSON.stringify({ requestId: saved.requestId, originalTurns: source.content.utterances.length,
    repairedTurns: fixed.content.utterances.length, unknownTurns: Object.keys(fixed.unknownSpeakerNames).length,
    presentationUnchanged: true, wordsUnchanged: true, bundleReread: true, confirmedSpeakers: true, noPresenterLabels: true }));
}
assert.equal(verified, 2, 'Expected exactly the two authorized source revisions.');
