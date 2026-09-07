/**
 * generateFieldPrimerPdf — client-side PDF renderer for the Workbench Proposal
 * tab's Field Primer export.
 *
 * The primer is a THIRD render surface for the same `envelope.primer` object,
 * alongside:
 *   - renderPrimerMarkdown (lib/services/field-primer-service.js, server/CLI)
 *   - ProposalTab PrimerView (shared/components/workbench/ProposalTab.js, client)
 *
 * HEADINGS FOLLOW THE MARKDOWN RENDERER, NOT THE SCREEN. Those two existing
 * surfaces already disagree: the compact on-screen panel says "Subareas",
 * "Frontiers", "Communities", "Venues", "Experts (orienting only - verify
 * before use)", while the document renderer says "Sub-areas", "Frontiers & why
 * now", "Active communities", "Notable venues", "Field experts (orienting, not
 * vetted)". This export is a document, so it tracks the document renderer
 * heading-for-heading; `tests/unit/field-primer-pdf.test.js` pins that against
 * `renderPrimerMarkdown` so the claim is enforced rather than asserted. The one
 * intentional difference is Caveats, which renders as a highlight box to match
 * the amber callout the screen uses, not as a plain section.
 *
 * Expert links and bibliometrics come from the shared `field-primer-display`
 * helpers so all three surfaces agree on WHICH experts get an identity
 * treatment — an `unverified` name never carries metrics or a profile link.
 *
 * SCOPE CARRIES INTO THE FILE. A PDF leaves the app, so the exported document
 * repeats the orientation disclaimer and the grounding legend verbatim rather
 * than relying on surrounding UI. The primer is field orientation and is NEVER
 * a reviewer-candidate or contact source (see shared/config/prompts/
 * field-primer.js); only public profile links and already-resolved
 * bibliometrics appear, never a contact channel.
 *
 * Built on `PDFReportBuilder` (shared/utils/pdf-export.js), which draws with
 * pdf-lib's standard Helvetica faces. DEGRADATION, same as
 * shared/utils/review-report-pdf.js: there is no primitive that mixes
 * bold/italic mid-line, so an expert's name, its grounding marker, and its
 * affiliation render as one plain line, and a profile link renders as
 * "ORCID (https://…)" so the target is not silently lost. Markdown emphasis
 * that the model may emit inside a prose field is left as authored.
 *
 * CHARACTERS. `PDFReportBuilder` sanitizes every text path to WinAnsi and
 * replaces what it cannot map with '?'. Two consequences worth knowing: this
 * renderer joins with a plain hyphen rather than the em dash the markdown and
 * React surfaces use, because an em dash sanitizes to '--'; and a Greek letter
 * in the model's prose (α-synuclein, β-sheet) renders as '?'. Prose fidelity
 * for symbol-heavy fields therefore belongs to the on-screen primer, not to
 * this export.
 *
 * @param {Object} envelope - a parsed field-primer envelope (schema
 *   `field-primer/v1`): { generatedAt, model, runId, promptVersion, primer }.
 * @param {Object} [meta] - request identity for the header:
 *   { requestNumber, title, institution, pi }.
 * @returns {Promise<Uint8Array>} PDF bytes — pass to `downloadPdf` from
 *   shared/utils/pdf-export.js to trigger the download.
 */
import { PDFReportBuilder } from './pdf-export';
import { expertProfileLinks, expertMetrics } from './field-primer-display';

const DISCLAIMER = 'Orienting field review. Not an evaluation of the proposal, and not vetted reviewer suggestions.';

const GROUNDING_LEGEND = 'Experts are grounded against OpenAlex, which confirms a real author of that name works in '
  + 'this field. That is NOT proof of identity. [confirmed] = a matching author was found; '
  + '[suggested correction] = a likely forename correction, verify it is the same person; '
  + '[unverified] = verify manually.';

// The model's output is parseable JSON but not per-field schema-validated, so a
// value that should be prose can arrive as an object or array. Coerce to a
// string the PDF primitives accept, exactly as PrimerView's `str` does for
// React children. Non-string/number becomes ''.
const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

// Drop null/non-object entries before rendering a list, matching PrimerList.
const objects = (items) => (Array.isArray(items) ? items.filter((it) => it && typeof it === 'object') : []);

// "Name - description", omitting the dash when there is no description.
function pair(name, description) {
  const left = str(name).trim();
  const right = str(description).trim();
  if (left && right) return `${left} - ${right}`;
  return left || right;
}

function groundingMarker(grounding) {
  const status = grounding && typeof grounding === 'object' ? grounding.status : null;
  if (status === 'confirmed') {
    return grounding.affiliationMatch ? '[confirmed, institution match]' : '[confirmed]';
  }
  if (status === 'corrected') {
    const resolved = str(grounding.resolvedName).trim();
    const via = str(grounding.corroboration).trim() || 'field';
    return resolved
      ? `[suggested correction: likely ${resolved}, via ${via}; verify same person]`
      : `[suggested correction, via ${via}; verify same person]`;
  }
  if (status === 'unverified') {
    const note = str(grounding.note).trim();
    return note ? `[unverified: ${note}]` : '[unverified]';
  }
  return '';
}

// One expert renders as up to two bullet lines: the identity line, then an
// indented continuation carrying metrics and public profile links.
function expertLines(expert) {
  const name = str(expert.name).trim() || 'Unnamed expert';
  const affiliation = str(expert.affiliation).trim();
  const marker = groundingMarker(expert.grounding);
  const why = str(expert.why_relevant).trim();

  const head = [
    affiliation ? `${name} (${affiliation})` : name,
    marker,
  ].filter(Boolean).join(' ');

  const lines = [why ? `${head} - ${why}` : head];

  const metrics = expertMetrics(expert.grounding) || [];
  const links = expertProfileLinks(expert.grounding).map((l) => `${l.label} (${l.href})`);
  const extras = [...metrics, ...links];
  if (extras.length) lines.push(`    ${extras.join(' · ')}`);
  return lines;
}

function formatTimestamp(value) {
  const raw = str(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString();
}

export async function generateFieldPrimerPdf(envelope, meta = {}) {
  const primer = envelope && typeof envelope.primer === 'object' && envelope.primer ? envelope.primer : {};
  const builder = new PDFReportBuilder();
  await builder.init();

  const requestNumber = str(meta.requestNumber).trim();
  const subtitle = [
    requestNumber ? `Request ${requestNumber}` : null,
    str(meta.title).trim() || null,
    str(meta.institution).trim() || null,
  ].filter(Boolean).join('  •  ');

  builder.addTitle('Field Primer', subtitle || null);
  builder.addParagraph(DISCLAIMER, { font: 'italic' });

  const generated = formatTimestamp(envelope?.generatedAt);
  if (generated) builder.addMetadata('Generated', generated);
  if (str(meta.pi).trim()) builder.addMetadata('Principal Investigator', str(meta.pi).trim());
  if (str(envelope?.model).trim()) builder.addMetadata('Model', str(envelope.model).trim());
  if (str(envelope?.runId).trim()) builder.addMetadata('Run', str(envelope.runId).trim());
  builder.addMetadata('Exported', new Date().toLocaleString());
  builder.addDivider();

  const overview = str(primer.field_overview).trim();
  if (overview) {
    builder.addSection('Overview');
    builder.addParagraph(overview);
  }

  const listSection = (heading, items, format) => {
    const rows = objects(items).map(format).filter(Boolean);
    if (!rows.length) return;
    builder.addSection(heading);
    builder.addBulletList(rows);
  };

  listSection('Sub-areas', primer.subareas, (s) => pair(s.name, s.description));
  listSection('Key methods', primer.key_methods, (m) => pair(m.name, m.description));
  listSection('Frontiers & why now', primer.frontiers, (f) => pair(f.frontier, f.why_now));
  listSection('Active communities', primer.communities, (c) => pair(c.name, c.description));

  const venues = Array.isArray(primer.venues)
    ? primer.venues.map((v) => str(v).trim()).filter(Boolean)
    : [];
  if (venues.length) {
    builder.addSection('Notable venues');
    builder.addParagraph(venues.join(' · '));
  }

  const experts = objects(primer.experts);
  if (experts.length) {
    builder.addSection('Field experts (orienting, not vetted)');
    if (experts.some((e) => e.grounding && typeof e.grounding === 'object')) {
      builder.addParagraph(GROUNDING_LEGEND, { fontSize: 9, font: 'italic' });
    }
    builder.addBulletList(experts.flatMap(expertLines));
  }

  const placement = str(primer.proposal_placement).trim();
  if (placement) {
    builder.addSection('Where this proposal sits');
    builder.addParagraph(placement);
  }

  const caveats = str(primer.caveats).trim();
  if (caveats) builder.addHighlightBox('Caveats', caveats);

  return builder.build();
}

/**
 * Stable, identifiable download filename. Falls back to the generation date
 * when the request number is unknown, and never emits a path separator.
 *
 * @param {Object} [meta] - { requestNumber }
 * @returns {string}
 */
export function fieldPrimerPdfFilename(meta = {}) {
  const requestNumber = str(meta.requestNumber).trim().replace(/[^A-Za-z0-9_-]/g, '');
  const stamp = new Date().toISOString().slice(0, 10);
  return requestNumber ? `field-primer-${requestNumber}-${stamp}.pdf` : `field-primer-${stamp}.pdf`;
}
