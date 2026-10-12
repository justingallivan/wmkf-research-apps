/** @jest-environment node */
import { composeToolPrompt } from '../../lib/services/tool-prompt-composer';
import { buildUntrustedContentPreamble } from '../../lib/utils/ai-payload-boundary';

test('interpolates variables', () => {
  expect(composeToolPrompt('Hello {{ name }}, {{n}} items', { name: 'Ada', n: 3 })).toBe('Hello Ada, 3 items');
});

test('an unfilled slot throws and names the slot', () => {
  expect(() => composeToolPrompt('a {{x}} b {{y}}', { x: '1' })).toThrow(/unfilled template slot\(s\): y/);
});

test('prepends the preamble naming the nonces, separated by a blank line', () => {
  const out = composeToolPrompt('body {{v}}', { v: 'X' }, { nonces: ['aaa', 'bbb'] });
  const pre = buildUntrustedContentPreamble(['aaa', 'bbb']);
  expect(out).toBe(`${pre}\n\nbody X`);
  expect(out).toContain('aaa, bbb');
});

test('empty nonce array still prepends the preamble; custom separator honored', () => {
  const out = composeToolPrompt('b', {}, { nonces: [], separator: '\n---\n' });
  expect(out).toBe(`${buildUntrustedContentPreamble([])}\n---\nb`);
});

test('null nonces: no preamble', () => {
  expect(composeToolPrompt('b {{v}}', { v: 1 })).toBe('b 1');
  expect(composeToolPrompt('b', {}, { nonces: null })).not.toContain('UNTRUSTED CONTENT RULES');
});

test('a variable value containing {{x}} is not re-expanded and is not an unfilled slot', () => {
  expect(composeToolPrompt('A {{a}} B {{x}}', { a: 'see {{x}}', x: 'REAL' })).toBe('A see {{x}} B REAL');
  expect(composeToolPrompt('A {{a}}', { a: 'literal {{x}}' })).toBe('A literal {{x}}');
});

describe('reserved {{a7_preamble}} slot', () => {
  test('is substituted in place and not prepended', () => {
    const out = composeToolPrompt('Intro\n\n{{a7_preamble}}\n\nTask {{v}}', { v: 'X' }, { nonces: ['n1'] });
    expect(out).toBe(`Intro\n\n${buildUntrustedContentPreamble(['n1'])}\n\nTask X`);
    expect(out.startsWith('Intro')).toBe(true);
  });
  test('empty nonce array still fills the slot', () => {
    expect(composeToolPrompt('A\n\n{{a7_preamble}}\n\nB', {}, { nonces: [] }))
      .toBe(`A\n\n${buildUntrustedContentPreamble([])}\n\nB`);
  });
  test('null nonces with a slot throws', () => {
    expect(() => composeToolPrompt('A {{a7_preamble}}', {}, { nonces: null })).toThrow(/a7_preamble/);
    expect(() => composeToolPrompt('A {{a7_preamble}}', {})).toThrow(/a7_preamble/);
  });
  test('caller-supplied a7_preamble throws', () => {
    expect(() => composeToolPrompt('A {{a7_preamble}}', { a7_preamble: 'x' }, { nonces: [] })).toThrow(/reserved/);
    expect(() => composeToolPrompt('A', { a7_preamble: 'x' }, { nonces: [] })).toThrow(/reserved/);
  });
});
