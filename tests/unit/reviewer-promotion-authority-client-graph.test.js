/** @jest-environment node */

const fs = require('fs');
const path = require('path');

const {
  isIdentityAuthoritySatisfied,
  isCandidateIdentityAuthoritySatisfied,
  isStaffIdentityConfirmationSatisfied,
  hasCandidateStaffIdentityConfirmation,
} = require('../../lib/utils/reviewer-identity-authority');

function localDependencies(file) {
  const source = fs.readFileSync(file, 'utf8');
  const dependencies = [];
  const matcher = /(?:require\(|from\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
  let match;
  while ((match = matcher.exec(source))) {
    const base = path.resolve(path.dirname(file), match[1]);
    const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
    const resolved = candidates.find((candidate) => fs.existsSync(candidate));
    if (resolved) dependencies.push(resolved);
  }
  return dependencies;
}

function localImportGraph(entry) {
  const pending = [entry];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    pending.push(...localDependencies(file));
  }
  return [...visited];
}

test('the dependency-free identity predicate recognizes only positive resolver or staff authority', () => {
  expect(isIdentityAuthoritySatisfied({ identityEvidence: { decision: 'confirmed' } })).toBe(true);
  expect(isIdentityAuthoritySatisfied({ identityEvidence: { decision: 'probable' } })).toBe(true);
  expect(isIdentityAuthoritySatisfied({ identityEvidence: { decision: 'ambiguous' } })).toBe(false);
  expect(isIdentityAuthoritySatisfied({ identityEvidence: {
    staffConfirmation: {
      state: 'confirmed',
      canonicalPersonId: '11111111-1111-4111-8111-111111111111',
      canonicalPersonEtag: 'W/"etag-1"',
      actorId: 'staff-1',
      confirmedAt: '2026-08-02T00:00:00.000Z',
    },
  } })).toBe(true);
  expect(isIdentityAuthoritySatisfied({ identityEvidence: {
    staffConfirmation: {
      state: 'confirmed',
      canonicalPersonId: '11111111-1111-4111-8111-111111111111',
      canonicalPersonEtag: 'W/"etag-1"',
      actorId: 'staff-1',
      confirmedAt: '2026-08-02T00:00:00Z',
    },
  } })).toBe(false);
  expect(isIdentityAuthoritySatisfied({ identityEvidence: {
    staffConfirmation: {
      state: 'confirmed',
      canonicalPersonId: 'not-a-guid',
      confirmedAt: '2026-08-02T00:00:00.000Z',
    },
  } })).toBe(false);
});

test.each([null, undefined, '', 'malformed', 0, 1, true, false, [], () => {}])(
  'identity authority predicates fail closed for malformed input %#',
  (malformed) => {
    expect(() => isStaffIdentityConfirmationSatisfied(malformed)).not.toThrow();
    expect(isStaffIdentityConfirmationSatisfied(malformed)).toBe(false);

    expect(() => hasCandidateStaffIdentityConfirmation(malformed)).not.toThrow();
    expect(hasCandidateStaffIdentityConfirmation(malformed)).toBe(false);

    expect(() => isCandidateIdentityAuthoritySatisfied(malformed)).not.toThrow();
    expect(isCandidateIdentityAuthoritySatisfied(malformed)).toBe(false);

    expect(() => isIdentityAuthoritySatisfied(malformed)).not.toThrow();
    expect(isIdentityAuthoritySatisfied(malformed)).toBe(false);

    expect(() => isIdentityAuthoritySatisfied({
      candidate: malformed,
      identityEvidence: malformed,
      identityResult: malformed,
    })).not.toThrow();
    expect(isIdentityAuthoritySatisfied({
      candidate: malformed,
      identityEvidence: malformed,
      identityResult: malformed,
    })).toBe(false);
  },
);

test('shared reviewer search policy cannot pull Node crypto through promotion authority', () => {
  const sharedSearchLogic = fs.readFileSync(
    require.resolve('../../shared/components/reviewers/reviewer-search-logic'),
    'utf8',
  );
  expect(sharedSearchLogic).toMatch(/reviewer-promotion-authority/);

  const graph = localImportGraph(require.resolve('../../lib/services/reviewer-promotion-authority'));
  expect(graph.some((file) => file.endsWith('/reviewer-stage-source-versions.js'))).toBe(false);
  expect(graph.some((file) => /(?:require\(|from\s+)['"](?:node:)?crypto['"]/.test(
    fs.readFileSync(file, 'utf8'),
  ))).toBe(false);
});
