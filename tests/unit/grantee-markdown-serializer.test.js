/**
 * @jest-environment jsdom
 */

import { DOMParser as ProseMirrorDOMParser, Schema } from '@tiptap/pm/model';
import { renderGranteeBody } from '../../shared/utils/grantee-markdown';
import {
  escapeGranteeMarkdownText,
  sanitizeGranteeAbstractPasteHtml,
  serializeGranteeAbstractMarkdown,
} from '../../shared/utils/grantee-markdown-serializer';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'inline*', group: 'block',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    hardBreak: {
      inline: true, group: 'inline', selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
    text: { group: 'inline' },
  },
  marks: {
    bold: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
    italic: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
    subscript: { excludes: 'superscript', parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
    superscript: { excludes: 'subscript', parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
  },
});

const mark = (name) => schema.marks[name].create();
const text = (value, marks = []) => schema.text(value, marks.map(mark));
const paragraph = (...content) => schema.nodes.paragraph.create(null, content);
const doc = (...content) => schema.nodes.doc.create(null, content);

function parseRenderedMarkdown(markdown) {
  const container = document.createElement('div');
  container.innerHTML = renderGranteeBody(markdown);
  return ProseMirrorDOMParser.fromSchema(schema).parse(container);
}

describe('escapeGranteeMarkdownText', () => {
  test('escapes active delimiters, raw HTML/entity starts, and contextual block syntax', () => {
    expect(escapeGranteeMarkdownText('* _ ~ ^ \\ ` [x] <tag> &copy;')).toBe(
      '\\* \\_ \\~ \\^ \\\\ \\` \\[x\\] \\<tag\\> \\&copy;',
    );
    expect(escapeGranteeMarkdownText('# heading', true)).toBe('\\# heading');
    expect(escapeGranteeMarkdownText('1. list', true)).toBe('1\\. list');
    expect(escapeGranteeMarkdownText('2) list', true)).toBe('2\\) list');
    expect(escapeGranteeMarkdownText('---', true)).toBe('\\---');
    expect(escapeGranteeMarkdownText('    code', true)).toBe('&#32;   code');
    expect(escapeGranteeMarkdownText('E. coli', true)).toBe('E. coli');
  });
});

describe('serializeGranteeAbstractMarkdown', () => {
  test('emits the canonical mark, paragraph, and hard-break grammar', () => {
    const value = doc(
      paragraph(
        text('Escherichia coli', ['italic']), text(' is '), text('important', ['bold']),
        text('; H'), text('2', ['subscript']), text('O and x'), text('2', ['superscript']),
      ),
      paragraph(text('second'), schema.nodes.hardBreak.create(), text('line')),
    );
    expect(serializeGranteeAbstractMarkdown(value)).toBe(
      '*Escherichia coli* is **important**; H~2~O and x^2^\n\nsecond  \nline',
    );
  });

  test('escapes block syntax after hard breaks and normalizes legacy soft breaks explicitly', () => {
    const value = doc(paragraph(
      text('First'), schema.nodes.hardBreak.create(), text('# not a heading'),
      schema.nodes.hardBreak.create(), text('1. not a list'),
    ));
    const markdown = serializeGranteeAbstractMarkdown(value);
    expect(markdown).toBe('First  \n\\# not a heading  \n1\\. not a list');
    expect(renderGranteeBody(markdown)).not.toMatch(/<(?:h1|ol|li)>/);

    const normalized = serializeGranteeAbstractMarkdown(parseRenderedMarkdown('First\nSecond'));
    expect(normalized).toBe('First Second');
  });

  test('merges adjacent identical marks, expels surrounding whitespace, and uses deterministic nesting', () => {
    const value = doc(paragraph(
      text(' ', ['bold', 'italic']),
      text('both', ['bold', 'italic']),
      text(' ', ['bold', 'italic']),
      text('H', ['bold', 'italic']),
      text('2', ['bold', 'italic', 'subscript']),
      text('O', ['bold', 'italic']),
    ));
    expect(serializeGranteeAbstractMarkdown(value)).toBe(' ***both H~2~O***');
  });

  test('literal delimiters and approximation markers remain literal after render and reload', () => {
    const visible = String.raw`pH 7 ~ 8; ~5 rise, ~8 fall; ^5 rise, ^8 fall; *literal*`;
    const markdown = serializeGranteeAbstractMarkdown(doc(paragraph(text(visible))));
    expect(markdown).toContain('\\~5 rise, \\~8 fall');
    expect(markdown).toContain('\\^5 rise, \\^8 fall');
    const html = renderGranteeBody(markdown);
    expect(html).not.toMatch(/<(?:sub|sup|em)>/);
    expect(parseRenderedMarkdown(markdown).textContent).toBe(visible);
  });

  test('serialization is a fixed point for every supported fixture', () => {
    const fixtures = [
      'Plain paragraph.',
      '*Escherichia coli* and **important**.',
      'H~2~O and x^2^',
      '***both*** and ***H~2~O***',
      'First  \nSecond\n\nThird',
      String.raw`literal \\ \* \_ \~ \^`,
      String.raw`\<tag\> and \&copy;`,
    ];
    for (const fixture of fixtures) {
      const once = serializeGranteeAbstractMarkdown(parseRenderedMarkdown(fixture));
      const twice = serializeGranteeAbstractMarkdown(parseRenderedMarkdown(once));
      expect(twice).toBe(once);
    }
  });

  test('an unsupported mark degrades to escaped visible text without throwing', () => {
    const fallbackSchema = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { content: 'inline*', group: 'block' },
        text: { group: 'inline' },
      },
      marks: { link: { attrs: { href: {} } } },
    });
    const linked = fallbackSchema.text('*visible*', [fallbackSchema.marks.link.create({ href: 'https://example.com' })]);
    const unknown = fallbackSchema.nodes.doc.create(null, fallbackSchema.nodes.paragraph.create(null, linked));
    expect(() => serializeGranteeAbstractMarkdown(unknown)).not.toThrow();
    expect(serializeGranteeAbstractMarkdown(unknown)).toBe('\\*visible\\*');
  });
});

describe('sanitizeGranteeAbstractPasteHtml', () => {
  test('keeps allowed marks and all visible Word/Docs-style text while flattening structure and links', () => {
    const input = `
      <h1>Study heading</h1>
      <p><strong>Bold</strong> and <a href="https://example.com">linked text</a>.</p>
      <ul><li>First item</li><li><em>Second item</em></li></ul>
      <table><tr><td>Cell one</td><td><sup>Cell two</sup></td></tr></table>
      <blockquote>Quoted conclusion</blockquote>
    `;
    const output = sanitizeGranteeAbstractPasteHtml(input);
    expect(output).toContain('<strong>Bold</strong>');
    expect(output).toContain('<em>Second item</em>');
    expect(output).toContain('<sup>Cell two</sup>');
    expect(output).not.toMatch(/<(?:h1|a|ul|li|table|tr|td|blockquote)\b/);
    for (const words of ['Study heading', 'linked text', 'First item', 'Cell one', 'Quoted conclusion']) {
      expect(output).toContain(words);
    }
  });

  test('removes raw elements and attributes while retaining inert text in source order', () => {
    const output = sanitizeGranteeAbstractPasteHtml(
      '<p style="color:red">safe <script>alert(1)</script><img src=x onerror=bad alt="figure text"> end</p>',
    );
    expect(output).toContain('safe alert(1)figure text end');
    expect(output).not.toMatch(/<(?:script|img)\b|style=|onerror=/);
  });
});
