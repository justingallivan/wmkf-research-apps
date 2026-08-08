/**
 * @jest-environment node
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  validateCase,
  validateCassette,
  validateManifest,
  validateResult,
} = require('../../../benchmarks/institution-resolution-readiness/schema');
const {
  isForbiddenTrackedPath,
  validatePublicationBoundary,
} = require('../../../benchmarks/institution-resolution-readiness/validate-publication-boundary');
const {
  validatePublicAssets,
} = require('../../../benchmarks/institution-resolution-readiness/validate-public-assets');

const ROOT = path.resolve(__dirname, '../../../benchmarks/institution-resolution-readiness');
const CASE_FILE = path.join(ROOT, 'public-cases/v1/cases.json');
const MANIFEST_FILE = path.join(ROOT, 'manifests/public-cases-v1.json');
const cases = JSON.parse(fs.readFileSync(CASE_FILE, 'utf8'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validCassette() {
  return {
    schema_version: 1,
    id: 'openalex-example-university',
    provider: 'openalex',
    request_hash: 'a'.repeat(64),
    request: {
      method: 'GET',
      endpoint: 'https://api.openalex.org/institutions',
      strategy: 'institution-single-search',
    },
    response: {
      status: 200,
      body: { results: [{ id: 'https://openalex.org/I1', display_name: 'Example University' }] },
    },
    observed_on: '2026-08-07',
  };
}

function validSummary() {
  return {
    total: 1,
    resolved: 1,
    review: 0,
    unresolved: 0,
    wrong_automatic: 0,
    provider_failures: 0,
    deadline_abstentions: 0,
    latency_ms: { p50: 1, p95: 2, max: 3 },
    provider_requests: { ror: 1, openalex: 1 },
  };
}

function validResult(scope = 'public_fixture') {
  const value = {
    schema_version: 1,
    result_id: 'public-fixture-result-v1',
    scope,
    source_commit: 'de5fcee',
    created_at: '2026-08-07T12:00:00.000Z',
    case_manifest_sha256: 'b'.repeat(64),
    cassette_manifest_sha256: 'c'.repeat(64),
    summary: validSummary(),
  };
  if (scope === 'public_fixture') {
    value.cases = [{
      case_id: 'public-umn-canonical',
      expected_outcome: 'resolved',
      actual_outcome: 'resolved',
      selected_ror_ids: ['https://ror.org/017zqws13'],
      failure_reasons: [],
    }];
  }
  return value;
}

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

describe('institution-resolution readiness public contracts', () => {
  test('validates all tracked public assets without network or credentials', () => {
    const credentialNames = [
      'OPENALEX_API_KEY',
      'ROR_CLIENT_ID',
      'POSTGRES_URL',
      'DATABASE_URL',
    ];
    const previous = Object.fromEntries(credentialNames.map((name) => [name, process.env[name]]));
    credentialNames.forEach((name) => delete process.env[name]);
    const previousFetch = global.fetch;
    global.fetch = jest.fn(() => {
      throw new Error('network access is forbidden in deterministic validation');
    });
    try {
      expect(validatePublicAssets({ root: ROOT })).toEqual({
        cases: 5,
        cassettes: 0,
        manifests: 1,
        results: 0,
      });
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = previousFetch;
      for (const name of credentialNames) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
    }
  });

  test('keeps every public case schema-valid and publication-safe', () => {
    expect(cases).toHaveLength(5);
    for (const value of cases) {
      expect(validateCase(value)).toEqual([]);
      expect(validatePublicationBoundary(value, { artifactType: 'case' })).toEqual([]);
    }
  });

  test('pins the public case bytes and record count in a valid manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    const digest = crypto.createHash('sha256').update(fs.readFileSync(CASE_FILE)).digest('hex');
    expect(validateManifest(manifest)).toEqual([]);
    expect(validatePublicationBoundary(manifest, { artifactType: 'manifest' })).toEqual([]);
    expect(manifest.artifacts).toEqual([expect.objectContaining({
      path: 'public-cases/v1/cases.json',
      sha256: digest,
      records: cases.length,
    })]);
  });

  test('rejects invalid decision labels and unknown fields', () => {
    const zeroRor = clone(cases[0]);
    zeroRor.expected.ror_ids = [];
    expect(validateCase(zeroRor).join('\n')).toMatch(/exactly one canonical ROR/);

    const ambiguousSelection = clone(cases[1]);
    ambiguousSelection.expected.ror_ids = ['https://ror.org/03vek6s52'];
    expect(validateCase(ambiguousSelection).join('\n')).toMatch(/cannot select a ROR/);

    const capabilityLeak = clone(cases[0]);
    capabilityLeak.input.country_code = 'US';
    expect(validateCase(capabilityLeak).join('\n')).toMatch(/field is not allowed/);

    const unknown = clone(cases[0]);
    unknown.reviewer_name = 'Synthetic Person';
    expect(validateCase(unknown).join('\n')).toMatch(/field is not allowed/);

    const cycleOrigin = clone(cases[0]);
    cycleOrigin.origin = 'completed_cycle';
    expect(validateCase(cycleOrigin).join('\n')).toMatch(/synthetic or public_registry/);
  });

  test.each([
    ['reviewer email', { reviewer_email: 'person@example.edu' }, /field is forbidden|email-like/],
    ['ORCID', { researcher: 'https://orcid.org/0000-0002-1825-0097' }, /ORCID/],
    ['production GUID', { identifier: '550e8400-e29b-41d4-a716-446655440000' }, /GUID/],
    ['candidate key', { candidate_key: 'candidate-123' }, /field is forbidden/],
    ['frequency weight', { frequency_weight: 7 }, /field is forbidden/],
    ['completed-cycle marker', { note: 'completed-cycle source' }, /completed-cycle linkage/],
  ])('rejects seeded public-boundary PII: %s', (_label, payload, expected) => {
    const problems = validatePublicationBoundary(payload, { artifactType: 'case' });
    expect(problems.join('\n')).toMatch(expected);
  });

  test('allows only organization-level evidence URLs', () => {
    const institutional = clone(cases[0]);
    institutional.label.allowed_evidence_hosts = ['www.example.edu'];
    institutional.label.evidence.push('https://www.example.edu/about');
    expect(validatePublicationBoundary(institutional, { artifactType: 'case' })).toEqual([]);

    const personPage = clone(institutional);
    personPage.label.evidence[1] = 'https://www.example.edu/faculty/example';
    expect(validatePublicationBoundary(personPage, { artifactType: 'case' }).join('\n'))
      .toMatch(/person-level|institutional root\/about/);

    const foreignHost = clone(institutional);
    foreignHost.label.evidence[1] = 'https://other.example.edu/about';
    expect(validatePublicationBoundary(foreignHost, { artifactType: 'case' }).join('\n'))
      .toMatch(/institutional root\/about/);
  });

  test('validates cassette shape while rejecting credentials and PII', () => {
    const cassette = validCassette();
    expect(validateCassette(cassette)).toEqual([]);
    expect(validatePublicationBoundary(cassette, { artifactType: 'cassette' })).toEqual([]);

    const secretEndpoint = clone(cassette);
    secretEndpoint.request.endpoint = 'https://api.openalex.org/institutions?api_key=secret-value';
    expect(validatePublicationBoundary(secretEndpoint, { artifactType: 'cassette' }).join('\n'))
      .toMatch(/secret-bearing|credential-free/);

    const contactLeak = clone(cassette);
    contactLeak.response.body.contact_email = 'person@example.edu';
    expect(validatePublicationBoundary(contactLeak, { artifactType: 'cassette' }).join('\n'))
      .toMatch(/field is forbidden|email-like/);

    const authorSurface = clone(cassette);
    authorSurface.request.endpoint = 'https://api.openalex.org/authors';
    expect(validatePublicationBoundary(authorSurface, { artifactType: 'cassette' }).join('\n'))
      .toMatch(/credential-free endpoint/);

    const authorPayload = clone(cassette);
    authorPayload.response.body.authors = [{ author_name: 'Synthetic Person' }];
    expect(validatePublicationBoundary(authorPayload, { artifactType: 'cassette' }).join('\n'))
      .toMatch(/field is forbidden/);

    const impossibleDate = clone(cassette);
    impossibleDate.observed_on = '2026-99-99';
    expect(validateCassette(impossibleDate).join('\n')).toMatch(/real YYYY-MM-DD date/);
  });

  test('enforces aggregate-only private result publication', () => {
    expect(validateResult(validResult())).toEqual([]);
    expect(validatePublicationBoundary(validResult(), { artifactType: 'result' })).toEqual([]);

    const privateAggregate = validResult('aggregate_private');
    expect(validateResult(privateAggregate)).toEqual([]);
    privateAggregate.cases = [];
    expect(validateResult(privateAggregate).join('\n')).toMatch(/cannot include a cases field/);

    const publicLeak = validResult();
    publicLeak.cases[0].organization_name = 'University of Minnesota';
    expect(validateResult(publicLeak).join('\n')).toMatch(/field is not allowed/);

    const inconsistentDecision = validResult();
    inconsistentDecision.cases[0].actual_outcome = 'review';
    expect(validateResult(inconsistentDecision).join('\n')).toMatch(/cannot select a ROR/);

    const duplicate = validResult();
    duplicate.summary.total = 2;
    duplicate.summary.resolved = 2;
    duplicate.cases.push(clone(duplicate.cases[0]));
    expect(validateResult(duplicate).join('\n')).toMatch(/case ids must be unique/);

    const looseTimestamp = validResult();
    looseTimestamp.created_at = 'August 7, 2026';
    expect(validateResult(looseTimestamp).join('\n')).toMatch(/UTC ISO timestamp/);
  });

  test('rejects tracked private-artifact path patterns without choosing a private root', () => {
    expect(isForbiddenTrackedPath('public-cases/v1/cases.json')).toBe(false);
    expect(isForbiddenTrackedPath('private/cycle-cases.json')).toBe(true);
    expect(isForbiddenTrackedPath('results/completed-cycle.json')).toBe(true);
    expect(isForbiddenTrackedPath(
      'owner-approved/cases.json',
      'owner-approved',
    )).toBe(true);

    const privateManifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    privateManifest.artifacts[0].path = 'private/cases.json';
    expect(validatePublicationBoundary(privateManifest, { artifactType: 'manifest' }).join('\n'))
      .toMatch(/private artifact paths/);
  });

  test('keeps benchmark artifacts invisible to Jest discovery', () => {
    const benchmarkTests = filesBelow(ROOT).filter((file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));
    expect(benchmarkTests).toEqual([]);
  });
});
