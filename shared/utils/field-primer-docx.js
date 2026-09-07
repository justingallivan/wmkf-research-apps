/**
 * generateFieldPrimerDocx — client-side DOCX renderer for the Workbench
 * Proposal tab's Field Primer export, and the FULL-FIDELITY one.
 *
 * WHY THIS EXISTS ALONGSIDE THE PDF. `shared/utils/field-primer-pdf.js` draws
 * with pdf-lib's base-14 Helvetica, which cannot mix bold and italic mid-line
 * and cannot encode anything outside WinAnsi, so a Greek letter in the model's
 * prose (α-synuclein, β-sheet) reaches the page as '?'. Word documents carry
 * real inline runs and full Unicode, so this renderer keeps emphasis, keeps
 * Greek, and turns an expert's public profile into a real hyperlink instead of
 * a spelled-out URL. Same split the Reviews tab already uses: DOCX is the
 * complete artifact, PDF is the convenient flattened one.
 *
 * Follows `shared/utils/review-report-docx.js` conventions: dynamic
 * `import('docx')` so the library stays out of the initial bundle, Calibri
 * 11pt body, and a returned Blob that the caller downloads.
 *
 * HEADINGS. Uses the same canonical document headings as the markdown renderer
 * (`renderPrimerMarkdown`) and the PDF, pinned in
 * `tests/unit/field-primer-pdf.test.js`. Unlike the PDF, Caveats is a real
 * heading here, so this renderer matches the markdown contract with no
 * exception.
 *
 * SCOPE CARRIES INTO THE FILE. A Word document leaves the app, so it repeats
 * the orientation disclaimer and the grounding legend rather than relying on
 * surrounding UI. The primer is field orientation and is NEVER a
 * reviewer-candidate or contact source (see shared/config/prompts/
 * field-primer.js); only public profile links and already-resolved
 * bibliometrics appear, never a contact channel.
 *
 * @param {Object} envelope - a parsed field-primer envelope (schema
 *   `field-primer/v1`): { generatedAt, model, runId, primer }.
 * @param {Object} [meta] - request identity: { requestNumber, title,
 *   institution, pi }.
 * @returns {Promise<Blob>} the .docx bytes.
 */
import { expertProfileLinks, expertMetrics } from './field-primer-display';

const DISCLAIMER = 'Orienting field review. Not an evaluation of the proposal, and not vetted reviewer suggestions.';

const GROUNDING_LEGEND = 'Experts are grounded against OpenAlex, which confirms a real author of that name works in '
  + 'this field. That is NOT proof of identity. Verify anyone before you rely on them.';

// The model's output is parseable JSON but not per-field schema-validated, so a
// value that should be prose can arrive as an object or array. Coerce to a
// string; non-string/number becomes ''.
const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const objects = (items) => (Array.isArray(items) ? items.filter((it) => it && typeof it === 'object') : []);

function groundingMarker(grounding) {
  const status = grounding && typeof grounding === 'object' ? grounding.status : null;
  if (status === 'confirmed') {
    return grounding.affiliationMatch ? 'confirmed, institution match' : 'confirmed';
  }
  if (status === 'corrected') {
    const resolved = str(grounding.resolvedName).trim();
    const via = str(grounding.corroboration).trim() || 'field';
    return resolved
      ? `suggested correction: likely ${resolved}, via ${via}; verify same person`
      : `suggested correction, via ${via}; verify same person`;
  }
  if (status === 'unverified') {
    const note = str(grounding.note).trim();
    return note ? `unverified: ${note}` : 'unverified';
  }
  return '';
}

export async function generateFieldPrimerDocx(envelope, meta = {}) {
  const {
    Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel,
  } = await import('docx');

  const FONT = 'Calibri';
  const BODY_SIZE = 22; // 11pt, in half-points
  const primer = envelope && typeof envelope.primer === 'object' && envelope.primer ? envelope.primer : {};

  const run = (text, opts = {}) => new TextRun({ text, size: BODY_SIZE, font: FONT, ...opts });
  const para = (children, opts = {}) => new Paragraph({ spacing: { after: 120 }, ...opts, children });
  const heading = (text) => new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [run(text, { bold: true, size: 26 })],
  });

  const children = [];

  // --- Header ---
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [run('Field Primer', { bold: true, size: 36 })],
  }));

  const identity = [
    str(meta.requestNumber).trim() ? `Request ${str(meta.requestNumber).trim()}` : null,
    str(meta.title).trim() || null,
    str(meta.institution).trim() || null,
  ].filter(Boolean).join('  •  ');
  if (identity) children.push(para([run(identity, { color: '666666' })]));

  children.push(para([run(DISCLAIMER, { italics: true, color: '996600' })]));

  const provenance = [];
  const generatedRaw = str(envelope?.generatedAt).trim();
  if (generatedRaw) {
    const parsed = new Date(generatedRaw);
    provenance.push(`Generated ${Number.isNaN(parsed.getTime()) ? generatedRaw : parsed.toLocaleString()}`);
  }
  if (str(meta.pi).trim()) provenance.push(`PI ${str(meta.pi).trim()}`);
  if (str(envelope?.model).trim()) provenance.push(`Model ${str(envelope.model).trim()}`);
  if (str(envelope?.runId).trim()) provenance.push(`Run ${str(envelope.runId).trim()}`);
  provenance.push(`Exported ${new Date().toLocaleString()}`);
  children.push(para([run(provenance.join(' · '), { size: 18, color: '888888' })]));

  // --- Overview ---
  const overview = str(primer.field_overview).trim();
  if (overview) {
    children.push(heading('Overview'));
    children.push(para([run(overview)]));
  }

  // --- Bold-name bullet sections. The name is a real bold run, which is the
  // whole point of this renderer over the PDF. ---
  const listSection = (label, items, pick) => {
    const rows = objects(items)
      .map(pick)
      .map(([name, description]) => [str(name).trim(), str(description).trim()])
      .filter(([name, description]) => name || description);
    if (!rows.length) return;
    children.push(heading(label));
    for (const [name, description] of rows) {
      const runs = [];
      if (name) runs.push(run(name, { bold: true }));
      if (name && description) runs.push(run(' — '));
      if (description) runs.push(run(description));
      children.push(para(runs, { bullet: { level: 0 }, spacing: { after: 60 } }));
    }
  };

  listSection('Sub-areas', primer.subareas, (s) => [s.name, s.description]);
  listSection('Key methods', primer.key_methods, (m) => [m.name, m.description]);
  listSection('Frontiers & why now', primer.frontiers, (f) => [f.frontier, f.why_now]);
  listSection('Active communities', primer.communities, (c) => [c.name, c.description]);

  // --- Venues ---
  const venues = Array.isArray(primer.venues)
    ? primer.venues.map((v) => str(v).trim()).filter(Boolean)
    : [];
  if (venues.length) {
    children.push(heading('Notable venues'));
    children.push(para([run(venues.join(' · '))]));
  }

  // --- Experts ---
  const experts = objects(primer.experts);
  if (experts.length) {
    children.push(heading('Field experts (orienting, not vetted)'));
    if (experts.some((e) => e.grounding && typeof e.grounding === 'object')) {
      children.push(para([run(GROUNDING_LEGEND, { italics: true, size: 18, color: '888888' })]));
    }
    for (const expert of experts) {
      const name = str(expert.name).trim() || 'Unnamed expert';
      const affiliation = str(expert.affiliation).trim();
      const marker = groundingMarker(expert.grounding);
      const why = str(expert.why_relevant).trim();

      const runs = [run(name, { bold: true })];
      if (affiliation) runs.push(run(` (${affiliation})`));
      if (marker) runs.push(run(` [${marker}]`, { italics: true, color: '996600' }));
      if (why) runs.push(run(` — ${why}`));
      children.push(para(runs, { bullet: { level: 0 }, spacing: { after: 40 } }));

      // Metrics and REAL hyperlinks, both gated to a grounded identity by the
      // shared helper so an unverified name never gains credibility.
      const metrics = expertMetrics(expert.grounding) || [];
      const links = expertProfileLinks(expert.grounding);
      if (metrics.length || links.length) {
        const detail = [];
        if (metrics.length) detail.push(run(metrics.join(' · '), { size: 18, color: '888888' }));
        links.forEach((link, i) => {
          if (detail.length) detail.push(run(' · ', { size: 18, color: '888888' }));
          else if (i > 0) detail.push(run(' · ', { size: 18, color: '888888' }));
          detail.push(new ExternalHyperlink({
            link: link.href,
            children: [run(link.label, { size: 18, color: '0563C1', underline: {} })],
          }));
        });
        children.push(para(detail, { bullet: { level: 1 }, spacing: { after: 80 } }));
      }
    }
  }

  // --- Placement + caveats ---
  const placement = str(primer.proposal_placement).trim();
  if (placement) {
    children.push(heading('Where this proposal sits'));
    children.push(para([run(placement)]));
  }

  const caveats = str(primer.caveats).trim();
  if (caveats) {
    children.push(heading('Caveats'));
    children.push(para([run(caveats, { italics: true })]));
  }

  const doc = new Document({
    creator: 'W. M. Keck Foundation Research Review',
    title: `Field Primer${str(meta.requestNumber).trim() ? ` — Request ${str(meta.requestNumber).trim()}` : ''}`,
    description: DISCLAIMER,
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}

/**
 * Stable, identifiable download filename. Mirrors `fieldPrimerPdfFilename`:
 * falls back to the date when the request number is unknown, and never emits a
 * path separator.
 *
 * @param {Object} [meta] - { requestNumber }
 * @returns {string}
 */
export function fieldPrimerDocxFilename(meta = {}) {
  const requestNumber = str(meta.requestNumber).trim().replace(/[^A-Za-z0-9_-]/g, '');
  const stamp = new Date().toISOString().slice(0, 10);
  return requestNumber ? `field-primer-${requestNumber}-${stamp}.docx` : `field-primer-${stamp}.docx`;
}
