/**
 * Review Panel Phase A document renderers (DOCX + PDF), private-Blob editions
 * only (D4: no SharePoint publishing in Phase A). Parameterised clone of
 * cycle-dossier-documents.js's rendering approach (paginated PDF builder,
 * docx package for Word), pointed at the panel's report shape instead of the
 * dossier's research-memo shape.
 *
 * Report sections, in order (docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.7):
 *  1. Rating matrix (chair synthesis)
 *  2. Panel summary (consensus/disagreements/strengths/concerns/questions for PI/
 *     resolvable-vs-fundamental/recommendation/confidence)
 *  3. Per-seat reviews, labelled by vendor and the PINNED model from the run's
 *     config snapshot (never re-resolved) — teamCapacity (D7) always renders
 *     as the fixed not-assessable line, imported from review-panel-questions.js,
 *     never retyped here.
 *  4. Cost breakdown from sumAttemptCosts: when unknownCount > 0 the total is
 *     WITHHELD (no number printed at all) with a one-line explanation instead.
 */
import { createHash } from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { REVIEW_PANEL_NOT_ASSESSABLE_REPORT_LINE } from './review-panel-questions';

const str = (value) => String(value ?? '').trim();
const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const TEAM_CAPACITY_KEY = 'teamCapacity';

const VENDOR_LABELS = Object.freeze({ anthropic: 'Anthropic (Claude)', openai: 'OpenAI' });

/** Verify the rendered DOCX is a well-formed OOXML package before it is ever persisted — a lightweight structural check (word/document.xml present and non-empty), not the dossier's SharePoint round-trip tamper check, which does not apply here (D4: no SharePoint). */
async function assertStructurallyValidDocx(bytes) {
  const JSZip = (await import('jszip')).default;
  let zip;
  try { zip = await JSZip.loadAsync(bytes); }
  catch { throw new Error('Rendered review panel DOCX is not a valid package.'); }
  const doc = zip.file('word/document.xml');
  const text = doc ? await doc.async('string') : '';
  if (!text || !text.includes('<w:document')) throw new Error('Rendered review panel DOCX is missing its document body.');
  return bytes;
}

function fieldLines(answers) {
  const lines = [];
  for (const [key, value] of Object.entries(answers || {})) {
    if (key === TEAM_CAPACITY_KEY) { lines.push([key, REVIEW_PANEL_NOT_ASSESSABLE_REPORT_LINE]); continue; }
    if (value == null) continue;
    lines.push([key, Array.isArray(value) ? value.join(', ') : String(value)]);
  }
  return lines;
}

// Entry-scoped (review-panel-worker.js passes sumEntryAttemptCosts, not the
// run-wide sumAttemptCosts) — labelled "for this request" so it is never
// mistaken for a run total.
function costLines(cost) {
  if (!cost) return ['Cost for this request: unavailable.'];
  if (cost.unknownCount > 0) {
    return [`Cost for this request withheld: ${cost.unknownCount} attempt(s) with unknown outcome.`];
  }
  return [`Cost for this request: $${(Number(cost.totalCents || 0) / 100).toFixed(2)}.`];
}

// ── PDF ─────────────────────────────────────────────────────────────────
class ReviewPanelPdfBuilder {
  async init() {
    this.doc = await PDFDocument.create();
    this.fonts = { regular: await this.doc.embedFont(StandardFonts.Helvetica), bold: await this.doc.embedFont(StandardFonts.HelveticaBold) };
    this.addPage();
    return this;
  }
  addPage() { this.currentPage = this.doc.addPage([612, 792]); this.yPosition = 738; return this; }
  ensureSpace(height) { if (this.yPosition - height < 54) this.addPage(); }
  addParagraph(value, { fontSize = 11, bold = false, gap = 8 } = {}) {
    const font = this.fonts[bold ? 'bold' : 'regular'];
    for (const paragraph of String(value ?? '').split('\n')) {
      let line = ''; let width = 0;
      const flush = () => {
        this.ensureSpace(fontSize + 5);
        this.currentPage.drawText(line, { x: 54, y: this.yPosition, size: fontSize, font, color: rgb(0.12, 0.12, 0.12) });
        this.yPosition -= fontSize + 5; line = ''; width = 0;
      };
      for (const word of paragraph.split(/(\s+)/)) {
        const wordWidth = font.widthOfTextAtSize(word, fontSize);
        if (width && width + wordWidth > 504) flush();
        if (!line && /^\s+$/.test(word)) continue;
        line += word; width += wordWidth;
      }
      if (line) flush(); else this.yPosition -= 5;
    }
    this.yPosition -= gap;
    return this;
  }
  addTitle(title, subtitle) { this.addParagraph(title, { fontSize: 20, bold: true }); if (subtitle) this.addParagraph(subtitle, { fontSize: 10 }); return this; }
  addSection(title) { this.ensureSpace(50); this.yPosition -= 8; return this.addParagraph(title, { fontSize: 14, bold: true, gap: 5 }); }
  async build() { return this.doc.save(); }
}

function renderReportPdf(report) {
  return (async () => {
    const b = await new ReviewPanelPdfBuilder().init();
    b.addTitle(str(report.title), 'Virtual Review Panel · Phase A · private edition');
    if (report.institution) b.addParagraph(`Institution: ${str(report.institution)}`, { fontSize: 9 });

    b.addSection('Rating matrix');
    b.addParagraph(JSON.stringify(report.chair?.ratingMatrix ?? {}, null, 2), { fontSize: 9 });

    b.addSection('Panel summary');
    for (const [label, key] of [
      ['Consensus', 'consensus'], ['Disagreements', 'disagreements'], ['Key strengths', 'keyStrengths'],
      ['Key concerns', 'keyConcerns'], ['Questions for PI', 'questionsForPI'],
      ['Resolvable vs. fundamental', 'resolvableVsFundamental'], ['Panel recommendation', 'panelRecommendation'],
      ['Confidence note', 'confidenceNote'],
    ]) {
      const value = report.chair?.[key];
      if (value == null) continue;
      b.addParagraph(`${label}:`, { bold: true, gap: 2 });
      b.addParagraph(Array.isArray(value) ? value.map((v) => `- ${str(v)}`).join('\n') : str(value));
    }

    for (const seat of report.seats || []) {
      b.addSection(`${seat.label} (${VENDOR_LABELS[seat.vendor] || seat.vendor} — ${seat.model})`);
      for (const [key, value] of fieldLines(seat.answers)) b.addParagraph(`${key}: ${value}`, { fontSize: 10, gap: 4 });
    }

    b.addSection('Cost');
    for (const line of costLines(report.cost)) b.addParagraph(line, { fontSize: 10 });

    const pages = b.doc.getPages();
    pages.forEach((page, index) => page.drawText(`Page ${index + 1} of ${pages.length}`, { x: page.getWidth() - 100, y: 24, size: 8, font: b.fonts.regular }));
    return b.build();
  })();
}

// ── DOCX ────────────────────────────────────────────────────────────────
async function renderReportDocx(report) {
  const { Document, Footer, HeadingLevel, PageNumber, Packer, Paragraph, TextRun } = await import('docx');
  const body = (value, options = {}) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: str(value), font: 'Calibri', size: 22, ...options })] });
  const heading = (value, level = HeadingLevel.HEADING_1) => new Paragraph({ heading: level, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: str(value), font: 'Calibri', size: level === HeadingLevel.HEADING_1 ? 28 : 24, bold: true })] });

  const children = [heading(report.title, HeadingLevel.TITLE), body('Virtual Review Panel · Phase A · private edition', { italics: true, color: '666666' })];
  if (report.institution) children.push(body(`Institution: ${str(report.institution)}`, { size: 18, color: '666666' }));

  children.push(heading('Rating matrix', HeadingLevel.HEADING_2));
  children.push(body(JSON.stringify(report.chair?.ratingMatrix ?? {}, null, 2)));

  children.push(heading('Panel summary', HeadingLevel.HEADING_2));
  for (const [label, key] of [
    ['Consensus', 'consensus'], ['Disagreements', 'disagreements'], ['Key strengths', 'keyStrengths'],
    ['Key concerns', 'keyConcerns'], ['Questions for PI', 'questionsForPI'],
    ['Resolvable vs. fundamental', 'resolvableVsFundamental'], ['Panel recommendation', 'panelRecommendation'],
    ['Confidence note', 'confidenceNote'],
  ]) {
    const value = report.chair?.[key];
    if (value == null) continue;
    children.push(body(`${label}:`, { bold: true }));
    children.push(body(Array.isArray(value) ? value.map((v) => `- ${str(v)}`).join('\n') : str(value)));
  }

  for (const seat of report.seats || []) {
    children.push(heading(`${seat.label} (${VENDOR_LABELS[seat.vendor] || seat.vendor} — ${seat.model})`, HeadingLevel.HEADING_2));
    for (const [key, value] of fieldLines(seat.answers)) children.push(body(`${key}: ${value}`));
  }

  children.push(heading('Cost', HeadingLevel.HEADING_2));
  for (const line of costLines(report.cost)) children.push(body(line));

  const footer = new Footer({ children: [new Paragraph({ alignment: 'center', children: [new TextRun({ text: 'Page ', font: 'Calibri', size: 18 }), new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', size: 18 })] })] });
  const doc = new Document({ creator: 'W. M. Keck Foundation Request Workbench', title: str(report.title), sections: [{ footers: { default: footer }, children }] });
  return Packer.toBuffer(doc);
}

/**
 * Render one entry's report as DOCX + PDF editions. `report` is a plain,
 * already-assembled object (never a live DB row): { title, institution,
 * chair: <chairResult>, seats: [{ seatKey, label, vendor, model, answers }],
 * cost: { totalCents, unknownCount } }. The service layer assembles this from
 * the entry's winners_json + attempt ledger + the run's pinned config
 * snapshot; this module never queries the database.
 *
 * `formats` (default both) lets a caller render only the format(s) it still
 * needs — review-panel-worker.js's completeEntryWithReport uses this to
 * avoid re-rendering (and re-uploading, at a create-only Blob pathname) a
 * format that already has a persisted ref on the entry, since a fresh render
 * produces different bytes each time (e.g. a docx creation timestamp) and
 * would fail a create-only put against the same pathname on retry.
 */
export async function renderReviewPanelEntryDocuments(report, { formats = ['docx', 'pdf'] } = {}) {
  if (!report || typeof report !== 'object') throw new Error('renderReviewPanelEntryDocuments requires a report object');
  const wantDocx = formats.includes('docx');
  const wantPdf = formats.includes('pdf');
  const [docxRaw, pdfRaw] = await Promise.all([
    wantDocx ? renderReportDocx(report) : Promise.resolve(null),
    wantPdf ? renderReportPdf(report) : Promise.resolve(null),
  ]);
  const docx = wantDocx ? await assertStructurallyValidDocx(docxRaw) : null;
  const pdf = wantPdf ? Buffer.from(pdfRaw) : null;
  return {
    docx, pdf,
    docxSha256: docx ? hashBytes(docx) : null,
    pdfSha256: pdf ? hashBytes(pdf) : null,
  };
}
