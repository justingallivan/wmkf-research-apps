/** @jest-environment node */

const {
  projectStageEnvelope,
  STAGE_EVIDENCE_KEYS,
} = require('../../lib/services/workbench/reviewer-stage-projector');
const { CONTRACT_VERSIONS } = require('../../lib/services/reviewer-stage-freshness');

const SOURCE_VERSION = 'a'.repeat(64);
const GENERIC_DATAVERSE_GUID = '17e1c7ae-c844-f111-88b5-000d3a3065b8';

function envelope(overrides = {}) {
  return {
    outcome: 'current',
    evidencePatch: { applicantInputVersion: 'applicant-input:v1' },
    receipt: {
      state: 'current',
      contractVersion: CONTRACT_VERSIONS.applicant_anchor,
      sourceVersion: SOURCE_VERSION,
      resultVersion: 'applicant-anchor-result:v1',
      completedAt: '2026-08-02T00:00:00.000Z',
      reasonCode: null,
      failureCode: null,
    },
    ...overrides,
  };
}

test('projects only a closed, bounded stage envelope', () => {
  const result = projectStageEnvelope({
    stage: 'applicant_anchor',
    mode: 'manual_refresh',
    envelope: envelope(),
  });
  expect(result).toEqual({
    ok: true,
    value: {
      evidencePatch: { applicantInputVersion: 'applicant-input:v1' },
      receipt: expect.objectContaining({ state: 'current', resultVersion: 'applicant-anchor-result:v1' }),
    },
  });
});

test('rejects client-shaped evidence, unsealed results, and unsupported modes before persistence', () => {
  expect(projectStageEnvelope({
    stage: 'applicant_anchor',
    mode: 'manual_refresh',
    envelope: envelope({ evidencePatch: { stageFreshness: { identity: 'forged' } } }),
  })).toEqual({ ok: false, code: 'evidence_key_rejected' });
  expect(projectStageEnvelope({
    stage: 'applicant_anchor',
    mode: 'manual_refresh',
    envelope: envelope({ receipt: { ...envelope().receipt, resultVersion: null } }),
  })).toEqual({ ok: false, code: 'invalid_result_version' });
  expect(projectStageEnvelope({
    stage: 'unknown_stage',
    mode: 'manual_refresh',
    envelope: envelope(),
  })).toEqual({ ok: false, code: 'unknown_stage' });
  expect(projectStageEnvelope({
    stage: 'applicant_anchor',
    mode: 'warm_auto_provider',
    envelope: envelope(),
  })).toEqual({ ok: false, code: 'invalid_execution_mode' });
  expect(projectStageEnvelope({
    stage: 'applicant_anchor',
    mode: 'manual_refresh',
    envelope: envelope({ receipt: { ...envelope().receipt, sourceVersion: 'source_version_missing' } }),
  })).toEqual({ ok: false, code: 'invalid_source_version' });
});

test('requires closed N/A and failure codes rather than provider prose', () => {
  const na = envelope({
    outcome: 'not_applicable',
    evidencePatch: {},
    receipt: {
      ...envelope().receipt,
      state: 'not_applicable',
      reasonCode: 'provider says no',
      completedAt: '2026-08-02T00:00:00.000Z',
    },
  });
  expect(projectStageEnvelope({ stage: 'applicant_anchor', mode: 'cold_emit', envelope: na }))
    .toEqual({ ok: false, code: 'invalid_reason_code' });
  const failure = envelope({
    outcome: 'failed',
    evidencePatch: {},
    receipt: {
      ...envelope().receipt,
      state: 'failed',
      completedAt: null,
      failureCode: 'provider says sorry',
    },
  });
  expect(projectStageEnvelope({ stage: 'applicant_anchor', mode: 'manual_refresh', envelope: failure }))
    .toEqual({ ok: false, code: 'invalid_failure_code' });
});

test('accepts only a sealed proposal-author fingerprint from the coauthor producer', () => {
  const good = 'a'.repeat(64);
  expect(projectStageEnvelope({
    stage: 'coauthor_coi',
    mode: 'cold_emit',
    envelope: {
      outcome: 'current',
      evidencePatch: { proposalAuthorVersion: good },
      receipt: {
        state: 'current',
        contractVersion: CONTRACT_VERSIONS.coauthor_coi,
        sourceVersion: SOURCE_VERSION,
        resultVersion: 'coauthor-result:v1',
        completedAt: '2026-08-02T00:00:00.000Z',
        reasonCode: null,
        failureCode: null,
      },
    },
  })).toEqual(expect.objectContaining({ ok: true }));
  expect(projectStageEnvelope({
    stage: 'coauthor_coi',
    mode: 'cold_emit',
    envelope: {
      outcome: 'current',
      evidencePatch: { proposalAuthorVersion: 'proposal author names must not persist here' },
      receipt: {
        state: 'current',
        contractVersion: CONTRACT_VERSIONS.coauthor_coi,
        sourceVersion: SOURCE_VERSION,
        resultVersion: 'coauthor-result:v1',
        completedAt: '2026-08-02T00:00:00.000Z',
        reasonCode: null,
        failureCode: null,
      },
    },
  })).toEqual({ ok: false, code: 'evidence_value_rejected' });
});

test('accepts a coupled server person version only from contact evidence and rejects partial or malformed injection', () => {
  const contactReceipt = {
    state: 'current', contractVersion: CONTRACT_VERSIONS.contact,
    sourceVersion: SOURCE_VERSION, resultVersion: 'contact-result:v1',
    completedAt: '2026-08-02T00:00:00.000Z', reasonCode: null, failureCode: null,
  };
  const evidencePatch = {
    canonicalPersonId: GENERIC_DATAVERSE_GUID,
    canonicalPersonEtag: 'W/"person-1"',
    personEtag: 'W/"person-1"',
  };
  expect(projectStageEnvelope({
    stage: 'contact', mode: 'manual_refresh', envelope: {
      outcome: 'current', evidencePatch, receipt: contactReceipt,
    },
  })).toMatchObject({
    ok: true,
    value: { evidencePatch: expect.objectContaining(evidencePatch) },
  });
  expect(projectStageEnvelope({
    stage: 'contact', mode: 'manual_refresh', envelope: {
      outcome: 'current', evidencePatch: { canonicalPersonId: evidencePatch.canonicalPersonId }, receipt: contactReceipt,
    },
  })).toEqual({ ok: false, code: 'evidence_value_rejected' });
  expect(projectStageEnvelope({
    stage: 'identity', mode: 'manual_refresh', envelope: {
      outcome: 'current', evidencePatch: { canonicalPersonId: evidencePatch.canonicalPersonId }, receipt: {
        ...contactReceipt, contractVersion: CONTRACT_VERSIONS.identity,
      },
    },
  })).toEqual({ ok: false, code: 'evidence_key_rejected' });

  const longEtag = 'W/"'.concat('e'.repeat(220), '"');
  expect(projectStageEnvelope({
    stage: 'contact', mode: 'manual_refresh', envelope: {
      outcome: 'current',
      evidencePatch: {
        canonicalPersonId: evidencePatch.canonicalPersonId,
        canonicalPersonEtag: longEtag,
        personEtag: longEtag,
      },
      receipt: contactReceipt,
    },
  })).toMatchObject({ ok: true });
});

test('requires a closed, server-attested address evidence shape', () => {
  const receipt = {
    state: 'current', contractVersion: CONTRACT_VERSIONS.address_trust,
    sourceVersion: SOURCE_VERSION, resultVersion: 'address-result:v1',
    completedAt: '2026-08-02T00:00:00.000Z', reasonCode: null, failureCode: null,
  };
  const evidence = {
    canonicalPersonId: GENERIC_DATAVERSE_GUID,
    canonicalPersonEtag: 'W/"person-1"', actorId: 'staff-1',
    attestedAt: '2026-08-02T00:00:00.000Z', evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/jane',
  };
  expect(projectStageEnvelope({
    stage: 'address_trust', mode: 'manual_refresh', envelope: {
      outcome: 'current', evidencePatch: { addressTrustEvidence: evidence }, receipt,
    },
  })).toMatchObject({ ok: true });
  expect(projectStageEnvelope({
    stage: 'address_trust', mode: 'manual_refresh', envelope: {
      outcome: 'current', evidencePatch: { addressTrustEvidence: { ...evidence, rawProviderBody: 'forged' } }, receipt,
    },
  })).toEqual({ ok: false, code: 'evidence_value_rejected' });
});

test('rejects malformed nested staff identity confirmation before it can seed authority', () => {
  const receipt = {
    state: 'current', contractVersion: CONTRACT_VERSIONS.identity,
    sourceVersion: SOURCE_VERSION, resultVersion: 'identity-result:v1',
    completedAt: '2026-08-02T00:00:00.000Z', reasonCode: null, failureCode: null,
  };
  const valid = {
    state: 'confirmed',
    canonicalPersonId: GENERIC_DATAVERSE_GUID,
    canonicalPersonEtag: 'W/"person-1"',
    actorId: 'staff-1',
    confirmedAt: '2026-08-02T00:00:00.000Z',
  };
  expect(projectStageEnvelope({
    stage: 'identity', mode: 'manual_refresh', envelope: {
      outcome: 'current', evidencePatch: { staffIdentityConfirmation: valid }, receipt,
    },
  })).toMatchObject({ ok: true });
  expect(projectStageEnvelope({
    stage: 'identity', mode: 'manual_refresh', envelope: {
      outcome: 'current', evidencePatch: {
        staffIdentityConfirmation: { ...valid, canonicalPersonId: 'person-1' },
      }, receipt,
    },
  })).toEqual({ ok: false, code: 'evidence_value_rejected' });
});

test('requires a bounded, closed coauthor coverage vector for failed-author-only retry', () => {
  const receipt = {
    state: 'current', contractVersion: CONTRACT_VERSIONS.coauthor_coi,
    sourceVersion: SOURCE_VERSION, resultVersion: 'coauthor-result:v1',
    completedAt: '2026-08-02T00:00:00.000Z', reasonCode: null, failureCode: null,
  };
  expect(projectStageEnvelope({
    stage: 'coauthor_coi', mode: 'cold_emit', envelope: {
      outcome: 'current',
      evidencePatch: {
        coauthorAuthorResults: [{
          author: 'Alex Author', status: 'complete', sharedPaperCount: 0, papers: [],
        }, {
          author: 'Blair Author', status: 'failed', sharedPaperCount: 0, papers: [],
        }],
      },
      receipt,
    },
  })).toEqual(expect.objectContaining({ ok: true }));
  expect(projectStageEnvelope({
    stage: 'coauthor_coi', mode: 'cold_emit', envelope: {
      outcome: 'current',
      evidencePatch: {
        coauthorAuthorResults: [{ author: 'Alex', status: 'unknown', sharedPaperCount: 0 }],
      },
      receipt,
    },
  })).toEqual({ ok: false, code: 'evidence_value_rejected' });
  expect(projectStageEnvelope({
    stage: 'coauthor_coi', mode: 'cold_emit', envelope: {
      outcome: 'current',
      evidencePatch: {
        coauthorAuthorResults: Array.from({ length: 17 }, (_, index) => ({
          author: `Author ${index}`, status: 'complete', sharedPaperCount: 0,
        })),
      },
      receipt,
    },
  })).toEqual({ ok: false, code: 'evidence_value_rejected' });
});

test('registration has an explicit allowlist for every fresh stage', () => {
  expect(Object.keys(STAGE_EVIDENCE_KEYS).sort())
    .toEqual(Object.keys(CONTRACT_VERSIONS).sort());
});
