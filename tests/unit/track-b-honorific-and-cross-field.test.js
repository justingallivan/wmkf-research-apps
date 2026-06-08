/**
 * @jest-environment node
 *
 * Covers the two Track-B quality fixes:
 *  A. Honorific-robust dedup — a verified Track-A reviewer ("Prof. Ursula Keller")
 *     and the same person re-surfaced by a Track-B arxiv search ("Ursula Keller")
 *     must dedup to the same identity (previously the bare "prof" token defeated it).
 *  B. Cross-field source guard — a bioRxiv (biology) author is dropped from a clearly
 *     non-biomedical (physics/chem/eng) proposal's discovered set.
 */

const { DeduplicationService } = require('../../lib/services/deduplication-service');
const { DiscoveryService } = require('../../lib/services/discovery-service');

describe('A. areNamesSimilar — honorific-robust', () => {
  test('"Prof. Ursula Keller" matches "Ursula Keller"', () => {
    expect(DeduplicationService.areNamesSimilar('Prof. Ursula Keller', 'Ursula Keller')).toBe(true);
  });

  test('stacked titles ("Prof. Dr. Reinhard Dörner") match the bare name', () => {
    expect(DeduplicationService.areNamesSimilar('Prof. Dr. Reinhard Dörner', 'Reinhard Dörner')).toBe(true);
  });

  test('honorific does not create false positives across different people', () => {
    expect(DeduplicationService.areNamesSimilar('Prof. Ursula Keller', 'Olga Smirnova')).toBe(false);
  });
});

describe('B. isCrossFieldDiscoveredContamination', () => {
  const physics = { primaryResearchArea: 'Attosecond physics / ultrafast strong-field ionization' };
  const biomed = { primaryResearchArea: 'Cancer immunology and genomics' };

  // The filter runs AFTER dedup, where candidates carry `sources: [...]` (mergeGroup
  // drops the singular `source`). Exercise that real merged shape — a pre-dedup-only
  // `{ source }` test would pass while the live filter silently no-ops (Codex S233).
  test('post-dedup bioRxiv author on a physics proposal → contamination (dropped)', () => {
    expect(DiscoveryService.isCrossFieldDiscoveredContamination(physics, { name: 'Nilah Ioannidis', sources: ['biorxiv'] })).toBe(true);
  });

  test('post-dedup arxiv author on a physics proposal → kept', () => {
    expect(DiscoveryService.isCrossFieldDiscoveredContamination(physics, { name: 'Olga Smirnova', sources: ['arxiv'] })).toBe(false);
  });

  test('author found on BOTH bioRxiv and arXiv → kept (has physics grounding)', () => {
    expect(DiscoveryService.isCrossFieldDiscoveredContamination(physics, { name: 'X', sources: ['biorxiv', 'arxiv'] })).toBe(false);
  });

  test('pre-dedup singular source shape still handled', () => {
    expect(DiscoveryService.isCrossFieldDiscoveredContamination(physics, { name: 'Nilah Ioannidis', source: 'biorxiv' })).toBe(true);
  });

  test('bioRxiv author on a biomedical proposal → kept', () => {
    expect(DiscoveryService.isCrossFieldDiscoveredContamination(biomed, { name: 'Nilah Ioannidis', sources: ['biorxiv'] })).toBe(false);
  });

  test('no research area → kept (cannot judge cross-field)', () => {
    expect(DiscoveryService.isCrossFieldDiscoveredContamination({}, { name: 'X', sources: ['biorxiv'] })).toBe(false);
  });
});
