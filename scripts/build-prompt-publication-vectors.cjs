#!/usr/bin/env node
/** Offline reviewed golden fixture refresh. No environment/services/network. */
const fs = require('node:fs');
const path = require('node:path');
const { canonicalPreimage } = require('../lib/prompt-publication/json-contract');
const { hashSnapshot, publicationFingerprint } = require('../lib/prompt-publication/fingerprint');
const { POLICY_ARTIFACT } = require('../lib/prompt-publication/template-policy');
const root = path.resolve(__dirname, '..');
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const actor = { organizationId: id(1), initiatingUserId: id(2), effectiveUserId: id(3) };
const catalog = { title: null, description: null, groupKey: null, sectionKey: null, usedBy: null, usageCategory: null };
const definition = { name: 'pa.summary', systemPrompt: '', body: '{{x}}\r\nRésumé 😀', variables: '{ "variables": [{"name":"x","source":{"kind":"override"}}] }', outputSchema: '{"parseMode":"raw","outputs":[{"name":"answer","target":{"kind":"none"}}]}', model: 'sonnet', maxTokens: 1000, temperature: 0.7 };
const snapshot = { definitionFormatVersion: 1, definition, catalog: { ...catalog, title: 'Summary', description: 'Summarizes text', groupKey: 'reviews', usedBy: 'Future PA flow', usageCategory: 'declared' } };
const snapshotVector = hashSnapshot(snapshot);
const request = { contractVersion: 1, definitionFormatVersion: 1, policyRevision: POLICY_ARTIFACT.policy.policyVersion, policyArtifactHash: POLICY_ARTIFACT.hash, requestId: id(4), operation: 'publish', promptKey: 'pa.summary', draftId: id(5), draftEtag: 'W/"12"', expectedHeadRevision: '0', expectedCurrent: null, metadataBaseline: { schemaVersion: 1, current: null, catalog, headRevision: '0' }, snapshotHash: snapshotVector.hash };
const first = publicationFingerprint(request, actor);
const later = { ...request, requestId: id(7), expectedHeadRevision: '9007199254740993', expectedCurrent: { id: id(8), version: 7, etag: 'W/"99"' }, metadataBaseline: { schemaVersion: 1, current: { id: id(8), etag: 'W/"99"' }, headRevision: '9007199254740993', catalog: { ...catalog, title: 'Prior' } } };
const result = {
  canonicalizationVersion: 1,
  canonical: [null, true, 0, 0.7, { b: 0.5, a: 'é\r\n😀' }, { '10': 1, '2': 2 }, ['a', null]].map(input => ({ input, preimage: canonicalPreimage(input) })),
  snapshot: { input: snapshot, ...snapshotVector },
  requests: [{ input: request, actor, ...first }, { input: later, actor, ...publicationFingerprint(later, actor) }],
  receipt: { receiptVersion: 1, fingerprintVersion: 1, request, actor, requestFingerprint: first.hash, published: { id: id(5), version: 1, etag: 'W/"15"' }, headRevision: '1', publishedAt: '2026-10-30T00:00:00.000Z' },
};
const output = path.join(root, 'tests/fixtures/prompt-publication/fingerprints-v1.json');
const bytes = JSON.stringify(result, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(output, 'utf8') !== bytes) throw new Error('Fingerprint fixture drift: review and refresh vectors explicitly.');
  console.log('Fingerprint golden vectors match.');
} else { fs.writeFileSync(output, bytes); console.log('Wrote fingerprint golden vectors.'); }
