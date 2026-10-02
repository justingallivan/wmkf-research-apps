/** @jest-environment node */

const {
  REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY_FLAG,
  isRequestDocumentExplicitActorSchemaReady,
  requestDocumentExplicitActorReadinessHealth,
} = require('../../lib/utils/request-document-explicit-actor-readiness');

test('only literal on enables Wave 24 schema access', () => {
  for (const value of [undefined, '', 'off', 'true', 'ON', 'invalid']) {
    expect(isRequestDocumentExplicitActorSchemaReady({
      ...(value === undefined ? {} : { [REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY_FLAG]: value }),
    })).toBe(false);
  }
  expect(isRequestDocumentExplicitActorSchemaReady({
    [REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY_FLAG]: 'on',
  })).toBe(true);
});

test('Production is unhealthy while deployed Wave 24 code remains disabled', () => {
  expect(requestDocumentExplicitActorReadinessHealth({ VERCEL_ENV: 'production' }))
    .toMatchObject({ status: 'error' });
  expect(requestDocumentExplicitActorReadinessHealth({
    VERCEL_ENV: 'production',
    [REQUEST_DOCUMENT_EXPLICIT_ACTOR_SCHEMA_READY_FLAG]: 'on',
  })).toMatchObject({ status: 'ok' });
});

test('non-Production environments may remain explicitly disabled', () => {
  expect(requestDocumentExplicitActorReadinessHealth({ VERCEL_ENV: 'preview' }))
    .toMatchObject({ status: 'skipped' });
});

test('Meeting Transcript manifest selection requires both opt-in and literal-on readiness', () => {
  const { requestDocumentSelect } = require('../../lib/dataverse/adapters/request-document');
  const original = process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
  try {
    delete process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
    expect(requestDocumentSelect({ includeMeetingTranscriptBundle: true })).not.toContain('wmkf_transcriptbundlejson');
    process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'on';
    expect(requestDocumentSelect()).not.toContain('wmkf_transcriptbundlejson');
    expect(requestDocumentSelect({ includeMeetingTranscriptBundle: true })).toContain('wmkf_transcriptbundlejson');
  } finally {
    if (original === undefined) delete process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
    else process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = original;
  }
});
