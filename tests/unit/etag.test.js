/**
 * @jest-environment node
 */
import { isConcreteEtag } from '../../lib/utils/etag.js';

describe('isConcreteEtag', () => {
  it.each([
    ['"1"'],
    ['W/"1"'],
    ['"abc123"'],
    ['W/"reread"'],
  ])('accepts a concrete quoted etag: %s', (value) => {
    expect(isConcreteEtag(value)).toBe(true);
  });

  it.each([
    ['wildcard', '*'],
    ['empty weak quotes', 'W/""'],
    ['empty string', ''],
    ['whitespace-padded', ' "1" '],
    ['unquoted', 'abc'],
    ['control character inside quotes', '"a\tb"'],
    ['non-string number', 123],
    ['undefined', undefined],
    ['null', null],
    ['object', {}],
  ])('rejects %s', (_label, value) => {
    expect(isConcreteEtag(value)).toBe(false);
  });
});
