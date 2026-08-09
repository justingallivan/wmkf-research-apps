/**
 * generateReviewReportDocx — client-side DOCX renderer for the workbench
 * Reviews tab panel-prep export (Phase 3,
 * docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md).
 *
 * Follows `shared/utils/word-export.js` conventions: dynamic `import('docx')`
 * (kept out of the initial bundle — see that module's header), returns a
 * Blob, caller triggers the download (e.g. via an `<a>`/`URL.createObjectURL`
 * pattern, same as `downloadPdf` in shared/utils/pdf-export.js).
 *
 * Consumes the plain report object from `composeReviewReport`
 * (shared/utils/review-report.js) — this module does no HTML parsing itself;
 * narrative content already arrives as typed blocks/runs from that module's
 * `htmlToBlocks` tokenizer. Styling is deliberately simple (headings, table
 * borders, bold labels) — this is a panel-prep document, not marketing
 * collateral.
 *
 * @param {ReturnType<import('./review-report').composeReviewReport>} report
 * @returns {Promise<Blob>}
 */
export async function generateReviewReportDocx(report) {
  const {
    Document, Packer, Paragraph, TextRun,
    Table, TableRow, TableCell, WidthType,
    AlignmentType, BorderStyle, HeadingLevel,
  } = await import('docx');

  const FONT = 'Calibri';
  const BODY_SIZE = 22; // 11pt

  const cellBorders = {
    top: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
    left: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
    right: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
  };

  function bodyRun(text, opts = {}) {
    return new TextRun({ text, size: BODY_SIZE, font: FONT, ...opts });
  }

  function headerCell(text, widthPct) {
    return new TableCell({
      width: { size: widthPct, type: WidthType.PERCENTAGE },
      borders: cellBorders,
      shading: { fill: 'F2F2F2' },
      children: [new Paragraph({ children: [bodyRun(text, { bold: true })] })],
    });
  }

  function bodyCell(text, widthPct, opts = {}) {
    return new TableCell({
      width: { size: widthPct, type: WidthType.PERCENTAGE },
      borders: cellBorders,
      children: [new Paragraph({ children: [bodyRun(text ?? '—', opts)] })],
    });
  }

  // --- Header ---
  const { header } = report;
  const generatedLabel = (() => {
    const d = new Date(header.generatedAtIso);
    return Number.isNaN(d.getTime()) ? header.generatedAtIso : d.toLocaleString();
  })();

  const headerChildren = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({
        text: header.requestTitle || `Request ${header.requestNumber || ''}`.trim() || 'Review Report',
        size: 32,
        font: FONT,
        bold: true,
      })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        bodyRun(
          [
            header.requestNumber ? `Request ${header.requestNumber}` : null,
            header.piName || null,
            header.institution || null,
          ].filter(Boolean).join('  •  '),
          { color: '666666' },
        ),
      ],
    }),
    new Paragraph({
      spacing: { after: 300 },
      children: [bodyRun(`Generated ${generatedLabel} • ${header.reviewerCount} review${header.reviewerCount === 1 ? '' : 's'} submitted`, { italics: true, color: '888888' })],
    }),
  ];

  // --- Summary section ---
  const summaryChildren = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 120 },
      children: [new TextRun({ text: 'Summary', size: 26, font: FONT, bold: true })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [bodyRun(`${report.summary.reviewsSubmitted} review${report.summary.reviewsSubmitted === 1 ? '' : 's'} submitted.`)],
    }),
  ];

  if (report.summary.ratingQuestions.length > 0) {
    const summaryRows = [
      new TableRow({
        children: [
          headerCell('Question', 55),
          headerCell('Average', 15),
          headerCell('Spread', 15),
          headerCell('Answered', 15),
        ],
      }),
      ...report.summary.ratingQuestions.map((q) => new TableRow({
        children: [
          bodyCell(q.retired ? `${q.text} (prior cycle)` : q.text, 55),
          bodyCell(q.average != null ? String(q.average) : null, 15),
          bodyCell(q.min != null && q.max != null ? `${q.min}–${q.max}` : null, 15),
          bodyCell(`${q.answeredCount}/${q.totalReviewers}`, 15),
        ],
      })),
    ];
    summaryChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: summaryRows }));
  }

  // --- Synthesis (Phase 4, optional — omitted entirely when not passed) ---
  const synthesisChildren = [];
  if (report.synthesisSection) {
    const s = report.synthesisSection;
    synthesisChildren.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 120 },
      children: [new TextRun({ text: 'AI Synthesis', size: 26, font: FONT, bold: true })],
    }));
    function bulletList(title, items) {
      if (!items || items.length === 0) return;
      synthesisChildren.push(new Paragraph({
        spacing: { before: 160, after: 60 },
        children: [bodyRun(title, { bold: true })],
      }));
      for (const item of items) {
        synthesisChildren.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [bodyRun(item)] }));
      }
    }
    bulletList('Consensus', s.consensus);
    bulletList('Disagreements', s.disagreements);
    bulletList('Key concerns', s.keyConcerns);
    if (s.ratingSummaries.length > 0) {
      synthesisChildren.push(new Paragraph({
        spacing: { before: 160, after: 60 },
        children: [bodyRun('Rating summaries', { bold: true })],
      }));
      for (const rs of s.ratingSummaries) {
        synthesisChildren.push(new Paragraph({
          spacing: { after: 60 },
          children: [bodyRun(`${rs.questionText || rs.questionKey}: `, { bold: true }), bodyRun(rs.summary || '')],
        }));
      }
    }
    if (s.overall) {
      synthesisChildren.push(new Paragraph({
        spacing: { before: 160, after: 120 },
        children: [bodyRun('Overall: ', { bold: true }), bodyRun(s.overall)],
      }));
    }
  }

  // --- Ratings table (same rows/columns as the Compare grid) ---
  const ratingsChildren = [];
  if (report.ratingsTable.rows.length > 0) {
    ratingsChildren.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 120 },
      children: [new TextRun({ text: 'Ratings', size: 26, font: FONT, bold: true })],
    }));

    const reviewerCols = report.ratingsTable.reviewers;
    const questionColWidth = 30;
    const perReviewerWidth = reviewerCols.length > 0
      ? Math.floor((100 - questionColWidth) / reviewerCols.length)
      : 0;

    const headRow = new TableRow({
      children: [
        headerCell('Question', questionColWidth),
        ...reviewerCols.map((r) => headerCell(r.name || 'Unnamed reviewer', perReviewerWidth)),
      ],
    });

    const bodyRows = report.ratingsTable.rows.map((row) => new TableRow({
      children: [
        bodyCell(row.retired ? `${row.text} (prior cycle)` : row.text, questionColWidth, { bold: true }),
        ...reviewerCols.map((r) => {
          const cell = row.cells.find((c) => c.suggestionId === r.suggestionId);
          return bodyCell(cell ? cell.label : null, perReviewerWidth);
        }),
      ],
    }));

    ratingsChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headRow, ...bodyRows] }));
  }

  // --- Per-question answer sections (multiselect + richtext, question order) ---
  function runsToTextRuns(runs) {
    // A run's text may contain an embedded "\n" from a <br>; docx needs an
    // explicit line Break between segments rather than a literal newline
    // character.
    const out = [];
    for (const run of runs) {
      const segments = run.text.split('\n');
      segments.forEach((seg, idx) => {
        if (idx > 0) out.push(new TextRun({ break: 1, size: BODY_SIZE, font: FONT }));
        if (seg.length === 0) return;
        out.push(new TextRun({
          text: seg,
          size: BODY_SIZE,
          font: FONT,
          bold: !!run.bold,
          italics: !!run.italic,
          style: run.href ? 'Hyperlink' : undefined,
        }));
      });
    }
    return out.length > 0 ? out : [bodyRun('')];
  }

  function blockToParagraph(block) {
    const common = { spacing: { after: 120 }, children: runsToTextRuns(block.runs) };
    switch (block.type) {
      case 'heading2':
        return new Paragraph({ ...common, heading: HeadingLevel.HEADING_3 });
      case 'heading3':
        return new Paragraph({ ...common, heading: HeadingLevel.HEADING_4 });
      case 'blockquote':
        return new Paragraph({
          spacing: { after: 120 },
          indent: { left: 360 },
          children: runsToTextRuns(block.runs.map((r) => ({ ...r, italic: true }))),
        });
      case 'list-item':
        return new Paragraph({
          ...common,
          bullet: block.ordered ? undefined : { level: 0 },
          numbering: block.ordered ? { reference: 'review-report-numbered', level: 0 } : undefined,
        });
      case 'paragraph':
      default:
        return new Paragraph(common);
    }
  }

  const answerChildren = [];
  for (const section of report.answerSections || []) {
    answerChildren.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 120 },
      children: [
        new TextRun({ text: section.text, size: 26, font: FONT, bold: true }),
        ...(section.retired ? [new TextRun({ text: '  (prior cycle)', size: 20, font: FONT, italics: true, color: '996600' })] : []),
      ],
    }));

    if (section.type === 'multiselect') {
      for (const answer of section.answers) {
        const value = answer.unreadable
          ? 'Unreadable answer'
          : answer.state === 'not-asked'
            ? 'Not asked'
            : answer.labels.length > 0 ? answer.labels.join('; ') : 'No answer provided';
        answerChildren.push(new Paragraph({
          spacing: { after: 80 },
          children: [
            bodyRun(`${answer.reviewerName || 'Unnamed reviewer'}: `, { bold: true }),
            bodyRun(value, answer.unreadable ? { color: '996600' } : {}),
          ],
        }));
      }
      continue;
    }

    for (const answer of section.answers) {
      answerChildren.push(new Paragraph({
        spacing: { before: 120, after: 60 },
        children: [bodyRun(answer.reviewerName || 'Unnamed reviewer', { bold: true })],
      }));
      if (answer.state === 'not-asked') {
        answerChildren.push(new Paragraph({ spacing: { after: 120 }, children: [bodyRun('Not asked', { italics: true, color: '999999' })] }));
      } else if (answer.state === 'empty' || answer.blocks.length === 0) {
        answerChildren.push(new Paragraph({ spacing: { after: 120 }, children: [bodyRun('No answer provided', { italics: true, color: '999999' })] }));
      } else {
        for (const block of answer.blocks) {
          answerChildren.push(blockToParagraph(block));
        }
      }
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { size: BODY_SIZE, font: FONT }, paragraph: { spacing: { after: 120 } } },
      },
    },
    numbering: {
      config: [{
        reference: 'review-report-numbered',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT }],
      }],
    },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: [
        ...headerChildren,
        ...summaryChildren,
        ...synthesisChildren,
        ...ratingsChildren,
        ...answerChildren,
      ],
    }],
  });

  return Packer.toBlob(doc);
}

/**
 * generateSingleReviewCopyDocx — server-side DOCX renderer for the courtesy copy
 * of a SINGLE reviewer's own review, attached to the thank-you email by
 * `lib/services/reviewer-thankyou-sweep.js`.
 *
 * Same `import('docx')` + block/run conventions as `generateReviewReportDocx`
 * above, but:
 *   - consumes the `composeSingleReviewCopy` shape (header + flat sections), and
 *   - returns a Node **Buffer** (Packer.toBuffer) rather than a Blob — the cron
 *     has no browser download; `DynamicsService.addEmailAttachment` takes the
 *     bytes directly.
 *
 * @param {ReturnType<import('./review-report').composeSingleReviewCopy>} copy
 * @returns {Promise<Buffer>}
 */
export async function generateSingleReviewCopyDocx(copy) {
  const {
    Document, Packer, Paragraph, TextRun,
    AlignmentType, HeadingLevel,
  } = await import('docx');

  const FONT = 'Calibri';
  const BODY_SIZE = 22; // 11pt

  function bodyRun(text, opts = {}) {
    return new TextRun({ text, size: BODY_SIZE, font: FONT, ...opts });
  }

  // A run's text may contain an embedded "\n" from a <br>; docx needs an explicit
  // line Break between segments rather than a literal newline character.
  function runsToTextRuns(runs) {
    const out = [];
    for (const run of runs) {
      const segments = run.text.split('\n');
      segments.forEach((seg, idx) => {
        if (idx > 0) out.push(new TextRun({ break: 1, size: BODY_SIZE, font: FONT }));
        if (seg.length === 0) return;
        out.push(new TextRun({
          text: seg,
          size: BODY_SIZE,
          font: FONT,
          bold: !!run.bold,
          italics: !!run.italic,
          style: run.href ? 'Hyperlink' : undefined,
        }));
      });
    }
    return out.length > 0 ? out : [bodyRun('')];
  }

  function blockToParagraph(block) {
    const common = { spacing: { after: 120 }, children: runsToTextRuns(block.runs) };
    switch (block.type) {
      case 'heading2':
        return new Paragraph({ ...common, heading: HeadingLevel.HEADING_3 });
      case 'heading3':
        return new Paragraph({ ...common, heading: HeadingLevel.HEADING_4 });
      case 'blockquote':
        return new Paragraph({
          spacing: { after: 120 },
          indent: { left: 360 },
          children: runsToTextRuns(block.runs.map((r) => ({ ...r, italic: true }))),
        });
      case 'list-item':
        return new Paragraph({
          ...common,
          bullet: block.ordered ? undefined : { level: 0 },
          numbering: block.ordered ? { reference: 'single-review-numbered', level: 0 } : undefined,
        });
      case 'paragraph':
      default:
        return new Paragraph(common);
    }
  }

  const { header } = copy;
  const generatedLabel = (() => {
    const d = new Date(header.generatedAtIso);
    return Number.isNaN(d.getTime()) ? header.generatedAtIso : d.toLocaleString();
  })();

  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({
        text: header.requestTitle || `Request ${header.requestNumber || ''}`.trim() || 'Review',
        size: 32,
        font: FONT,
        bold: true,
      })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        bodyRun(
          [
            header.requestNumber ? `Request ${header.requestNumber}` : null,
            header.reviewerName ? `Reviewer: ${header.reviewerName}` : null,
          ].filter(Boolean).join('  •  '),
          { color: '666666' },
        ),
      ],
    }),
    new Paragraph({
      spacing: { after: 300 },
      children: [bodyRun(`Your submitted review • generated ${generatedLabel}`, { italics: true, color: '888888' })],
    }),
  ];

  for (const section of copy.sections) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 260, after: 100 },
      children: [new TextRun({ text: section.questionText || 'Question', size: 26, font: FONT, bold: true })],
    }));
    if (section.state === 'empty') {
      children.push(new Paragraph({ spacing: { after: 120 }, children: [bodyRun('No answer provided', { italics: true, color: '999999' })] }));
      continue;
    }
    if (section.questionType === 'richtext') {
      for (const block of section.blocks) children.push(blockToParagraph(block));
    } else {
      children.push(new Paragraph({ spacing: { after: 120 }, children: [bodyRun(section.answerLabel)] }));
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { size: BODY_SIZE, font: FONT }, paragraph: { spacing: { after: 120 } } },
      },
    },
    numbering: {
      config: [{
        reference: 'single-review-numbered',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT }],
      }],
    },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}
