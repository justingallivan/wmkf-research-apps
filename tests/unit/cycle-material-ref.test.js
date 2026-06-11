/**
 * Unit tests for the shared cycle-material ref classifier (Phase 1 private-blob
 * migration). The strict-prefix discriminator is the security-relevant decision
 * (Codex SLICE2-4): only a `cycle-materials/`-prefixed non-URL value is private;
 * everything else fails safe to legacy-public.
 */

const {
  CYCLE_MATERIAL_PREFIX,
  isPrivateCycleMaterialPathname,
  cycleMaterialDownloadPath,
} = require('../../lib/utils/cycle-material-ref');

describe('isPrivateCycleMaterialPathname', () => {
  it('accepts a prefixed bare pathname', () => {
    expect(isPrivateCycleMaterialPathname(`${CYCLE_MATERIAL_PREFIX}review-abc.docx`)).toBe(true);
  });

  it('rejects an http(s) URL (legacy public)', () => {
    expect(isPrivateCycleMaterialPathname('https://x.public.blob.vercel-storage.com/a.pdf')).toBe(false);
    expect(isPrivateCycleMaterialPathname('http://x/a.pdf')).toBe(false);
  });

  it('rejects a protocol-relative URL', () => {
    expect(isPrivateCycleMaterialPathname('//cdn.example.com/a.pdf')).toBe(false);
  });

  it('rejects a non-prefixed bare pathname (the fragile "not-http" case)', () => {
    expect(isPrivateCycleMaterialPathname('review-abc.docx')).toBe(false);
    expect(isPrivateCycleMaterialPathname('uploads/review-abc.docx')).toBe(false);
  });

  it('rejects empty / non-string values without throwing', () => {
    expect(isPrivateCycleMaterialPathname('')).toBe(false);
    expect(isPrivateCycleMaterialPathname(null)).toBe(false);
    expect(isPrivateCycleMaterialPathname(undefined)).toBe(false);
    expect(isPrivateCycleMaterialPathname(42)).toBe(false);
  });

  it('does not let a prefix substring elsewhere qualify (must be at the start)', () => {
    expect(isPrivateCycleMaterialPathname(`x/${CYCLE_MATERIAL_PREFIX}a.pdf`)).toBe(false);
  });
});

describe('cycleMaterialDownloadPath', () => {
  it('builds a record-scoped URL with both params encoded', () => {
    const url = cycleMaterialDownloadPath('cyc 1', 'cycle-materials/a b.pdf');
    expect(url).toBe('/api/reviewer-finder/cycle-material?cycleId=cyc%201&pathname=cycle-materials%2Fa%20b.pdf');
  });
});
