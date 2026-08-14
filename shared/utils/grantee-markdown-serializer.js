/**
 * Client-safe serializer for the grantee abstract editor.
 *
 * The parent form and Dataverse continue to hold Markdown. Tiptap HTML exists
 * only inside the editor. This module converts the editor document back to the
 * exact subset accepted by shared/utils/grantee-markdown.js: paragraphs, hard
 * breaks, bold, italic, subscript, and superscript.
 */

import { MarkdownSerializerState } from '@tiptap/pm/markdown';

const MARK_SERIALIZERS = {
  bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
  italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
  subscript: { open: '~', close: '~', mixable: true, expelEnclosingWhitespace: true },
  superscript: { open: '^', close: '^', mixable: true, expelEnclosingWhitespace: true },
};

const NODE_SERIALIZERS = {
  paragraph(state, node) {
    state.renderInline(node);
    state.closeBlock(node);
  },
  hardBreak(state) {
    state.write('  \n');
  },
  text(state, node) {
    const lines = String(node.text || '').split('\n');
    lines.forEach((line, index) => {
      state.write();
      const startsLine = state.atBlockStart || state.out.endsWith('\n');
      state.out += escapeGranteeMarkdownText(line, startsLine);
      if (index < lines.length - 1) state.out += '\n';
    });
  },
};

/**
 * Escape text so it cannot become markup when rendered after persistence.
 * Active inline delimiters are always escaped; block syntax is escaped only at
 * the start of a line so ordinary prose punctuation remains readable.
 */
export function escapeGranteeMarkdownText(value, startOfLine = false) {
  let text = String(value ?? '').replace(/[\\`*~\[\]_^<>&]/g, '\\$&');
  if (!startOfLine) return text;

  // Indented code: encode one leading space so Marked keeps a paragraph.
  if (/^ {4}/.test(text)) text = `&#32;${text.slice(1)}`;

  text = text
    .replace(/^(\s{0,3})(#{1,6})(?=\s|$)/, '$1\\$2')
    .replace(/^(\s{0,3})([+-])(?=\s)/, '$1\\$2')
    .replace(/^(\s{0,3})>(?=\s|$)/, '$1\\>')
    .replace(/^(\s*\d{1,9})([.)])(?=\s)/, '$1\\$2')
    .replace(/^(\s{0,3})-(?=-{2,}\s*$)/, '$1\\-');

  return text;
}

function fallbackText(doc) {
  if (!doc) return '';
  let text = '';
  try {
    text = typeof doc.textBetween === 'function'
      ? doc.textBetween(0, doc.content.size, '\n\n', '')
      : String(doc.textContent || '');
  } catch {
    text = String(doc.textContent || '');
  }
  return text
    .split('\n')
    .map((line) => escapeGranteeMarkdownText(line, true))
    .join('\n');
}

/**
 * Serialize a ProseMirror/Tiptap document. This function deliberately never
 * throws to its caller: an unknown node or mark degrades the whole visible
 * document to escaped text, keeping parent state aligned with the editor.
 */
export function serializeGranteeAbstractMarkdown(doc) {
  if (!doc) return '';
  try {
    const state = new MarkdownSerializerState(
      NODE_SERIALIZERS,
      MARK_SERIALIZERS,
      { hardBreakNodeName: 'hardBreak', strict: true },
    );
    state.esc = (text, startOfLine = false) => escapeGranteeMarkdownText(text, startOfLine);
    state.renderContent(doc);
    return state.out;
  } catch {
    return fallbackText(doc);
  }
}

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'dt', 'dd',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);

function wrapAllowedMarks(text, marks) {
  const wrappers = [];
  if (marks.bold) wrappers.push('strong');
  if (marks.italic) wrappers.push('em');
  if (marks.subscript) wrappers.push('sub');
  else if (marks.superscript) wrappers.push('sup');
  return wrappers.reduceRight((result, tag) => `<${tag}>${result}</${tag}>`, text);
}

/**
 * Reduce pasted HTML to paragraphs plus the four allowed marks. Unsupported
 * structure becomes paragraph boundaries; links become their text; table/list
 * content remains in source order. The returned HTML is safe to hand to the
 * editor's schema parser and contains no attributes.
 */
export function sanitizeGranteeAbstractPasteHtml(rawHtml) {
  if (typeof DOMParser === 'undefined') {
    const text = String(rawHtml || '').replace(/<[^>]*>/g, ' ');
    return text.trim() ? `<p>${escapeHtml(text)}</p>` : '';
  }

  const parsed = new DOMParser().parseFromString(String(rawHtml || ''), 'text/html');
  const paragraphs = [];
  let current = [];

  const flush = () => {
    const content = current.join('');
    if (content) paragraphs.push(content);
    current = [];
  };

  const visit = (node, marks = {}) => {
    if (node.nodeType === 3) {
      current.push(wrapAllowedMarks(escapeHtml(node.nodeValue || ''), marks));
      return;
    }
    if (node.nodeType !== 1) return;

    const tag = node.tagName.toLowerCase();
    if (tag === 'br') {
      current.push('<br>');
      return;
    }
    if (tag === 'img') {
      const alt = node.getAttribute('alt');
      if (alt) current.push(wrapAllowedMarks(escapeHtml(alt), marks));
      return;
    }

    const block = BLOCK_TAGS.has(tag);
    if (block) flush();

    const nextMarks = { ...marks };
    if (tag === 'strong' || tag === 'b') nextMarks.bold = true;
    if (tag === 'em' || tag === 'i') nextMarks.italic = true;
    if (tag === 'sub' && !nextMarks.superscript) nextMarks.subscript = true;
    if (tag === 'sup' && !nextMarks.subscript) nextMarks.superscript = true;

    Array.from(node.childNodes).forEach((child) => visit(child, nextMarks));
    if (block) flush();
  };

  Array.from(parsed.body.childNodes).forEach((node) => visit(node));
  flush();
  return paragraphs.map((content) => `<p>${content}</p>`).join('');
}
