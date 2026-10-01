/** Frozen copy of the 2026-10-01 baseline implementation for differential tests. */
const crypto = require('node:crypto');

// Keep this implementation independent from the production helper. It is the
// exact private function present in the three services before extraction.
function baselineCanonicalize(value) {
  if (Array.isArray(value)) return value.map(baselineCanonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, baselineCanonicalize(value[key])]),
  );
}

function baselineDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(baselineCanonicalize(value))).digest('hex');
}

test('baseline canonicalization preserves object sort, integer-key enumeration, and array order', () => {
  const left = { z: 1, a: { y: 2, b: 3 }, '10': 'ten', '2': 'two', '01': 'leading' };
  const right = { '01': 'leading', '2': 'two', '10': 'ten', a: { b: 3, y: 2 }, z: 1 };
  expect(JSON.stringify(baselineCanonicalize(left)))
    .toBe('{"2":"two","10":"ten","01":"leading","a":{"b":3,"y":2},"z":1}');
  expect(baselineDigest(left)).toBe(baselineDigest(right));
  expect(baselineDigest({ values: [1, 2] })).not.toBe(baselineDigest({ values: [2, 1] }));
  const sparse = [];
  sparse[2] = 'last';
  expect(baselineCanonicalize(sparse)).toEqual([undefined, undefined, 'last']);
});

test('baseline canonicalization preserves JavaScript values, prototypes, and toJSON behavior', () => {
  const inherited = Object.create({ inherited: 'ignored' });
  Object.defineProperty(inherited, 'hidden', { value: 'ignored', enumerable: false });
  inherited.visible = 'kept';
  inherited[Symbol('ignored')] = 'ignored';
  Object.defineProperty(inherited, '__proto__', { value: { own: true }, enumerable: true });
  inherited.constructor = 'own-constructor';
  expect(JSON.stringify(baselineCanonicalize(inherited)))
    .toBe('{"__proto__":{"own":true},"constructor":"own-constructor","visible":"kept"}');
  expect(baselineCanonicalize({ date: new Date('2020-01-01T00:00:00.000Z') })).toEqual({ date: {} });
  expect(baselineCanonicalize({ value: { toJSON() { return 'custom'; } } }).value.toJSON()).toBe('custom');
  expect(JSON.stringify(baselineCanonicalize({ root: undefined, arr: [undefined, null, false, -0, NaN, Infinity] })))
    .toBe('{"arr":[null,null,false,0,null,null]}');
  expect(JSON.stringify(baselineCanonicalize({ decomposed: 'e\u0301', composed: 'é' })))
    .toBe('{"composed":"é","decomposed":"é"}');
  expect(() => baselineDigest({ value: 1n })).toThrow(TypeError);
  const cyclic = {}; cyclic.self = cyclic;
  expect(() => baselineCanonicalize(cyclic)).toThrow(RangeError);
  expect(JSON.stringify(baselineCanonicalize(undefined))).toBeUndefined();
  expect(() => baselineDigest(undefined)).toThrow(/data.*undefined/i);
});
