/**
 * Measurement-only compact ROR candidate index builder.
 *
 * This module creates retrieval postings and compact candidate evidence. It
 * does not select, score, veto, or otherwise resolve an institution.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');

const ROR_ID_PATTERN = /^https:\/\/ror\.org\/([0-9a-z]{9})$/;

function fileDigest(filePath, algorithm) {
  const hash = crypto.createHash(algorithm);
  const file = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(file, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(file);
  }
  return hash.digest('hex');
}

function verifyPinnedFile(filePath, expected, label = 'Pinned file') {
  const actualBytes = fs.statSync(filePath).size;
  if (actualBytes !== expected.bytes) {
    throw new Error(`${label} size mismatch: expected ${expected.bytes}, got ${actualBytes}`);
  }

  const separator = expected.checksum.indexOf(':');
  if (separator < 1) throw new Error(`${label} checksum must include its algorithm`);
  const algorithm = expected.checksum.slice(0, separator);
  const expectedDigest = expected.checksum.slice(separator + 1);
  const actualDigest = fileDigest(filePath, algorithm);
  if (actualDigest !== expectedDigest) {
    throw new Error(
      `${label} checksum mismatch: expected ${expectedDigest}, got ${actualDigest}`,
    );
  }
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeLookupKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('und')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .replace(/\.$/, '');
}

function shortRorId(value) {
  const match = ROR_ID_PATTERN.exec(String(value || ''));
  if (!match) {
    throw new Error(`Invalid ROR id: ${value}`);
  }
  return match[1];
}

function trigramsForKey(value) {
  const key = normalizeLookupKey(value).replace(/ /g, '_');
  if (!key) return [];

  const padded = Array.from(`^${key}$`);
  if (padded.length <= 3) return [padded.join('')];

  const trigrams = new Set();
  for (let index = 0; index <= padded.length - 3; index += 1) {
    trigrams.add(padded.slice(index, index + 3).join(''));
  }
  return [...trigrams].sort(compareStrings);
}

function addPosting(postings, key, recordIndex) {
  if (!key) return;
  const existing = postings.get(key);
  if (existing) {
    existing.push(recordIndex);
  } else {
    postings.set(key, [recordIndex]);
  }
}

function sortedPostingEntries(postings) {
  return [...postings.entries()].sort(([left], [right]) => compareStrings(left, right));
}

function countPostings(entries) {
  return entries.reduce((total, [, recordIndexes]) => total + recordIndexes.length, 0);
}

function collectDictionaries(sourceRecords) {
  const statuses = new Set();
  const organizationTypes = new Set();
  const nameTypes = new Set();
  const languages = new Set();
  const relationshipTypes = new Set();
  const domains = new Set();
  const locations = new Map();

  for (const record of sourceRecords) {
    statuses.add(record.status || 'unknown');
    for (const type of record.types || []) organizationTypes.add(type);

    for (const name of record.names || []) {
      for (const type of name.types || []) nameTypes.add(type);
      if (name.lang) languages.add(name.lang);
    }

    for (const relationship of record.relationships || []) {
      relationshipTypes.add(relationship.type || 'unknown');
    }

    for (const domain of record.domains || []) {
      const normalized = normalizeDomain(domain);
      if (normalized) domains.add(normalized);
    }

    for (const location of record.locations || []) {
      const details = location.geonames_details || {};
      const compactLocation = [
        location.geonames_id || null,
        details.country_code || null,
        details.country_subdivision_code || null,
        details.name || null,
      ];
      locations.set(JSON.stringify(compactLocation), compactLocation);
    }
  }

  const sorted = (values) => [...values].sort(compareStrings);
  return {
    statuses: sorted(statuses),
    organizationTypes: sorted(organizationTypes),
    nameTypes: sorted(nameTypes),
    languages: sorted(languages),
    relationshipTypes: sorted(relationshipTypes),
    domains: sorted(domains),
    locations: [...locations.entries()]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([, value]) => value),
  };
}

function indexByValue(values, serializer = (value) => value) {
  return new Map(values.map((value, index) => [serializer(value), index]));
}

function buildCompactIndex(sourceRecords, releaseManifest) {
  if (!Array.isArray(sourceRecords)) {
    throw new TypeError('ROR source JSON must be an array');
  }
  if (!releaseManifest || !releaseManifest.release) {
    throw new TypeError('A pinned release manifest is required');
  }
  if (releaseManifest.recordCount !== sourceRecords.length) {
    throw new Error(
      `Pinned record count ${releaseManifest.recordCount} does not match source ${sourceRecords.length}`,
    );
  }

  const dictionaries = collectDictionaries(sourceRecords);
  if (dictionaries.nameTypes.length > 30) {
    throw new Error('Name type bitmask supports at most 30 distinct values');
  }

  const statusIndex = indexByValue(dictionaries.statuses);
  const organizationTypeIndex = indexByValue(dictionaries.organizationTypes);
  const nameTypeIndex = indexByValue(dictionaries.nameTypes);
  const languageIndex = indexByValue(dictionaries.languages);
  const relationshipTypeIndex = indexByValue(dictionaries.relationshipTypes);
  const domainIndex = indexByValue(dictionaries.domains);
  const locationIndex = indexByValue(dictionaries.locations, JSON.stringify);

  const exactNamePostings = new Map();
  const domainPostings = new Map();
  const tokenPostings = new Map();
  const trigramPostings = new Map();
  const statusCounts = {};
  let nameCount = 0;
  let domainAssignmentCount = 0;
  let locationAssignmentCount = 0;
  let relationshipCount = 0;

  const records = sourceRecords.map((record, recordIndex) => {
    const status = record.status || 'unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    const recordNameKeys = new Set();
    const recordTokens = new Set();
    const recordTrigrams = new Set();
    const compactNames = (record.names || []).map((name) => {
      nameCount += 1;
      const normalized = normalizeLookupKey(name.value);
      if (normalized) {
        recordNameKeys.add(normalized);
        for (const token of normalized.split(' ')) {
          if (token) recordTokens.add(token);
        }
        for (const trigram of trigramsForKey(normalized)) recordTrigrams.add(trigram);
      }

      const typeMask = (name.types || []).reduce(
        (mask, type) => mask | (1 << nameTypeIndex.get(type)),
        0,
      );
      return [name.value, typeMask, name.lang ? languageIndex.get(name.lang) : -1];
    });

    for (const key of recordNameKeys) addPosting(exactNamePostings, key, recordIndex);
    for (const token of recordTokens) addPosting(tokenPostings, token, recordIndex);
    for (const trigram of recordTrigrams) addPosting(trigramPostings, trigram, recordIndex);

    const recordDomains = new Set();
    for (const domain of record.domains || []) {
      const normalized = normalizeDomain(domain);
      if (normalized) recordDomains.add(normalized);
    }
    for (const domain of recordDomains) addPosting(domainPostings, domain, recordIndex);
    domainAssignmentCount += recordDomains.size;

    const compactLocations = (record.locations || []).map((location) => {
      const details = location.geonames_details || {};
      const compactLocation = [
        location.geonames_id || null,
        details.country_code || null,
        details.country_subdivision_code || null,
        details.name || null,
      ];
      return locationIndex.get(JSON.stringify(compactLocation));
    });
    locationAssignmentCount += compactLocations.length;

    const compactRelationships = (record.relationships || []).map((relationship) => [
      relationshipTypeIndex.get(relationship.type || 'unknown'),
      shortRorId(relationship.id),
    ]);
    relationshipCount += compactRelationships.length;

    return [
      shortRorId(record.id),
      statusIndex.get(status),
      (record.types || []).map((type) => organizationTypeIndex.get(type)),
      compactNames,
      [...recordDomains].map((domain) => domainIndex.get(domain)),
      compactLocations,
      compactRelationships,
    ];
  });

  const lookup = {
    exactName: sortedPostingEntries(exactNamePostings),
    domain: sortedPostingEntries(domainPostings),
    token: sortedPostingEntries(tokenPostings),
    trigram: sortedPostingEntries(trigramPostings),
  };

  return {
    format: 'wmkf-ror-candidate-index-v1',
    release: {
      release: releaseManifest.release,
      schemaVersion: releaseManifest.schemaVersion,
      publicationDate: releaseManifest.publicationDate,
      zenodoRecordId: releaseManifest.zenodoRecordId,
      doi: releaseManifest.doi,
      sourceChecksum: releaseManifest.zip.checksum,
    },
    layout: [
      'rorId',
      'status',
      'organizationTypes',
      'names[value,typeMask,language]',
      'domains',
      'locations',
      'relationships[type,rorId]',
    ],
    dictionaries,
    records,
    lookup,
    stats: {
      recordCount: records.length,
      statusCounts,
      nameCount,
      domainAssignmentCount,
      locationAssignmentCount,
      relationshipCount,
      exactNameKeyCount: lookup.exactName.length,
      exactNamePostingCount: countPostings(lookup.exactName),
      domainKeyCount: lookup.domain.length,
      domainPostingCount: countPostings(lookup.domain),
      tokenKeyCount: lookup.token.length,
      tokenPostingCount: countPostings(lookup.token),
      trigramKeyCount: lookup.trigram.length,
      trigramPostingCount: countPostings(lookup.trigram),
    },
  };
}

module.exports = {
  buildCompactIndex,
  fileDigest,
  normalizeDomain,
  normalizeLookupKey,
  shortRorId,
  trigramsForKey,
  verifyPinnedFile,
};
