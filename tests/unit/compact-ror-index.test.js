'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildCompactIndex,
  normalizeDomain,
  normalizeLookupKey,
  shortRorId,
  trigramsForKey,
  verifyPinnedFile,
} = require('../../benchmarks/compact-ror-index/lib');

const releaseManifest = {
  release: 'v-test',
  schemaVersion: '2.1',
  publicationDate: '2026-08-07',
  recordCount: 2,
  zenodoRecordId: 'test-record',
  doi: 'test-doi',
  zip: { checksum: 'md5:test' },
};

function sourceRecord(overrides = {}) {
  return {
    id: 'https://ror.org/012345678',
    status: 'active',
    types: ['education'],
    names: [
      { value: 'Université Example', types: ['ror_display', 'label'], lang: 'fr' },
      { value: 'University Example', types: ['alias'], lang: 'en' },
    ],
    domains: ['EXAMPLE.EDU.'],
    locations: [
      {
        geonames_id: 123,
        geonames_details: {
          country_code: 'US',
          country_subdivision_code: 'MN',
          name: 'Example City',
        },
      },
    ],
    relationships: [
      { type: 'parent', label: 'Example Parent', id: 'https://ror.org/087654321' },
    ],
    ...overrides,
  };
}

describe('compact ROR index experiment', () => {
  test('normalizes lookup evidence deterministically', () => {
    expect(normalizeLookupKey('  Université—Example  ')).toBe('universite example');
    expect(normalizeDomain('HTTPS://Example.EDU/')).toBe('example.edu');
    expect(trigramsForKey('AB')).toEqual(['^ab', 'ab$']);
    expect(shortRorId('https://ror.org/012345678')).toBe('012345678');
  });

  test('builds deduplicated retrieval postings without making a resolution', () => {
    const records = [
      sourceRecord(),
      sourceRecord({
        id: 'https://ror.org/087654321',
        status: 'inactive',
        names: [
          { value: 'University Example', types: ['ror_display'], lang: 'en' },
          { value: 'University Example', types: ['alias'], lang: 'en' },
        ],
        domains: ['other.example'],
        relationships: [],
      }),
    ];

    const index = buildCompactIndex(records, releaseManifest);
    const exactNames = new Map(index.lookup.exactName);
    const domains = new Map(index.lookup.domain);

    expect(index.format).toBe('wmkf-ror-candidate-index-v1');
    expect(index.stats).toMatchObject({
      recordCount: 2,
      statusCounts: { active: 1, inactive: 1 },
      nameCount: 4,
      relationshipCount: 1,
    });
    expect(exactNames.get('university example')).toEqual([0, 1]);
    expect(domains.get('example.edu')).toEqual([0]);
    expect(index.records[0][6]).toEqual([
      [index.dictionaries.relationshipTypes.indexOf('parent'), '087654321'],
    ]);
    expect(index).not.toHaveProperty('selected');
    expect(index).not.toHaveProperty('scores');
  });

  test('rejects an unpinned record count or malformed ROR id', () => {
    expect(() => buildCompactIndex([sourceRecord()], releaseManifest)).toThrow(
      'Pinned record count 2 does not match source 1',
    );
    expect(() => shortRorId('not-a-ror-id')).toThrow('Invalid ROR id');
  });

  test('rejects same-length content that does not match the pinned digest', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-ror-index-'));
    const filePath = path.join(directory, 'source.json');
    const expectedContent = Buffer.from('pinned-content');
    const alteredContent = Buffer.from('tamper-content');
    const checksum = crypto.createHash('sha256').update(expectedContent).digest('hex');

    try {
      fs.writeFileSync(filePath, alteredContent);
      expect(alteredContent.length).toBe(expectedContent.length);
      expect(() => verifyPinnedFile(filePath, {
        bytes: expectedContent.length,
        checksum: `sha256:${checksum}`,
      }, 'Supplied ROR JSON')).toThrow('Supplied ROR JSON checksum mismatch');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
