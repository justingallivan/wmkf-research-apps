/**
 * @jest-environment node
 *
 * Adapter-boundary trust contract for reviewer identity decisions. Only a
 * reviewer self-report may persist `confirmed`; automated writers are capped at
 * `probable`, and stored self-reported attestations remain sticky.
 */
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import {
  IDENTITY_DECISION_ORIGIN,
  writeIdentityDecision,
  clearIdentityFields,
} from '../../lib/dataverse/adapters/researcher.js';

afterEach(() => jest.restoreAllMocks());

const decision = (status) => ({
  status,
  confidenceBand: status === 'confirmed' ? 'high' : 'low',
  resolverVersion: 'x',
  resolvedAt: 'T',
  evidenceSummary: `${status} — evidence`,
  anchors: [],
});

function mockStoredState(storedState) {
  if (storedState === 'read_failure') {
    return jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(new Error('status read failed'));
  }
  return jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ wmkf_identitystatus: storedState });
}

describe('writeIdentityDecision — origin × incoming status × stored state', () => {
  test('automated W4.1 anchors reach the existing verified-anchors memo intact', async () => {
    mockStoredState('probable');
    const updateRecord = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    const input = {
      ...decision('probable'),
      confidenceBand: 'medium',
      resolverVersion: '2.0.0-works-first',
      anchors: [{
        type: 'authorship_grounded',
        canonicalKey: 'openalex:A100',
        sourceUrl: 'https://openalex.org/A100',
        verifier: 'reviewerWorksFirst@2.0.0-works-first',
        parserOutput: { anchorDois: ['10.1000/one'] },
      }],
    };

    await writeIdentityDecision('pr-1', input, {
      identityOrigin: IDENTITY_DECISION_ORIGIN.AUTOMATED,
    });

    expect(JSON.parse(
      updateRecord.mock.calls[0][2].wmkf_identityverifiedanchorsjson,
    )).toEqual([{
      type: 'authorship_grounded',
      canonicalKey: 'openalex:A100',
      sourceUrl: 'https://openalex.org/A100',
      verifier: 'reviewerWorksFirst@2.0.0-works-first',
    }]);
  });

  describe.each(['confirmed', 'probable', 'read_failure'])('self_report, stored=%s', (storedState) => {
    test('confirmed writes a fresh attestation without reading stored state', async () => {
      const getRecord = mockStoredState(storedState);
      const updateRecord = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

      await writeIdentityDecision('pr-1', decision('confirmed'), {
        identityOrigin: IDENTITY_DECISION_ORIGIN.SELF_REPORT,
      });

      expect(getRecord).not.toHaveBeenCalled();
      expect(updateRecord).toHaveBeenCalledTimes(1);
      expect(updateRecord.mock.calls[0][2].wmkf_identitystatus).toBe('confirmed');
    });

    test('non-confirmed rejects before any read or write', async () => {
      const getRecord = mockStoredState(storedState);
      const updateRecord = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

      await expect(writeIdentityDecision('pr-1', decision('probable'), {
        identityOrigin: IDENTITY_DECISION_ORIGIN.SELF_REPORT,
      })).rejects.toThrow('self_report origin requires confirmed status');

      expect(getRecord).not.toHaveBeenCalled();
      expect(updateRecord).not.toHaveBeenCalled();
    });
  });

  describe.each(['confirmed', 'probable', 'read_failure'])('automated, stored=%s', (storedState) => {
    test.each([
      ['confirmed', 'probable'],
      ['unresolved', 'unresolved'],
    ])('incoming %s obeys the sticky guard and persists as %s', async (incomingStatus, persistedStatus) => {
      mockStoredState(storedState);
      const updateRecord = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
      const input = decision(incomingStatus);

      const promise = writeIdentityDecision('pr-1', input, {
        identityOrigin: IDENTITY_DECISION_ORIGIN.AUTOMATED,
      });

      if (storedState === 'read_failure') {
        await expect(promise).rejects.toThrow('status read failed');
        expect(updateRecord).not.toHaveBeenCalled();
      } else {
        await promise;
        if (storedState === 'confirmed') {
          expect(updateRecord).not.toHaveBeenCalled();
        } else {
          expect(updateRecord).toHaveBeenCalledTimes(1);
          expect(updateRecord.mock.calls[0][2].wmkf_identitystatus).toBe(persistedStatus);
          if (incomingStatus === 'confirmed') {
            expect(updateRecord.mock.calls[0][2].wmkf_identityconfidenceband).toBe('medium');
            expect(updateRecord.mock.calls[0][2].wmkf_identityevidencesummary)
              .toBe('probable — automated high-confidence decision capped at persistence boundary; evidence');
          }
        }
      }
      expect(input.status).toBe(incomingStatus);
      expect(input.confidenceBand).toBe(incomingStatus === 'confirmed' ? 'high' : 'low');
      expect(input.evidenceSummary).toBe(`${incomingStatus} — evidence`);
    });
  });

  describe.each(['confirmed', 'probable', 'read_failure'])('unknown origin, stored=%s', (storedState) => {
    test.each(['confirmed', 'unresolved'])('incoming %s rejects before any read or write', async (incomingStatus) => {
      const getRecord = mockStoredState(storedState);
      const updateRecord = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

      await expect(writeIdentityDecision('pr-1', decision(incomingStatus), {
        identityOrigin: 'unknown',
      })).rejects.toThrow('explicit identityOrigin required');

      expect(getRecord).not.toHaveBeenCalled();
      expect(updateRecord).not.toHaveBeenCalled();
    });
  });

  test.each([undefined, {}, { status: 'invented' }])('missing or unsupported decision status rejects', async (input) => {
    const getRecord = jest.spyOn(DynamicsService, 'getRecord');
    const updateRecord = jest.spyOn(DynamicsService, 'updateRecord');

    await expect(writeIdentityDecision('pr-1', input, {
      identityOrigin: IDENTITY_DECISION_ORIGIN.AUTOMATED,
    })).rejects.toThrow('known decision status required');

    expect(getRecord).not.toHaveBeenCalled();
    expect(updateRecord).not.toHaveBeenCalled();
  });
});

describe('clearIdentityFields — origin × stored state', () => {
  test('automated + stored confirmed skips the clear', async () => {
    mockStoredState('confirmed');
    const updateRecord = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await clearIdentityFields('pr-1', ['wmkf_orcid'], {
      identityOrigin: IDENTITY_DECISION_ORIGIN.AUTOMATED,
    });

    expect(updateRecord).not.toHaveBeenCalled();
  });

  test('automated + stored non-confirmed clears fields', async () => {
    mockStoredState('probable');
    const updateRecord = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await clearIdentityFields('pr-1', ['wmkf_orcid', 'wmkf_orcidurl'], {
      identityOrigin: IDENTITY_DECISION_ORIGIN.AUTOMATED,
    });

    expect(updateRecord.mock.calls[0][2]).toEqual({ wmkf_orcid: null, wmkf_orcidurl: null });
  });

  test('automated + read failure fails closed', async () => {
    mockStoredState('read_failure');
    const updateRecord = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    await expect(clearIdentityFields('pr-1', ['wmkf_orcid'], {
      identityOrigin: IDENTITY_DECISION_ORIGIN.AUTOMATED,
    })).rejects.toThrow('status read failed');

    expect(updateRecord).not.toHaveBeenCalled();
  });

  test.each([
    IDENTITY_DECISION_ORIGIN.SELF_REPORT,
    'unknown',
    undefined,
  ])('%s origin rejects before any read or clear', async (identityOrigin) => {
    const getRecord = jest.spyOn(DynamicsService, 'getRecord');
    const updateRecord = jest.spyOn(DynamicsService, 'updateRecord');

    await expect(clearIdentityFields('pr-1', ['wmkf_orcid'], { identityOrigin }))
      .rejects.toThrow('explicit identityOrigin required');

    expect(getRecord).not.toHaveBeenCalled();
    expect(updateRecord).not.toHaveBeenCalled();
  });

  test('empty-field no-op still requires an explicit automated origin', async () => {
    const getRecord = jest.spyOn(DynamicsService, 'getRecord');
    const updateRecord = jest.spyOn(DynamicsService, 'updateRecord');

    await expect(clearIdentityFields('pr-1', [], { identityOrigin: 'unknown' }))
      .rejects.toThrow('explicit identityOrigin required');
    await expect(clearIdentityFields('pr-1', [], {
      identityOrigin: IDENTITY_DECISION_ORIGIN.AUTOMATED,
    })).resolves.toBeUndefined();

    expect(getRecord).not.toHaveBeenCalled();
    expect(updateRecord).not.toHaveBeenCalled();
  });
});
