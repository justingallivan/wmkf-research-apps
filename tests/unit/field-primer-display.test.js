/**
 * Unit tests for the field-primer expert display helpers (profile links +
 * bibliometrics). Pure, dependency-free — no mocks needed.
 */
import { expertProfileLinks, expertMetrics } from '../../shared/utils/field-primer-display.js';

describe('expertProfileLinks', () => {
  test('builds ORCID, OpenAlex, and Wikipedia links for a confirmed expert', () => {
    const links = expertProfileLinks({
      status: 'confirmed',
      orcid: '0000-0001-2345-6789',
      openAlexId: 'https://openalex.org/A5023888391',
      wikipedia: 'https://en.wikipedia.org/wiki/Jane_Doe',
    });
    expect(links).toEqual([
      { label: 'ORCID', href: 'https://orcid.org/0000-0001-2345-6789' },
      { label: 'OpenAlex', href: 'https://openalex.org/A5023888391' },
      { label: 'Wikipedia', href: 'https://en.wikipedia.org/wiki/Jane_Doe' },
    ]);
  });

  test('builds links for a corrected (suggested) expert too', () => {
    const links = expertProfileLinks({ status: 'corrected', openAlexId: 'A5023888391' });
    expect(links).toEqual([{ label: 'OpenAlex', href: 'https://openalex.org/A5023888391' }]);
  });

  test('returns [] for unverified or ungrounded experts (nothing was resolved)', () => {
    expect(expertProfileLinks({ status: 'unverified', orcid: '0000-0001-2345-6789' })).toEqual([]);
    expect(expertProfileLinks(null)).toEqual([]);
    expect(expertProfileLinks(undefined)).toEqual([]);
  });

  test('omits links whose ids are absent or malformed (fail closed)', () => {
    expect(expertProfileLinks({ status: 'confirmed' })).toEqual([]);
    expect(expertProfileLinks({ status: 'confirmed', orcid: 'not-an-orcid' })).toEqual([]);
    // A bare OpenAlex token that isn't an author id → no link.
    expect(expertProfileLinks({ status: 'confirmed', openAlexId: 'A-lang' })).toEqual([]);
  });

  test('normalizes the OpenAlex id token from a full URL or bare form', () => {
    expect(expertProfileLinks({ status: 'confirmed', openAlexId: 'a5023888391' }))
      .toEqual([{ label: 'OpenAlex', href: 'https://openalex.org/A5023888391' }]);
  });

  test('rejects a non-Wikipedia / non-https wikipedia value (defense in depth)', () => {
    expect(expertProfileLinks({ status: 'confirmed', wikipedia: 'http://en.wikipedia.org/wiki/X' })).toEqual([]);
    expect(expertProfileLinks({ status: 'confirmed', wikipedia: 'https://evil.example.com/wiki/X' })).toEqual([]);
    expect(expertProfileLinks({ status: 'confirmed', wikipedia: 'javascript:alert(1)' })).toEqual([]);
  });
});

describe('expertMetrics', () => {
  test('formats h-index and a thousands-separated citation count', () => {
    expect(expertMetrics({ hIndex: 24, citedByCount: 5577 })).toEqual(['h-index 24', '5,577 citations']);
  });

  test('includes only the metrics that are present', () => {
    expect(expertMetrics({ hIndex: 12 })).toEqual(['h-index 12']);
    expect(expertMetrics({ citedByCount: 0 })).toEqual(['0 citations']);
  });

  test('returns null when neither metric is present', () => {
    expect(expertMetrics({ status: 'confirmed' })).toBeNull();
    expect(expertMetrics(null)).toBeNull();
  });
});
