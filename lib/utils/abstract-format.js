/**
 * Shared proposal-abstract text formatting.
 *
 * The stored `wmkf_abstract` (written once by GoApply at submission) is sometimes
 * a fixed-column hard-wrapped block — an administrator pasted from a PDF without
 * fixing the formatting — so it carries a hard newline every ~15 words. Rendered
 * naively into an email, every newline becomes a `<br>`, producing mid-sentence
 * line breaks. These helpers detect that condition and reflow the text.
 *
 * Calibrated against a read-only probe of ~200 real abstracts (S340).
 */

// A line that ends at a sentence/clause boundary. Its trailing newline is an
// intentional break, not an auto-wrap.
const SENTENCE_END = /[.?!:;]["')\]]?$/;

// A wrapped line is near a column limit; a shorter line that breaks early was
// broken on purpose.
const WRAP_MIN = 64;

/**
 * True if the abstract contains at least one hard-wrap artifact: a single
 * newline whose preceding line ends WITHOUT terminal punctuation (a mid-sentence
 * break). Nobody hand-breaks a line in the middle of a sentence, so this is an
 * essentially unambiguous signal that the text was hard-wrapped and will render
 * with stray `<br>`s. Reliable for FLAGGING ("does this contain wrapping"); it
 * does NOT claim to recover the abstract's true paragraph structure. On the S340
 * probe it flagged ~9.5% of abstracts, with zero false positives on clean or
 * blank-line-paragraph abstracts.
 *
 * @param {string} text
 * @returns {boolean}
 */
function hasAbstractWrapArtifacts(text) {
  if (!text) return false;
  const paragraphs = String(text).replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/);
  for (const para of paragraphs) {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length - 1; i++) {
      if (!SENTENCE_END.test(lines[i])) return true;
    }
  }
  return false;
}

/**
 * Reflow hard-wrapped prose so it flows to the consumer's own width WITHOUT
 * flattening prose that separates paragraphs with a single newline.
 *
 * Within each blank-line-delimited paragraph, classify first: if the interior
 * lines are DOMINANTLY mid-sentence (a fixed-column hard-wrapped block), join
 * every line — including one that happens to end a sentence right at the wrap
 * column, which is a wrap coincidence, not a paragraph break. Otherwise the
 * lines end at sentences or are short (intentional separators) and are kept,
 * joining only a genuinely-wrapped long non-sentence line. Blank lines always
 * stay as paragraph breaks. Calibrated against 41 real abstracts (S340) incl.
 * #1002794 (fully wrapped, no blank lines -> one flowing block) and #1003141
 * (single-newline paragraph separators -> preserved).
 *
 * LIMIT: a fully-wrapped no-blank-line abstract has lost its true internal
 * paragraphing upstream; this renders clean continuous prose as a best-effort
 * guess, not a guarantee of the author's original structure. Free-text prose
 * only — do NOT use on structured blocks whose newlines are intentional.
 *
 * @param {string} text
 * @returns {string}
 */
function reflowAbstract(text) {
  if (!text) return '';
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((para) => {
      const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length <= 1) return lines.join('');
      const interior = lines.slice(0, -1);
      const midSentence = interior.filter((l) => !SENTENCE_END.test(l)).length;
      const isWrappedBlock = midSentence >= Math.max(2, interior.length * 0.34);
      if (isWrappedBlock) return lines.join(' ');
      let out = '';
      for (let i = 0; i < lines.length; i++) {
        out += lines[i];
        if (i < lines.length - 1) {
          // A line that does not end at a sentence/clause boundary is a wrap
          // fragment. Join it forward when it is long (near a wrap column) OR the
          // next line continues in lower case (an unambiguous mid-sentence
          // continuation). Keep a short line whose successor starts a new
          // capitalized unit — that is a header/label, not a wrap.
          const wrapped = !SENTENCE_END.test(lines[i]) &&
            (lines[i].length >= WRAP_MIN || /^[a-z]/.test(lines[i + 1]));
          out += wrapped ? ' ' : '\n';
        }
      }
      return out.trim();
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * True when reflowAbstract would change the stored text — i.e. the abstract has
 * a hard-wrap the render auto-cleans. This is the render gate's flag: it holds
 * exactly when the modal's "auto-cleaned for these emails" claim is accurate,
 * so a header-style intentional break (which reflow leaves alone) is NOT
 * flagged and a save of the reflowed text clears the flag on re-render.
 *
 * @param {string} text
 * @returns {boolean}
 */
function abstractNeedsReflow(text) {
  return !!text && reflowAbstract(text) !== text;
}

module.exports = { hasAbstractWrapArtifacts, reflowAbstract, abstractNeedsReflow, SENTENCE_END };
