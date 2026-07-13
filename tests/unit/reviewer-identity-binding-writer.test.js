/**
 * @jest-environment node
 */

import {
  IdentityBindingWriteError,
  planIdentityBindingTransition,
  writeReviewerIdentityBinding,
} from '../../lib/services/reviewer-identity-binding-writer.js';
import {
  IDENTITY_LINEAGE_FIELDS,
  serializeIdentityFieldLineage,
} from '../../lib/services/reviewer-identity-binding-contract.js';

const ORCID_A = '0000-0002-1825-0097';
const ORCID_B = '0000-0001-5109-3700';
const T1 = '2026-07-12T20:00:00.000Z';
const T2 = '2026-07-13T20:00:00.000Z';
const STAFF_A = 'staff-attestation:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const EMPTY_VALUES = Object.freeze(Object.fromEntries(IDENTITY_LINEAGE_FIELDS.map((field) => [field, null])));

function automatedDecision(overrides = {}) {
  return {
    status: 'confirmed',
    confidenceBand: 'high',
    resolverVersion: 'resolver@1',
    resolvedAt: T1,
    evidenceSummary: 'confirmed — evidence',
    anchors: [],
    ...overrides,
  };
}

function humanDecision(overrides = {}) {
  return {
    status: 'confirmed',
    confidenceBand: 'high',
    resolverVersion: 'human@1',
    resolvedAt: T1,
    evidenceSummary: 'Human attestation',
    anchors: [],
    ...overrides,
  };
}

function automatedEvent(overrides = {}) {
  return {
    source: 'automated',
    anchor: `orcid:${ORCID_A}`,
    boundAt: T1,
    fieldMode: 'replacement',
    fields: {
      wmkf_orcid: ORCID_A,
      wmkf_orcidurl: `https://orcid.org/${ORCID_A}`,
      wmkf_hindex: 10,
    },
    decision: automatedDecision(),
    ...overrides,
  };
}

function selfEvent(overrides = {}) {
  return {
    source: 'self_reported',
    anchor: `orcid:${ORCID_B}`,
    boundAt: T2,
    fieldMode: 'partial',
    fields: {
      wmkf_orcid: ORCID_B,
      wmkf_orcidurl: `https://orcid.org/${ORCID_B}`,
    },
    decision: humanDecision({ resolvedAt: T2 }),
    ...overrides,
  };
}

function staffEvent(overrides = {}) {
  return {
    source: 'staff_confirmed',
    anchor: STAFF_A,
    boundAt: T2,
    fieldMode: 'partial',
    fields: {},
    decision: humanDecision({ resolvedAt: T2, resolverVersion: 'staff@1' }),
    ...overrides,
  };
}

function persistedAutomatedDecision(overrides = {}) {
  return {
    wmkf_identitystatus: 'probable',
    wmkf_identityconfidenceband: 'medium',
    wmkf_identityresolverversion: 'resolver@1',
    wmkf_identityresolvedat: T1,
    wmkf_identityevidencesummary: 'probable — automated high-confidence decision capped at persistence boundary; evidence',
    wmkf_identityverifiedanchorsjson: '[]',
    ...overrides,
  };
}

function persistedHumanDecision(overrides = {}) {
  return {
    wmkf_identitystatus: 'confirmed',
    wmkf_identityconfidenceband: 'high',
    wmkf_identityresolverversion: 'human@1',
    wmkf_identityresolvedat: T1,
    wmkf_identityevidencesummary: 'Human attestation',
    wmkf_identityverifiedanchorsjson: '[]',
    ...overrides,
  };
}

function unboundRow(overrides = {}) {
  return {
    _etag: 'W/"0"',
    wmkf_identitybindingversion: null,
    wmkf_identitybindingsource: null,
    wmkf_identitybindinganchor: null,
    wmkf_identityboundat: null,
    wmkf_identityderivedbindingversion: null,
    wmkf_identityfieldlineagejson: null,
    ...EMPTY_VALUES,
    ...overrides,
  };
}

function boundRow({
  version = 1,
  source = 'automated',
  anchor = `orcid:${ORCID_A}`,
  boundAt = T1,
  derivedBindingVersion = source === 'automated' ? version : null,
  values = {
    wmkf_orcid: ORCID_A,
    wmkf_orcidurl: `https://orcid.org/${ORCID_A}`,
    wmkf_hindex: 10,
  },
  lineageSources = {},
  decision,
  etag = `W/"${version}"`,
} = {}) {
  const completeValues = { ...EMPTY_VALUES, ...values };
  const lineage = {};
  for (const field of IDENTITY_LINEAGE_FIELDS) {
    if (completeValues[field] !== null) {
      lineage[field] = {
        source: lineageSources[field] || source,
        bindingVersion: version,
      };
    }
  }
  return {
    _etag: etag,
    wmkf_identitybindingversion: version,
    wmkf_identitybindingsource: source,
    wmkf_identitybindinganchor: anchor,
    wmkf_identityboundat: boundAt,
    wmkf_identityderivedbindingversion: derivedBindingVersion,
    wmkf_identityfieldlineagejson: serializeIdentityFieldLineage(lineage, {
      values: completeValues,
      currentBindingVersion: version,
    }),
    ...completeValues,
    ...(decision || (source === 'automated' ? persistedAutomatedDecision() : persistedHumanDecision())),
  };
}

function depsForRows(rows, patchImpl = async () => {}) {
  let index = 0;
  return {
    getIdentityBindingForUpdate: jest.fn(async () => rows[Math.min(index++, rows.length - 1)]),
    patchIdentityBinding: jest.fn(patchImpl),
  };
}

describe('planIdentityBindingTransition', () => {
  test('initial automated resolution creates v1 as a complete atomic patch', () => {
    const plan = planIdentityBindingTransition(unboundRow(), automatedEvent());

    expect(plan).toMatchObject({
      outcome: 'init',
      expectedEtag: 'W/"0"',
      committedBinding: {
        bindingVersion: 1,
        bindingSource: 'automated',
        bindingAnchor: `orcid:${ORCID_A}`,
        derivedBindingVersion: 1,
      },
      invalidateSuggestionCoi: true,
      downstreamEligible: false,
    });
    expect(plan.personPatch).toMatchObject({
      wmkf_identitybindingversion: 1,
      wmkf_identitybindingsource: 'automated',
      wmkf_identitystatus: 'probable',
      wmkf_identityconfidenceband: 'medium',
      wmkf_orcid: ORCID_A,
      wmkf_orcidurl: `https://orcid.org/${ORCID_A}`,
      wmkf_hindex: 10,
      wmkf_googlescholarid: null,
      wmkf_totalcitations: null,
    });
    expect(Object.keys(plan.personPatch).sort()).toEqual([
      'wmkf_googlescholarid',
      'wmkf_googlescholarurl',
      'wmkf_hindex',
      'wmkf_i10index',
      'wmkf_identitybindinganchor',
      'wmkf_identitybindingsource',
      'wmkf_identitybindingversion',
      'wmkf_identityboundat',
      'wmkf_identityconfidenceband',
      'wmkf_identityderivedbindingversion',
      'wmkf_identityevidencesummary',
      'wmkf_identityfieldlineagejson',
      'wmkf_identityresolvedat',
      'wmkf_identityresolverversion',
      'wmkf_identitystatus',
      'wmkf_identityverifiedanchorsjson',
      'wmkf_orcid',
      'wmkf_orcidurl',
      'wmkf_totalcitations',
    ].sort());
  });

  test('blocks dirty legacy rows instead of inferring or erasing provenance', () => {
    expect(() => planIdentityBindingTransition(unboundRow({ wmkf_hindex: 22 }), automatedEvent()))
      .toThrow(expect.objectContaining({ code: 'legacy_classification_required' }));
  });

  test('rejects missing ETags and malformed stored lineage before planning a patch', () => {
    expect(() => planIdentityBindingTransition(unboundRow({ _etag: null }), automatedEvent()))
      .toThrow(expect.objectContaining({ code: 'missing_etag' }));
    expect(() => planIdentityBindingTransition({
      ...boundRow(),
      wmkf_identityfieldlineagejson: '{',
    }, automatedEvent())).toThrow(expect.objectContaining({ code: 'invalid_current_state' }));
  });

  test('self-report rebind bumps once, replaces ORCID, and clears the automated bundle', () => {
    const current = boundRow({
      values: {
        wmkf_orcid: ORCID_A,
        wmkf_orcidurl: `https://orcid.org/${ORCID_A}`,
        wmkf_googlescholarid: 'scholarA',
        wmkf_googlescholarurl: 'https://scholar.google.com/citations?user=scholarA',
        wmkf_hindex: 30,
        wmkf_totalcitations: 1000,
      },
    });
    const plan = planIdentityBindingTransition(current, selfEvent());

    expect(plan.outcome).toBe('rebind');
    expect(plan.committedBinding).toMatchObject({ bindingVersion: 2, bindingSource: 'self_reported' });
    expect(plan.personPatch).toMatchObject({
      wmkf_orcid: ORCID_B,
      wmkf_orcidurl: `https://orcid.org/${ORCID_B}`,
      wmkf_googlescholarid: null,
      wmkf_googlescholarurl: null,
      wmkf_hindex: null,
      wmkf_totalcitations: null,
      wmkf_identityderivedbindingversion: null,
      wmkf_identitystatus: 'confirmed',
    });
    expect(plan.clearedFields).toEqual(expect.arrayContaining([
      'wmkf_googlescholarid',
      'wmkf_googlescholarurl',
      'wmkf_hindex',
      'wmkf_totalcitations',
    ]));
  });

  test('automated same-person refresh changes derived fields without bumping', () => {
    const plan = planIdentityBindingTransition(boundRow(), automatedEvent({
      fields: {
        wmkf_orcid: ORCID_A,
        wmkf_orcidurl: `https://orcid.org/${ORCID_A}`,
        wmkf_hindex: 11,
      },
      decision: automatedDecision({ resolvedAt: T2 }),
    }));
    expect(plan).toMatchObject({
      outcome: 'refresh',
      committedBinding: { bindingVersion: 1, bindingSource: 'automated', boundAt: T1 },
      invalidateSuggestionCoi: false,
    });
    expect(plan.personPatch.wmkf_hindex).toBe(11);
  });

  test('materially identical automated replay is a no-op', () => {
    const plan = planIdentityBindingTransition(boundRow(), automatedEvent());
    expect(plan).toMatchObject({ outcome: 'noop', reason: 'materially_identical', personPatch: null });
  });

  test('different automated person requires replacement, bumps, and clears absent fields', () => {
    const current = boundRow({
      values: {
        wmkf_orcid: ORCID_A,
        wmkf_orcidurl: `https://orcid.org/${ORCID_A}`,
        wmkf_hindex: 20,
      },
    });
    const plan = planIdentityBindingTransition(current, automatedEvent({
      anchor: 'openalex:A123',
      fields: { wmkf_hindex: 5 },
      decision: automatedDecision({ resolvedAt: T2 }),
    }));
    expect(plan.outcome).toBe('rebind');
    expect(plan.committedBinding).toMatchObject({ bindingVersion: 2, bindingAnchor: 'openalex:A123' });
    expect(plan.personPatch).toMatchObject({ wmkf_orcid: null, wmkf_orcidurl: null, wmkf_hindex: 5 });
  });

  test('automated different-person rebind blocks rather than erasing manual lineage', () => {
    const current = boundRow({
      values: {
        wmkf_orcid: ORCID_A,
        wmkf_orcidurl: `https://orcid.org/${ORCID_A}`,
        wmkf_hindex: 20,
      },
      lineageSources: { wmkf_hindex: 'staff_manual' },
    });
    expect(planIdentityBindingTransition(current, automatedEvent({
      anchor: 'openalex:A123',
      fields: { wmkf_hindex: 5 },
      decision: automatedDecision({ resolvedAt: T2 }),
    }))).toMatchObject({
      outcome: 'blocked',
      reason: expect.stringContaining('automated_rebind_has_nonautomated_lineage'),
      personPatch: null,
    });
  });

  test('automation cannot replace a human binding without exact anchor equivalence', () => {
    const current = boundRow({
      source: 'self_reported',
      anchor: `orcid:${ORCID_B}`,
      values: {
        wmkf_orcid: ORCID_B,
        wmkf_orcidurl: `https://orcid.org/${ORCID_B}`,
      },
    });
    expect(planIdentityBindingTransition(current, automatedEvent())).toMatchObject({
      outcome: 'blocked',
      reason: 'automated_cannot_prove_equivalence_to_human_binding',
      personPatch: null,
    });
  });

  test('exact-anchor automation cannot refresh a human binding without durable refresh ordering', () => {
    const current = boundRow({
      source: 'self_reported',
      anchor: `orcid:${ORCID_A}`,
      values: {
        wmkf_orcid: ORCID_A,
        wmkf_orcidurl: `https://orcid.org/${ORCID_A}`,
      },
    });
    const plan = planIdentityBindingTransition(current, automatedEvent({
      fields: {
        wmkf_orcid: ORCID_A,
        wmkf_orcidurl: `https://orcid.org/${ORCID_A}`,
        wmkf_hindex: 12,
      },
    }));
    expect(plan).toMatchObject({
      outcome: 'blocked',
      reason: 'automated_refresh_of_human_binding_requires_durable_refresh_ordering',
      personPatch: null,
    });
  });

  test('partial automated refresh cannot mark previously stale derived state current', () => {
    const current = boundRow({
      source: 'self_reported',
      anchor: `orcid:${ORCID_A}`,
      derivedBindingVersion: null,
      values: {
        wmkf_orcid: ORCID_A,
        wmkf_orcidurl: `https://orcid.org/${ORCID_A}`,
      },
    });
    const plan = planIdentityBindingTransition(current, automatedEvent({
      fieldMode: 'partial',
      fields: { wmkf_hindex: 12 },
    }));
    expect(plan).toMatchObject({
      outcome: 'blocked',
      reason: 'automated_refresh_of_human_binding_requires_durable_refresh_ordering',
      personPatch: null,
    });
  });

  test('self-report outranks staff confirmation while retaining independently attested fields', () => {
    const current = boundRow({
      source: 'staff_confirmed',
      anchor: STAFF_A,
      values: { wmkf_hindex: 7 },
      decision: persistedHumanDecision({ wmkf_identityresolverversion: 'staff@1' }),
    });
    expect(planIdentityBindingTransition(current, selfEvent())).toMatchObject({
      outcome: 'rebind',
      committedBinding: { bindingVersion: 2, bindingSource: 'self_reported' },
      personPatch: { wmkf_hindex: 7, wmkf_orcid: ORCID_B },
    });
  });

  test.each([
    ['older staff binding', boundRow({
      source: 'staff_confirmed',
      anchor: STAFF_A,
      boundAt: T2,
      values: {},
      decision: persistedHumanDecision({ wmkf_identityresolvedat: T2, wmkf_identityresolverversion: 'staff@1' }),
    })],
    ['older automated binding', boundRow({ boundAt: T2 })],
  ])('self-report precedence survives an %s timestamp', (_label, current) => {
    expect(planIdentityBindingTransition(current, selfEvent({
      boundAt: T1,
      decision: humanDecision({ resolvedAt: T1 }),
    }))).toMatchObject({
      outcome: 'rebind',
      committedBinding: { bindingSource: 'self_reported' },
    });
  });

  test('staff cannot replace self-report without a separately authorized correction event', () => {
    const current = boundRow({
      source: 'self_reported',
      anchor: `orcid:${ORCID_B}`,
      values: {
        wmkf_orcid: ORCID_B,
        wmkf_orcidurl: `https://orcid.org/${ORCID_B}`,
      },
    });
    expect(planIdentityBindingTransition(current, staffEvent())).toMatchObject({
      outcome: 'blocked',
      reason: 'staff_correction_requires_authorized_self_report_override',
      personPatch: null,
    });
  });

  test('same human event with changed payload is blocked as replay corruption', () => {
    const current = boundRow({
      source: 'self_reported',
      anchor: `orcid:${ORCID_B}`,
      boundAt: T2,
      values: {
        wmkf_orcid: ORCID_B,
        wmkf_orcidurl: `https://orcid.org/${ORCID_B}`,
      },
      decision: persistedHumanDecision({
        wmkf_identityresolvedat: T2,
      }),
    });
    expect(planIdentityBindingTransition(current, selfEvent({
      decision: humanDecision({ resolvedAt: T2, evidenceSummary: 'Changed replay payload' }),
    }))).toMatchObject({
      outcome: 'blocked',
      reason: 'event_replay_payload_mismatch',
      personPatch: null,
    });
  });

  test.each([
    ['same anchor', selfEvent({ boundAt: T1 })],
    ['different anchor', selfEvent({
      anchor: `orcid:${ORCID_A}`,
      boundAt: T1,
      fields: {
        wmkf_orcid: ORCID_A,
        wmkf_orcidurl: `https://orcid.org/${ORCID_A}`,
      },
    })],
  ])('blocks an older human event with %s', (_label, event) => {
    const current = boundRow({
      source: 'self_reported',
      anchor: `orcid:${ORCID_B}`,
      boundAt: T2,
      values: {
        wmkf_orcid: ORCID_B,
        wmkf_orcidurl: `https://orcid.org/${ORCID_B}`,
      },
      decision: persistedHumanDecision({ wmkf_identityresolvedat: T2 }),
    });
    expect(planIdentityBindingTransition(current, event)).toMatchObject({
      outcome: 'blocked',
      reason: 'out_of_order_human_event',
      personPatch: null,
    });
  });

  test.each([
    [automatedEvent({ anchor: 'openalex:a123' }), /canonical/],
    [automatedEvent({ fields: { wmkf_orcid: ORCID_A } }), /ORCID pair/],
    [automatedEvent({
      fields: {
        wmkf_orcid: ORCID_B,
        wmkf_orcidurl: `https://orcid.org/${ORCID_B}`,
      },
    }), /match the binding anchor/],
    [automatedEvent({ fields: { wmkf_hindex: null } }), /explicit null/],
    [automatedEvent({ fields: { wmkf_hindex: 3 } }), /replacement requires the canonical ORCID pair/],
    [automatedEvent({ decision: automatedDecision({ status: 'probable', confidenceBand: 'high' }) }), /requires confidenceBand 'medium'/],
    [automatedEvent({ decision: automatedDecision({ anchors: {} }) }), /anchors must be an array/],
    [automatedEvent({ decision: automatedDecision({ anchors: [{ type: 'orcid' }] }) }), /canonicalKey is required/],
    [selfEvent({ decision: humanDecision({ resolvedAt: T2, confidenceBand: 'medium' }) }), /requires confidenceBand 'high'/],
    [staffEvent({ anchor: `orcid:${ORCID_A}` }), /staff-attestation/],
  ])('rejects an invalid server event before current-state use', (event, expected) => {
    expect(() => planIdentityBindingTransition(unboundRow(), event)).toThrow(expected);
  });

  test('older or same-timestamp changed automated events cannot overwrite current derived state', () => {
    const current = boundRow({
      values: {
        wmkf_orcid: ORCID_A,
        wmkf_orcidurl: `https://orcid.org/${ORCID_A}`,
        wmkf_hindex: 22,
      },
      decision: persistedAutomatedDecision({ wmkf_identityresolvedat: T2 }),
    });
    expect(planIdentityBindingTransition(current, automatedEvent({
      fields: {
        wmkf_orcid: ORCID_A,
        wmkf_orcidurl: `https://orcid.org/${ORCID_A}`,
        wmkf_hindex: 5,
      },
    }))).toMatchObject({ outcome: 'blocked', reason: 'out_of_order_automated_event', personPatch: null });
    expect(planIdentityBindingTransition(current, automatedEvent({
      fields: {
        wmkf_orcid: ORCID_A,
        wmkf_orcidurl: `https://orcid.org/${ORCID_A}`,
        wmkf_hindex: 5,
      },
      decision: automatedDecision({ resolvedAt: T2 }),
    }))).toMatchObject({ outcome: 'blocked', reason: 'automated_replay_payload_mismatch', personPatch: null });
  });
});

describe('writeReviewerIdentityBinding concurrency', () => {
  test('uses one complete PATCH with the read ETag', async () => {
    const researcher = depsForRows([unboundRow()]);
    const result = await writeReviewerIdentityBinding({
      potentialReviewerId: 'pr-1',
      event: automatedEvent(),
      actingUserSystemId: 'user-1',
    }, { researcher });

    expect(result.outcome).toBe('init');
    expect(researcher.patchIdentityBinding).toHaveBeenCalledTimes(1);
    expect(researcher.patchIdentityBinding).toHaveBeenCalledWith(
      'pr-1',
      result.personPatch,
      { ifMatch: 'W/"0"', actingUserSystemId: 'user-1' },
    );
  });

  test('a 412 rereads and recomputes the version and patch from the fresh row', async () => {
    const first = boundRow({ version: 1, etag: 'W/"1"' });
    const second = boundRow({ version: 2, etag: 'W/"2"' });
    let writes = 0;
    const researcher = depsForRows([first, second], async () => {
      writes += 1;
      if (writes === 1) throw Object.assign(new Error('race'), { status: 412 });
    });

    const result = await writeReviewerIdentityBinding({ potentialReviewerId: 'pr-1', event: selfEvent() }, { researcher });
    expect(result.committedBinding.bindingVersion).toBe(3);
    expect(researcher.patchIdentityBinding).toHaveBeenCalledTimes(2);
    expect(researcher.patchIdentityBinding.mock.calls[0][1].wmkf_identitybindingversion).toBe(2);
    expect(researcher.patchIdentityBinding.mock.calls[0][2].ifMatch).toBe('W/"1"');
    expect(researcher.patchIdentityBinding.mock.calls[1][1].wmkf_identitybindingversion).toBe(3);
    expect(researcher.patchIdentityBinding.mock.calls[1][2].ifMatch).toBe('W/"2"');
  });

  test('a concurrent higher-trust row is re-evaluated and not clobbered', async () => {
    const first = boundRow({ version: 1, etag: 'W/"1"' });
    const second = boundRow({
      version: 2,
      source: 'staff_confirmed',
      anchor: STAFF_A,
      values: {},
      etag: 'W/"2"',
      decision: persistedHumanDecision({ wmkf_identityresolverversion: 'staff@1' }),
    });
    const researcher = depsForRows([first, second], async () => {
      throw Object.assign(new Error('race'), { status: 412 });
    });
    const result = await writeReviewerIdentityBinding({
      potentialReviewerId: 'pr-1',
      event: automatedEvent({
        anchor: 'openalex:A123',
        fields: { wmkf_hindex: 4 },
        decision: automatedDecision({ resolvedAt: T2 }),
      }),
    }, { researcher });

    expect(result).toMatchObject({ outcome: 'blocked', personPatch: null });
    expect(researcher.patchIdentityBinding).toHaveBeenCalledTimes(1);
  });

  test('three 412s exhaust the bounded retry and surface a 409 conflict', async () => {
    const researcher = depsForRows([unboundRow()], async () => {
      throw Object.assign(new Error('race'), { status: 412 });
    });
    await expect(writeReviewerIdentityBinding({ potentialReviewerId: 'pr-1', event: automatedEvent() }, { researcher }))
      .rejects.toMatchObject({ code: 'concurrent_update_exhausted', status: 409 });
    expect(researcher.getIdentityBindingForUpdate).toHaveBeenCalledTimes(3);
    expect(researcher.patchIdentityBinding).toHaveBeenCalledTimes(3);
  });

  test('non-412 errors, including messages mentioning 412, do not retry', async () => {
    const error = Object.assign(new Error('upstream mentioned 412'), { status: 500 });
    const researcher = depsForRows([unboundRow()], async () => { throw error; });
    await expect(writeReviewerIdentityBinding({ potentialReviewerId: 'pr-1', event: automatedEvent() }, { researcher }))
      .rejects.toBe(error);
    expect(researcher.getIdentityBindingForUpdate).toHaveBeenCalledTimes(1);
    expect(researcher.patchIdentityBinding).toHaveBeenCalledTimes(1);
  });

  test('a no-op plan never calls the PATCH adapter', async () => {
    const current = boundRow();
    const researcher = depsForRows([current]);
    await expect(writeReviewerIdentityBinding({ potentialReviewerId: 'pr-1', event: automatedEvent() }, { researcher }))
      .resolves.toMatchObject({ outcome: 'noop' });
    expect(researcher.patchIdentityBinding).not.toHaveBeenCalled();
  });

  test('typed validation errors remain distinguishable from transport failures', () => {
    expect(() => planIdentityBindingTransition(unboundRow(), { source: 'revoked' }))
      .toThrow(IdentityBindingWriteError);
  });
});
