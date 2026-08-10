/**
 * generateReviewReportPdf — client-side PDF renderer for the workbench
 * Reviews tab panel-prep export (Phase 3,
 * docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md).
 *
 * Built on `PDFReportBuilder` (shared/utils/pdf-export.js), which draws with
 * pdf-lib's Helvetica/HelveticaBold/HelveticaOblique standard fonts — there
 * is no single "run" primitive that mixes bold/italic mid-line the way docx
 * TextRuns do. DEGRADATION (documented per the Phase 3 plan, decision 4):
 * inline formatting is FLATTENED — a run's bold/italic flags are dropped and
 * only its plain text is rendered, except a run with an `href` renders as
 * "text (url)" so links aren't silently lost. Bullet list-items render as a
 * bullet line via `addBulletList`; headings/blockquotes render as a section
 * label or indented paragraph. This keeps the renderer inside
 * PDFReportBuilder's existing paragraph/list primitives rather than adding a
 * rich mixed-run text layout engine, which pdf-lib does not provide for
 * free — full-fidelity DOCX is the primary/complete artifact; PDF is a
 * simpler, plain-text-flattened rendition of the same report object.
 *
 * Consumes the plain report object from `composeReviewReport`
 * (shared/utils/review-report.js).
 *
 * @param {ReturnType<import('./review-report').composeReviewReport>} report
 * @returns {Promise<Uint8Array>} PDF bytes — pass to `downloadPdf` from
 *   shared/utils/pdf-export.js to trigger the download.
 */
import { PDFReportBuilder } from './pdf-export';

// Flatten a block's inline runs to plain text (see module header for the
// documented degradation). A run with an href appends "(url)" so the link
// target isn't lost even though it isn't clickable.
function blockToPlainText(block) {
  return block.runs
    .map((r) => {
      const text = r.text.replace(/\n/g, ' ').trim();
      if (!text) return '';
      return r.href ? `${text} (${r.href})` : text;
    })
    .filter(Boolean)
    .join(' ')
    .trim();
}

export async function generateReviewReportPdf(report) {
  const builder = new PDFReportBuilder();
  await builder.init();

  const { header } = report;
  const generatedLabel = (() => {
    const d = new Date(header.generatedAtIso);
    return Number.isNaN(d.getTime()) ? header.generatedAtIso : d.toLocaleString();
  })();

  builder.addTitle(
    header.requestTitle || `Request ${header.requestNumber || ''}`.trim() || 'Review Report',
    [header.requestNumber ? `Request ${header.requestNumber}` : null, header.piName, header.institution]
      .filter(Boolean)
      .join('  •  '),
  );
  builder.addMetadata('Generated', generatedLabel);
  builder.addMetadata('Reviews submitted', String(header.reviewerCount));
  builder.addDivider();

  // --- Named reviewer roster ---
  // Kept separate from the anonymous synthesis narrative by contract.
  if (Array.isArray(report.reviewers) && report.reviewers.length > 0) {
    builder.addSection('Reviewers');
    for (const reviewer of report.reviewers) {
      builder.addKeyValue(
        reviewer.name || 'Unnamed reviewer',
        reviewer.affiliation || 'Not reported',
      );
    }
  }

  // --- Summary ---
  builder.addSection('Summary');
  builder.addParagraph(`${report.summary.reviewsSubmitted} review${report.summary.reviewsSubmitted === 1 ? '' : 's'} submitted.`);
  for (const q of report.summary.ratingQuestions) {
    const spread = q.min != null && q.max != null ? `${q.min}–${q.max}` : 'n/a';
    const avg = q.average != null ? q.average : 'n/a';
    const label = q.retired ? `${q.text} (prior cycle)` : q.text;
    builder.addKeyValue(label, `avg ${avg} · spread ${spread} · ${q.answeredCount}/${q.totalReviewers} answered`);
  }

  // --- Synthesis (Phase 4, optional — omitted entirely when not passed) ---
  if (report.synthesisSection) {
    const s = report.synthesisSection;
    builder.addSection(s.current === false ? 'AI Synthesis (stale)' : 'AI Synthesis');
    if (s.current === false) {
      builder.addParagraph(
        'The reviewer roster and answers reflect current submissions; this synthesis may reflect an earlier reviewer set.',
        { font: 'italic' },
      );
    }
    if (s.consensus.length > 0) {
      builder.addKeyValue('Consensus', '');
      builder.addBulletList(s.consensus);
    }
    if (s.disagreements.length > 0) {
      builder.addKeyValue('Disagreements', '');
      builder.addBulletList(s.disagreements);
    }
    if (s.keyConcerns.length > 0) {
      builder.addKeyValue('Key concerns', '');
      builder.addBulletList(s.keyConcerns);
    }
    if (s.ratingSummaries.length > 0) {
      builder.addSection('Rating summaries', 2);
      for (const rs of s.ratingSummaries) {
        builder.addKeyValue(rs.questionText || rs.questionKey, rs.summary || '');
      }
    }
    if (s.overall) {
      builder.addKeyValue('Overall', s.overall);
    }
  }

  // --- Per-question answer sections (picklist + multiselect + richtext, question order) ---
  for (const section of report.answerSections || []) {
    const label = section.retired ? `${section.text} (prior cycle)` : section.text;
    builder.addSection(label);
    if (section.type === 'picklist') {
      for (const answer of section.answers) {
        const value = answer.state === 'not-asked'
          ? 'Not asked'
          : answer.label != null ? answer.label : 'No answer provided';
        builder.addKeyValue(answer.reviewerName || 'Unnamed reviewer', value);
      }
      continue;
    }
    if (section.type === 'multiselect') {
      for (const answer of section.answers) {
        const value = answer.unreadable
          ? 'Unreadable answer'
          : answer.state === 'not-asked'
            ? 'Not asked'
            : answer.labels.length > 0 ? answer.labels.join('; ') : 'No answer provided';
        builder.addKeyValue(answer.reviewerName || 'Unnamed reviewer', value);
      }
      continue;
    }
    for (const answer of section.answers) {
      builder.addSection(answer.reviewerName || 'Unnamed reviewer', 2);
      if (answer.state === 'not-asked') {
        builder.addParagraph('Not asked', { font: 'italic' });
      } else if (answer.state === 'empty' || answer.blocks.length === 0) {
        builder.addParagraph('No answer provided', { font: 'italic' });
      } else {
        const flattened = answer.blocks.map(blockToPlainText).filter(Boolean).join('\n\n');
        builder.addParagraph(flattened || 'No answer provided');
      }
    }
  }

  return builder.build();
}
