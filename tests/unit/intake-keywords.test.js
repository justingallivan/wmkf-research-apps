import { parseFieldKeywords, parseMethodsKeywords } from '../../shared/utils/intake-keywords';

const item = (term) => ({ term, group: 'Group', coined: false, id: 'e94bd184-a1e3-f111-84ea-6045bd04539e' });

test('wmkf-keywords/1 yields terms only, never ids, run references or groups', () => {
  const raw = JSON.stringify({
    schema: 'wmkf-keywords/1',
    source: { prompt: 'intake.keywords', version: 4, run: 'a714e182-22e8-f111-84e7-000d3a361c1f' },
    primary: item('Glaciology'), runner_up: item('Paleoclimatology'), reason: 'why',
    secondary: [item('Geophysics'), { term: 7 }, null], objects: [item('Ice sheets')], other: ['MicroED', 3, ' '],
  });
  const parsed = parseFieldKeywords(raw);
  expect(parsed).toEqual({ primary: 'Glaciology', runnerUp: 'Paleoclimatology', secondary: ['Geophysics'], objects: ['Ice sheets'], other: ['MicroED'] });
  expect(JSON.stringify(parsed)).not.toMatch(/e94bd184|a714e182|Group/);
});

test('empty is undefined; unreadable or another schema is null; a plain list is the older format', () => {
  expect(parseFieldKeywords(null)).toBeUndefined();
  expect(parseFieldKeywords('  ')).toBeUndefined();
  expect(parseFieldKeywords('{not json')).toBeNull();
  expect(parseFieldKeywords(JSON.stringify({ schema: 'wmkf-keywords/2' }))).toBeNull();
  expect(parseFieldKeywords('["Optics", 4]')).toEqual({ primary: null, runnerUp: null, secondary: ['Optics'], objects: [], other: [] });
});

test('wmkf-methods/1 yields method terms; other shapes follow the same rules', () => {
  expect(parseMethodsKeywords(JSON.stringify({ schema: 'wmkf-methods/1', methods: [item('Remote sensing'), {}] }))).toEqual(['Remote sensing']);
  expect(parseMethodsKeywords(undefined)).toBeUndefined();
  expect(parseMethodsKeywords(JSON.stringify({ schema: 'wmkf-keywords/1' }))).toBeNull();
  expect(parseMethodsKeywords('["Imaging"]')).toEqual(['Imaging']);
});
