/** Fixed scope: 1003020 and 1003038; standard services, no direct content/database rewrites. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sql } from '@vercel/postgres';
import { withDalContext } from '../../lib/dataverse/core/context.js';
import { classifyDeployment, classifyTarget } from '../../lib/dataverse/core/interlock.js';
import { resolveByEmail } from '../../lib/services/program-director-resolver.js';
import { getUserRole } from '../../lib/utils/auth.js';
import * as service from '../../lib/services/meeting-tracker-transcription/service.js';
import { generatePresentationTranscript } from '../../lib/services/post-presentation-materials/presentation-transcript-service.js';
import * as sentiment from '../../lib/services/post-presentation-materials/discussion-sentiment-service.js';
import { bindCurrent, loadVerifiedDiscussionTranscript } from '../../lib/services/post-presentation-materials/transcript-summary-service.js';
import { buildStaffDiscussionTranscriptText } from '../../lib/services/meeting-tracker-transcription/presentation-boundary.js';

const targets = [
  { number: '1003020', requestId: '8a0efbb3-8d45-f111-88b4-000d3a306da2', artifactId: 'ba985418-4ec7-f111-aaaf-70a8a5b11800', revisionId: 'a1b794c3-a2d4-49f3-bb4a-8d8e5b1b926a' },
  { number: '1003038', requestId: 'caf12b83-9a45-f111-88b4-6045bd0261cd', artifactId: '94fd1093-42c7-f111-aaad-70a8a5af6924', revisionId: 'cec7927b-b936-4d80-86b3-5f731d7800b4' },
];
const receiptPath = '/private/tmp/confirmed-discussion-cleanup-2026-10-18.json';
function save(receipt) { fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 }); }
function safeLabels(record) {
  if (!record || typeof record !== 'object') return;
  for (const [key, value] of Object.entries(record)) {
    if (['speaker', 'speakerLabel'].includes(key) && typeof value === 'string') assert(!/ted abel|jingli|evaan/i.test(value));
    if (value && typeof value === 'object') safeLabels(value);
  }
}
export async function main() {
  const phase = process.argv[2] || '--preflight';
  assert(['--preflight','--prepare','--publish','--analyze','--verify'].includes(phase));
  assert.equal(classifyDeployment(), 'local'); assert.equal(classifyTarget(process.env.DYNAMICS_URL), 'production');
  assert.equal(process.env.DATAVERSE_TARGET_INTERLOCK, 'on');
  assert.equal(process.env.DATAVERSE_ALLOW_PROD_READS, 'yes');
  if (!['--preflight','--verify'].includes(phase)) assert.equal(process.env.DATAVERSE_PROD_WRITE_ACK,
    `owner-confirmed-discussion-repairs-1003020-1003038 ${new Date().toISOString().slice(0,10)}`);
  const profile = (await sql`SELECT id, azure_email, dynamics_systemuser_id, is_active FROM user_profiles WHERE id = 2`).rows[0];
  assert(profile?.is_active); assert.equal(profile.azure_email.toLowerCase(), 'jgallivan@wmkeck.org');
  assert.equal(await getUserRole(profile.id), 'superuser');
  const receipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath)) : { version: 1, requests: {} };
  assert.equal(receipt.version, 1);
  await withDalContext('owner-confirmed-discussion-cleanup', async () => {
    const actor = await resolveByEmail(profile.azure_email);
    assert.equal(actor.systemuserid.toLowerCase(), profile.dynamics_systemuser_id.toLowerCase());
    for (const target of targets) {
      const args = { requestId: target.requestId, ownerProfileId: profile.id, actingUserSystemId: actor.systemuserid };
      const state = receipt.requests[target.number] ||= { requestId: target.requestId };
      assert.equal(state.requestId, target.requestId);
      const overview = await service.getMeetingTranscriptionOverview(args);
      assert.equal(overview.featureState, 'enabled');
      if (phase === '--preflight') {
        assert.equal(overview.currentArtifact.id, target.artifactId);
        const status = await sentiment.getDiscussionSentimentStatus(args);
        console.log(JSON.stringify({ number: target.number, currentArtifact: overview.currentArtifact,
          drafts: overview.correctionDrafts.map(row => ({ id: row.operationId, state: row.state })), sentimentState: status.state, accepted: status.accepted }));
      }
      if (phase === '--prepare') {
        assert.equal(overview.currentArtifact.id, target.artifactId);
        assert(!state.publication && !state.operationId, 'An operation already exists; inspect it rather than recreate.');
        const draft = await service.createMeetingCorrection({ ...args, artifactId: target.artifactId });
        state.operationId = draft.correction.operationId; save(receipt);
        assert.equal(draft.repairId, `confirmed-discussion-v1:${target.revisionId}`);
        const prepared = await service.prepareMeetingAttendance({ ...args, operationId: state.operationId, expectedVersion: draft.correction.version });
        const review = prepared.correction.attendanceReview;
        // Preserve prior explicit voice choices: original sources excluded no speaker IDs. Only
        // newly unidentified turns are excluded; no unrelated staff names are changed by new defaults.
        const kept = review.decision.rows.map(row => row.speakerIds.length > 0 && !row.speakerIds.some(id => id.startsWith('repair_unknown_')));
        const confirmed = await service.updateMeetingCorrection({ ...args, operationId: state.operationId,
          body: { expectedVersion: prepared.correction.version, speakerNames: draft.correction.speakerNames,
            attendanceConfirmation: { reviewId: review.id, kept } } });
        state.version = confirmed.correction.version;
        const final = await service.getMeetingCorrectionDraft({ ...args, operationId: state.operationId });
        const text = buildStaffDiscussionTranscriptText(final.content, final.correction.speakerNames, final.correction.presentationEndMs);
        assert(!/(Ted Abel[^:]*|jingli|evaan):/i.test(text));
        state.prepared = true; save(receipt);
        console.log(JSON.stringify({ number: target.number, prepared: true, operationId: state.operationId, version: state.version }));
      }
      if (phase === '--publish') {
        assert(state.prepared && !state.publication && !state.publishStarted, 'Publication was already attempted; inspect the receipt before retrying.'); assert.equal(overview.currentArtifact.id, target.artifactId);
        state.publishStarted = new Date().toISOString(); save(receipt);
        state.publication = await service.publishMeetingCorrection({ ...args, operationId: state.operationId, body: { expectedVersion: state.version } });
        save(receipt);
        const current = state.publication.currentArtifact;
        state.derivatives = await generatePresentationTranscript({ ...args,
          body: { expectedCurrentArtifactId: current.id, expectedCurrentFingerprint: current.fingerprint } });
        save(receipt); console.log(JSON.stringify({ number: target.number, publication: state.publication, derivatives: state.derivatives }));
      }
      if (phase === '--analyze') {
        assert(state.publication && state.derivatives && !state.analysisStarted);
        assert.equal(overview.currentArtifact.id, state.publication.currentArtifact.id);
        const old = await sentiment.getDiscussionSentimentStatus(args);
        if (old.accepted) { state.withdrawnRunId = old.accepted.id; save(receipt); await sentiment.withdrawDiscussionSentiment({ ...args, runId: old.accepted.id }); }
        state.analysisStarted = new Date().toISOString(); save(receipt);
        const result = await sentiment.analyzeDiscussionSentiment(args);
        safeLabels(result.run.record); state.runId = result.run.id; save(receipt);
        console.log(JSON.stringify({ number: target.number, runId: state.runId, status: result.run.status }));
      }
      if (phase === '--verify') {
        assert(state.publication && state.runId);
        assert.equal(overview.currentArtifact.id, state.publication.currentArtifact.id);
        const status = await sentiment.getDiscussionSentimentStatus(args);
        assert(status.runCurrent); assert.equal(status.run.id, state.runId); safeLabels(status.run.record);
        assert.equal(overview.currentArtifact.staffDiscussionTranscript.state, 'bound');
        const deps = sentiment.DISCUSSION_SENTIMENT_DEPENDENCIES;
        const binding = await deps.loadBinding(target.requestId);
        const loaded = await loadVerifiedDiscussionTranscript(await bindCurrent(target.requestId, deps), binding, target.requestId, deps);
        assert(!/(Ted Abel[^:]*|jingli|evaan):/i.test(loaded.transcriptText));
        const turns = loaded.discussionContent.utterances;
        const confirmed = turns.find(row => row.start === (target.number === '1003020' ? 3699219 : 3730200));
        assert.equal(loaded.speakerNames[confirmed.speaker], 'Justin Gallivan');
        if (target.number === '1003020') {
          assert.equal(loaded.speakerNames[turns.find(row => row.start === 3715109).speaker], 'Beth Pruitt');
          assert(loaded.transcriptText.includes('Beth Pruitt: I was really impressed'));
        } else assert.equal(confirmed.text, 'This is a steaming pile of garbage.');
        console.log(JSON.stringify({ number: target.number, currentArtifact: overview.currentArtifact, runId: state.runId, runCurrent: status.runCurrent, accepted: status.accepted, verification: status.run.record?.verification }));
      }
    }
  });
}
