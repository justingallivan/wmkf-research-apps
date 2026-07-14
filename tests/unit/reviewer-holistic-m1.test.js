const identityDraft = require('../../docs/audits/reviewer-holistic-identity-benchmark-v1.json');
const proposalDraft = require('../../docs/audits/reviewer-holistic-proposal-evaluation-v1.json');
const {
  aggregateChannelBaseline,
  tokenizeSources,
  validateIdentityBenchmark,
  validateProposalEvaluation,
} = require('../../scripts/lib/reviewer-holistic-m1');
const { parseCli: parseAssetCli } = require('../../scripts/validate-reviewer-holistic-m1-assets');
const { parseCli: parseChannelProbeCli } = require('../../scripts/probe-reviewer-channel-baseline');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function identityCase(index, stratum) {
  const abstain = stratum === 'hazard';
  return {
    caseId: `case-${index}`,
    stratum,
    hazardTypes: abstain ? ['namesake'] : [],
    frozenInput: { candidate: { name: `Candidate ${index}` }, upstreamResponses: { orcid: {} } },
    expected: {
      personAnchor: abstain ? null : `orcid:0000-0002-1825-${String(1000 + index).slice(-4)}`,
      abstain,
      actionEligible: !abstain,
      correctionIntegrity: 'not_applicable',
    },
    evidence: [{
      url: `https://example.org/evidence/${index}`,
      claim: 'Authoritative identity evidence reviewed independently.',
      accessedAt: '2026-07-14T00:00:00.000Z',
    }],
    labeler: 'labeler-a',
    adjudication: { status: 'agreed', adjudicator: null },
  };
}

function frozenIdentity() {
  const asset = clone(identityDraft);
  asset.status = 'frozen';
  asset.labelers = ['labeler-a'];
  asset.adjudicator = 'adjudicator-a';
  asset.frozenAt = '2026-07-14T00:00:00.000Z';
  asset.cases = [
    ...Array.from({ length: 20 }, (_, i) => identityCase(i + 1, 'hazard')),
    ...Array.from({ length: 20 }, (_, i) => identityCase(i + 21, 'clean_positive')),
  ];
  return asset;
}

function proposal(index) {
  return {
    proposalId: `request-${index}`,
    blindProposalId: `proposal-${index}`,
    programArea: index % 2 ? 'Area A' : 'Area B',
    signalLevel: index % 2 ? 'thin' : 'full',
    documentHash: String(index % 10).repeat(64),
    usedForTuning: false,
    runs: { baseline: [], redesign: [] },
    candidateArmMembership: [],
    candidateScores: [],
  };
}

function frozenProposals() {
  const asset = clone(proposalDraft);
  asset.status = 'frozen';
  asset.scorer = 'pd-a';
  asset.randomizationSeedHash = 'a'.repeat(64);
  asset.frozenAt = '2026-07-14T00:00:00.000Z';
  asset.proposals = Array.from({ length: 10 }, (_, i) => proposal(i + 1));
  return asset;
}

describe('M1 evaluation assets', () => {
  test('asset validator rejects unknown flags and extra paths', () => {
    expect(() => parseAssetCli(['--unknown'])).toThrow('unknown arguments');
    expect(() => parseAssetCli(['one.json', 'two.json', 'three.json'])).toThrow('unknown positional arguments');
  });

  test('tracked empty drafts are structurally valid but cannot freeze', () => {
    expect(validateIdentityBenchmark(identityDraft)).toEqual({ ok: true, errors: [] });
    expect(validateProposalEvaluation(proposalDraft)).toEqual({ ok: true, errors: [] });
    expect(validateIdentityBenchmark(identityDraft, { requireFrozen: true }).ok).toBe(false);
    expect(validateProposalEvaluation(proposalDraft, { requireFrozen: true }).ok).toBe(false);
  });

  test('complete identity benchmark passes the 20 hazard / 20 clean-positive gate', () => {
    expect(validateIdentityBenchmark(frozenIdentity(), { requireFrozen: true })).toEqual({ ok: true, errors: [] });
  });

  test('identity freeze fails closed on unresolved or unsupported input', () => {
    const asset = frozenIdentity();
    asset.cases[0].adjudication.status = 'pending';
    asset.cases[1].hazardTypes = ['unknown_hazard'];
    asset.cases[2].expected.actionEligible = true;
    asset.cases[2].expected.abstain = true;
    const result = validateIdentityBenchmark(asset, { requireFrozen: true });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'cases[0].adjudication.status' }),
      expect.objectContaining({ path: 'cases[1].hazardTypes' }),
      expect.objectContaining({ path: 'cases[2].expected.actionEligible' }),
    ]));
  });

  test('complete held-out proposal cohort freezes before execution', () => {
    expect(validateProposalEvaluation(frozenProposals(), { requireFrozen: true })).toEqual({ ok: true, errors: [] });
  });

  test('proposal freeze rejects tuning leakage, duplicate IDs, and missing signal strata', () => {
    const asset = frozenProposals();
    asset.proposals[0].usedForTuning = true;
    asset.proposals[1].proposalId = asset.proposals[0].proposalId;
    asset.proposals.forEach((item) => { item.signalLevel = 'thin'; });
    const result = validateProposalEvaluation(asset, { requireFrozen: true });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'proposals[0].usedForTuning' }),
      expect.objectContaining({ path: 'proposals[1].proposalId' }),
      expect.objectContaining({ path: 'proposals' }),
    ]));
  });

  test('scored state requires three unique runs per arm and blinded PD scores', () => {
    const asset = frozenProposals();
    asset.status = 'scored';
    const result = validateProposalEvaluation(asset, { requireScored: true });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'proposals[0].runs.baseline' }),
      expect.objectContaining({ path: 'proposals[0].runs.redesign' }),
      expect.objectContaining({ path: 'proposals[0].candidateArmMembership' }),
      expect.objectContaining({ path: 'proposals[0].candidateScores' }),
    ]));
  });

  test('scored state maps every blinded score to its baseline/redesign membership', () => {
    const asset = frozenProposals();
    asset.status = 'scored';
    asset.proposals.forEach((item, index) => {
      item.runs = {
        baseline: [`b-${index}-1`, `b-${index}-2`, `b-${index}-3`],
        redesign: [`r-${index}-1`, `r-${index}-2`, `r-${index}-3`],
      };
      item.candidateArmMembership = [{
        blindCandidateId: `candidate-${index}`,
        arms: ['baseline', 'redesign'],
      }];
      item.candidateScores = [{
        blindCandidateId: `candidate-${index}`,
        correctPerson: true,
        onTopic: true,
        independentEligible: true,
        shortlist: true,
        disqualifierReason: null,
        coverageContribution: 'Primary expertise coverage',
        panelReadyWithoutAnotherSearch: true,
      }];
    });
    expect(validateProposalEvaluation(asset, { requireScored: true })).toEqual({ ok: true, errors: [] });
  });
});

describe('M1.3 observational channel aggregation', () => {
  const rows = [
    {
      wmkf_sources: 'claude, pubmed,claude',
      wmkf_selected: true,
      wmkf_invited: true,
      wmkf_accepted: true,
      wmkf_materialssentat: '2026-01-01',
      wmkf_reviewreceivedat: '2026-01-10',
    },
    {
      wmkf_sources: 'claude',
      wmkf_declined: true,
      wmkf_declinereferral: 'Another expert',
    },
    { wmkf_sources: 'applicant,claude', wmkf_selected: true },
    { wmkf_sources: null, wmkf_invited: true },
  ];

  test('source tokenization trims and deduplicates without inventing a missing token', () => {
    expect(tokenizeSources('claude, pubmed,claude')).toEqual(['claude', 'pubmed']);
    expect(tokenizeSources(null)).toEqual([]);
  });

  test('probe requires an explicit valid target and rejects unknown arguments', () => {
    expect(() => parseChannelProbeCli([])).toThrow('--target=prod or --target=sandbox is required');
    expect(() => parseChannelProbeCli(['--target=unknown'])).toThrow("--target must be 'prod' or 'sandbox'");
    expect(() => parseChannelProbeCli(['--target=prod', '--extra'])).toThrow('unknown arguments');
    expect(parseChannelProbeCli(['--target=sandbox', '--output', 'report.json'])).toEqual({
      outputPath: 'report.json',
      target: 'sandbox',
    });
  });

  test('reports overlapping attribution and exclusive cohorts separately', () => {
    const result = aggregateChannelBaseline(rows);
    expect(result.population).toEqual({
      totalRows: 4,
      rowsWithSources: 3,
      rowsWithoutSources: 1,
      exclusiveTokenRows: 1,
      multiTouchRows: 2,
    });
    expect(result.probeVersion).toBe('reviewer-channel-baseline-v1');
    expect(result.attributedByToken.claude.sourcedRows).toEqual({ count: 3, denominator: 4, rate: 0.75 });
    expect(result.attributedByToken.claude.declineWithReferral).toEqual({ count: 1, denominator: 3, rate: 1 / 3 });
    expect(result.exclusiveByToken.claude.sourcedRows.count).toBe(1);
    expect(result.multiTouchByToken.claude.sourcedRows.count).toBe(2);
    expect(result.cohortMetrics.missingSource.invited.count).toBe(1);
  });

  test('uses reviewreceivedat and labels mutable/proxy semantics in the artifact', () => {
    const result = aggregateChannelBaseline(rows);
    expect(result.attributedByToken.claude.reviewReceived.count).toBe(1);
    expect(result.interpretation.selected).toContain('mutable snapshot');
    expect(result.interpretation.materialsSent).toContain('proxy');
    expect(result.interpretation.attribution).toContain('never sum');
  });
});
