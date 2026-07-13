/**
 * @jest-environment node
 *
 * Reviewer self-reported ORCID capture (reviewer-side twin of PR3). Locks:
 * a valid self-reported iD writes the person (overwrite + 'confirmed') AND fills
 * the contact join key; an invalid iD / missing person abstains; URL-form input
 * normalizes; the contact write is skipped (person-only) when no contact exists.
 */
import { captureSelfReportedReviewerOrcid } from '../../lib/services/capture-self-reported-orcid.js';
import { IdentityBindingWriteError } from '../../lib/services/reviewer-identity-binding-writer.js';

const VALID = '0000-0002-1825-0097';

function deps() {
  return {
    researcher: {
      updateById: jest.fn().mockResolvedValue(undefined),
      writeIdentityDecision: jest.fn().mockResolvedValue(undefined),
    },
    contacts: {
      setOrcidIfAbsent: jest.fn().mockResolvedValue({ action: 'write', orcid: VALID }),
    },
    writeBinding: jest.fn().mockResolvedValue({ outcome: 'init' }),
  };
}

describe('captureSelfReportedReviewerOrcid', () => {
  test('valid iD + contact → person overwrite + confirmed status + contact fill', async () => {
    const d = deps();
    const out = await captureSelfReportedReviewerOrcid(
      { potentialReviewerId: 'pr-1', rawOrcid: `https://orcid.org/${VALID}`, contactId: 'c-1', actingUserSystemId: 'u1', now: 'T0' },
      d,
    );
    expect(out).toEqual({ persisted: true, orcid: VALID, contact: { action: 'write', orcid: VALID } });

    // Person: overwrite both iD fields (self-report beats a resolver guess).
    expect(d.researcher.updateById).toHaveBeenCalledWith('pr-1',
      { orcid: VALID, orcidUrl: `https://orcid.org/${VALID}` }, { actingUserSystemId: 'u1' });

    // Identity decision: a sticky 'confirmed' human attestation with a self-report anchor.
    const [prId, decision, opts] = d.researcher.writeIdentityDecision.mock.calls[0];
    expect(prId).toBe('pr-1');
    expect(decision.status).toBe('confirmed');
    expect(decision.resolvedAt).toBe('T0');
    expect(decision.anchors[0].type).toBe('self_reported_orcid');
    expect(decision.anchors[0].canonicalKey).toBe(`orcid:${VALID}`);
    expect(opts).toEqual({ actingUserSystemId: 'u1', identityOrigin: 'self_report' });

    // Contact: fill-only join-key write.
    expect(d.contacts.setOrcidIfAbsent).toHaveBeenCalledWith('c-1', VALID, { actingUserSystemId: 'u1' });
  });

  test('no contact → person-only (no contact write attempted)', async () => {
    const d = deps();
    const out = await captureSelfReportedReviewerOrcid({ potentialReviewerId: 'pr-1', rawOrcid: VALID }, d);
    expect(out).toEqual({ persisted: true, orcid: VALID, contact: null });
    expect(d.researcher.updateById).toHaveBeenCalled();
    expect(d.researcher.writeIdentityDecision).toHaveBeenCalled();
    expect(d.contacts.setOrcidIfAbsent).not.toHaveBeenCalled();
  });

  test('stable acceptance timestamp uses the durable writer before contact fill', async () => {
    const d = deps();
    const bindingEventAt = '2026-07-01T10:00:00.347Z';
    // Dataverse persists DateTime at second precision — the event identity is
    // truncated before the writer so a retry replays as an exact no-op.
    const persistedEventAt = '2026-07-01T10:00:00.000Z';

    const out = await captureSelfReportedReviewerOrcid({
      potentialReviewerId: 'pr-1',
      rawOrcid: VALID,
      contactId: 'c-1',
      actingUserSystemId: 'u1',
      bindingEventAt,
    }, d);

    expect(out).toEqual({ persisted: true, orcid: VALID, contact: { action: 'write', orcid: VALID } });
    expect(d.writeBinding).toHaveBeenCalledWith({
      potentialReviewerId: 'pr-1',
      actingUserSystemId: 'u1',
      event: {
        source: 'self_reported',
        anchor: `orcid:${VALID}`,
        boundAt: persistedEventAt,
        fieldMode: 'partial',
        fields: {
          wmkf_orcid: VALID,
          wmkf_orcidurl: `https://orcid.org/${VALID}`,
        },
        decision: expect.objectContaining({
          status: 'confirmed',
          resolvedAt: persistedEventAt,
        }),
      },
    });
    expect(d.researcher.updateById).not.toHaveBeenCalled();
    expect(d.researcher.writeIdentityDecision).not.toHaveBeenCalled();
    expect(d.writeBinding.mock.invocationCallOrder[0])
      .toBeLessThan(d.contacts.setOrcidIfAbsent.mock.invocationCallOrder[0]);
  });

  test('whole-second and second-precision acceptance timestamps pass through unchanged', async () => {
    const d = deps();
    await captureSelfReportedReviewerOrcid({
      potentialReviewerId: 'pr-1',
      rawOrcid: VALID,
      bindingEventAt: '2026-07-01T10:00:00.000Z',
    }, d);
    expect(d.writeBinding.mock.calls[0][0].event.boundAt).toBe('2026-07-01T10:00:00.000Z');

    await captureSelfReportedReviewerOrcid({
      potentialReviewerId: 'pr-1',
      rawOrcid: VALID,
      bindingEventAt: '2026-07-01T10:00:00Z',
    }, d);
    expect(d.writeBinding.mock.calls[1][0].event.boundAt).toBe('2026-07-01T10:00:00.000Z');
  });

  test('unparseable acceptance timestamp still fails closed in the writer (no silent legacy path)', async () => {
    const d = deps();
    d.writeBinding.mockRejectedValueOnce(new IdentityBindingWriteError(
      'invalid_event',
      'boundAt must be a canonical ISO UTC timestamp',
    ));

    await expect(captureSelfReportedReviewerOrcid({
      potentialReviewerId: 'pr-1',
      rawOrcid: VALID,
      contactId: 'c-1',
      bindingEventAt: 'not-a-timestamp',
    }, d)).rejects.toThrow('boundAt must be a canonical ISO UTC timestamp');

    // The malformed value reaches the writer verbatim for fail-closed
    // rejection instead of being coerced onto the transitional path.
    expect(d.writeBinding.mock.calls[0][0].event.boundAt).toBe('not-a-timestamp');
    expect(d.researcher.updateById).not.toHaveBeenCalled();
    expect(d.contacts.setOrcidIfAbsent).not.toHaveBeenCalled();
  });

  test('dirty legacy row falls back only on the typed classification error', async () => {
    const d = deps();
    d.writeBinding.mockRejectedValueOnce(new IdentityBindingWriteError(
      'legacy_classification_required',
      'legacy identity fields require explicit classification before first binding',
    ));

    await captureSelfReportedReviewerOrcid({
      potentialReviewerId: 'pr-1',
      rawOrcid: VALID,
      contactId: 'c-1',
      actingUserSystemId: 'u1',
      bindingEventAt: '2026-07-01T10:00:00.347Z',
    }, d);

    expect(d.researcher.updateById).toHaveBeenCalledTimes(1);
    expect(d.researcher.writeIdentityDecision).toHaveBeenCalledTimes(1);
    // The fallback shares the truncated event identity with the durable path.
    expect(d.researcher.writeIdentityDecision.mock.calls[0][1].resolvedAt)
      .toBe('2026-07-01T10:00:00.000Z');
    expect(d.contacts.setOrcidIfAbsent).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['unexpected writer failure', new Error('Dataverse unavailable')],
    ['untyped legacy-shaped failure', Object.assign(new Error('legacy-shaped'), { code: 'legacy_classification_required' })],
    ['blocked transition', null],
    ['missing writer result', 'missing'],
    ['unknown writer outcome', 'unknown'],
  ])('%s fails closed before legacy or contact writes', async (_label, writerError) => {
    const d = deps();
    if (writerError === null) {
      d.writeBinding.mockResolvedValueOnce({ outcome: 'blocked', reason: 'unsupported_binding_transition' });
    } else if (writerError === 'missing') {
      d.writeBinding.mockResolvedValueOnce(undefined);
    } else if (writerError === 'unknown') {
      d.writeBinding.mockResolvedValueOnce({ outcome: 'future_outcome' });
    } else {
      d.writeBinding.mockRejectedValueOnce(writerError);
    }

    await expect(captureSelfReportedReviewerOrcid({
      potentialReviewerId: 'pr-1',
      rawOrcid: VALID,
      contactId: 'c-1',
      bindingEventAt: '2026-07-01T10:00:00.000Z',
    }, d)).rejects.toThrow();

    expect(d.researcher.updateById).not.toHaveBeenCalled();
    expect(d.researcher.writeIdentityDecision).not.toHaveBeenCalled();
    expect(d.contacts.setOrcidIfAbsent).not.toHaveBeenCalled();
  });

  test('invalid / malformed iD → skip, no writes', async () => {
    const d = deps();
    expect(await captureSelfReportedReviewerOrcid({ potentialReviewerId: 'pr-1', rawOrcid: '1234567', contactId: 'c-1' }, d))
      .toEqual({ skipped: 'invalid_orcid', state: 'malformed' });
    expect(await captureSelfReportedReviewerOrcid({ potentialReviewerId: 'pr-1', rawOrcid: '', contactId: 'c-1' }, d))
      .toEqual({ skipped: 'invalid_orcid', state: 'empty' });
    expect(d.researcher.updateById).not.toHaveBeenCalled();
    expect(d.researcher.writeIdentityDecision).not.toHaveBeenCalled();
    expect(d.contacts.setOrcidIfAbsent).not.toHaveBeenCalled();
  });

  test('checksum-invalid (right shape) → skip', async () => {
    const d = deps();
    const out = await captureSelfReportedReviewerOrcid({ potentialReviewerId: 'pr-1', rawOrcid: '0000-0002-1825-0098' }, d);
    expect(out).toEqual({ skipped: 'invalid_orcid', state: 'malformed' });
    expect(d.researcher.updateById).not.toHaveBeenCalled();
  });

  test('missing person id → skip no_person (even with a valid iD)', async () => {
    const d = deps();
    const out = await captureSelfReportedReviewerOrcid({ rawOrcid: VALID, contactId: 'c-1' }, d);
    expect(out).toEqual({ skipped: 'no_person' });
    expect(d.contacts.setOrcidIfAbsent).not.toHaveBeenCalled();
  });
});
