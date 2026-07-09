/**
 * @jest-environment node
 *
 * Regression: the discovery recorder must not use a Proxy `get` trap that
 * returns a wrapped function over the adapter module. In the production
 * (Turbopack) bundle, module exports are non-configurable, non-writable DATA
 * properties, and the ES Proxy invariant forbids a `get` trap from returning a
 * value other than the target's own for such properties — so the old Proxy
 * threw "'get' on proxy: property 'findByEmailCandidates' is a read-only and
 * non-configurable data property" on the FIRST property access, 500-ing every
 * manual reviewer lookup in prod (regressed in 4070728b). Dev / raw-ESM don't
 * freeze exports, so this only reproduced against frozen exports — which this
 * test simulates directly on the recordingAdapter wrapper.
 */

const { recordingAdapter } = require('../../lib/services/reviewer-identity-lookup');

// Emulate a bundled module namespace: exports are non-configurable, non-writable
// data properties. new Proxy(this, {get}) that returns a wrapper would throw.
function frozenExports(members) {
  const o = {};
  for (const [name, value] of Object.entries(members)) {
    Object.defineProperty(o, name, { value, writable: false, configurable: false, enumerable: true });
  }
  return o;
}

function emptyDiscoveries() {
  return { reviewers: new Map(), contacts: new Map() };
}

describe('recordingAdapter over frozen (bundled) module exports', () => {
  test('accessing a recorded method does not violate the Proxy invariant', () => {
    const adapter = frozenExports({
      findByEmailCandidates: async () => ({ none: true }),
      searchByName: async () => [],
    });
    const rec = recordingAdapter(adapter, 'reviewer', emptyDiscoveries(), {
      findByEmailCandidates: 'email',
      searchByName: 'name',
    });
    // The regression threw HERE (property access), before any call.
    expect(() => rec.findByEmailCandidates).not.toThrow();
    expect(typeof rec.findByEmailCandidates).toBe('function');
  });

  test('wrapped method still runs and records the fetch signal', async () => {
    const row = { wmkf_potentialreviewersid: '11111111-1111-4111-8111-111111111111', wmkf_orcid: null };
    const adapter = frozenExports({
      findByEmailCandidates: async () => ({ one: true, id: row.wmkf_potentialreviewersid, row }),
    });
    const discoveries = emptyDiscoveries();
    const rec = recordingAdapter(adapter, 'reviewer', discoveries, { findByEmailCandidates: 'email' });

    const result = await rec.findByEmailCandidates('x@y.edu');
    expect(result).toEqual({ one: true, id: row.wmkf_potentialreviewersid, row });
    // The row was recorded into discoveries as a side effect of the wrapper.
    expect(discoveries.reviewers.has(row.wmkf_potentialreviewersid.toLowerCase())).toBe(true);
  });

  test('non-recorded exports pass through unchanged', () => {
    const create = async () => ({ id: 'x', created: true });
    const adapter = frozenExports({ create, searchByName: async () => [] });
    const rec = recordingAdapter(adapter, 'reviewer', emptyDiscoveries(), { searchByName: 'name' });
    expect(rec.create).toBe(create);
  });
});
