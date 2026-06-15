/**
 * Unit tests for the field-primer expert display helpers (profile links +
 * bibliometrics). Pure — exercises the real ORCID checksum normalizer.
 */
import { expertProfileLinks, expertMetrics } from '../../shared/utils/field-primer-display.js';

// A real, ISO-7064-valid ORCID (the canonical OpenAlex example iD).
const VALID_ORCID = '0000-0002-1825-0097';

describe('expertProfileLinks', () => {
  test('builds ORCID + OpenAlex links for a confirmed expert', () => {
    const links = expertProfileLinks({
      status: 'confirmed',
      orcid: VALID_ORCID,
      openAlexId: 'https://openalex.org/A5023888391',
    });
    expect(links).toEqual([
      { label: 'ORCID', href: `https://orcid.org/${VALID_ORCID}` },
      { label: 'OpenAlex', href: 'https://openalex.org/A5023888391' },
    ]);
  });

  test('builds links for a corrected (suggested) expert too', () => {
    const links = expertProfileLinks({ status: 'corrected', openAlexId: 'A5023888391' });
    expect(links).toEqual([{ label: 'OpenAlex', href: 'https://openalex.org/A5023888391' }]);
  });

  test('returns [] for unverified or ungrounded experts (nothing was resolved)', () => {
    expect(expertProfileLinks({ status: 'unverified', orcid: VALID_ORCID })).toEqual([]);
    expect(expertProfileLinks(null)).toEqual([]);
    expect(expertProfileLinks(undefined)).toEqual([]);
  });

  test('omits links whose ids are absent (fail closed)', () => {
    expect(expertProfileLinks({ status: 'confirmed' })).toEqual([]);
  });

  test('rejects an ORCID with an invalid ISO-7064 checksum (shape-valid but wrong)', () => {
    // Correct check digit for 0000-0001-2345-678X is 9; 0 fails the checksum.
    expect(expertProfileLinks({ status: 'confirmed', orcid: '0000-0001-2345-6780' })).toEqual([]);
    expect(expertProfileLinks({ status: 'confirmed', orcid: 'not-an-orcid' })).toEqual([]);
  });

  test('accepts a bare or URL-form OpenAlex id but ANCHORS the token', () => {
    // bare, lowercased → normalized
    expect(expertProfileLinks({ status: 'confirmed', openAlexId: 'a5023888391' }))
      .toEqual([{ label: 'OpenAlex', href: 'https://openalex.org/A5023888391' }]);
    // embedded / wrong-host / junk tokens must NOT fabricate a trusted link
    for (const bad of ['A-lang', 'evil-A123', 'https://not-openalex.example/A123', 'fooA123bar', 'A123 ) [x](javascript:alert(1))']) {
      expect(expertProfileLinks({ status: 'confirmed', openAlexId: bad })).toEqual([]);
    }
  });
});

describe('expertMetrics', () => {
  test('formats h-index and a thousands-separated citation count for a confirmed expert', () => {
    expect(expertMetrics({ status: 'confirmed', hIndex: 24, citedByCount: 5577 }))
      .toEqual(['h-index 24', '5,577 citations']);
  });

  test('includes only the metrics that are present', () => {
    expect(expertMetrics({ status: 'corrected', hIndex: 12 })).toEqual(['h-index 12']);
    expect(expertMetrics({ status: 'confirmed', citedByCount: 0 })).toEqual(['0 citations']);
  });

  test('is status-gated — no metrics for unverified/ungrounded experts (no false credibility)', () => {
    expect(expertMetrics({ status: 'unverified', hIndex: 99, citedByCount: 1000 })).toBeNull();
    expect(expertMetrics({ hIndex: 99 })).toBeNull();
    expect(expertMetrics(null)).toBeNull();
  });

  test('returns null when a grounded expert has neither metric', () => {
    expect(expertMetrics({ status: 'confirmed' })).toBeNull();
  });
});
