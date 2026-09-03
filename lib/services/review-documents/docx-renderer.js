/**
 * Template-backed Word renderers for individual and combined review documents.
 *
 * Each retained DOCX owns the approved header/footer/logo/page geometry and one
 * required [[WMKF:BODY]] marker. This renderer replaces that marker paragraph
 * once with escaped OOXML blocks; inserted reviewer text is never re-scanned as
 * template syntax. The complete option list for categorical questions comes
 * from the submitted answer snapshot, not from the mutable live question set.
 */

import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';

const BODY_MARKER = '[[WMKF:BODY]]';
const GENERATED_MARKER = '[[WMKF:GENERATED]]';
const FONT = 'Times New Roman';
const PAGE_WIDTH = 9360;
const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

export const REVIEW_DOCX_TEMPLATES = Object.freeze({
  individual: Object.freeze({
    id: 'individual-review',
    version: 1,
    relativePath: 'shared/templates/reviews/individual-review-v1.docx',
  }),
  combined: Object.freeze({
    id: 'combined-review',
    version: 1,
    relativePath: 'shared/templates/reviews/combined-review-v1.docx',
  }),
});

const sourceCache = new Map();

function validXmlText(value) {
  return Array.from(String(value ?? '')).filter((character) => {
    const code = character.codePointAt(0);
    return code === 0x9 || code === 0xA || code === 0xD
      || (code >= 0x20 && code <= 0xD7FF)
      || (code >= 0xE000 && code <= 0xFFFD)
      || (code >= 0x10000 && code <= 0x10FFFF);
  }).join('');
}

export function escapeWordXml(value) {
  return validXmlText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function run(text, {
  bold = false,
  italic = false,
  color = '000000',
  size = 22,
  subscript = false,
  superscript = false,
} = {}) {
  const properties = [
    `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}"/>`,
    bold ? '<w:b/>' : '',
    italic ? '<w:i/>' : '',
    color ? `<w:color w:val="${color}"/>` : '',
    `<w:sz w:val="${size}"/>`,
    subscript ? '<w:vertAlign w:val="subscript"/>' : '',
    superscript ? '<w:vertAlign w:val="superscript"/>' : '',
  ].join('');
  const textXml = escapeWordXml(text).replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
  return `<w:r><w:rPr>${properties}</w:rPr><w:t xml:space="preserve">${textXml}</w:t></w:r>`;
}

function paragraph(runs, {
  before = 0,
  after = 120,
  left = 0,
  keepNext = false,
  keepLines = false,
  align = null,
  borderBottom = false,
} = {}) {
  const properties = [
    keepNext ? '<w:keepNext/>' : '',
    keepLines ? '<w:keepLines/>' : '',
    borderBottom ? '<w:pBdr><w:bottom w:val="single" w:sz="3" w:space="3" w:color="D9D9D9"/></w:pBdr>' : '',
    `<w:spacing w:before="${before}" w:after="${after}"/>`,
    left ? `<w:ind w:left="${left}"/>` : '',
    align ? `<w:jc w:val="${align}"/>` : '',
  ].join('');
  return `<w:p><w:pPr>${properties}</w:pPr>${runs.join('')}</w:p>`;
}

function textParagraph(text, runOptions = {}, paragraphOptions = {}) {
  return paragraph([run(text, runOptions)], paragraphOptions);
}

function sectionHeading(text) {
  return textParagraph(text, { bold: true, size: 26 }, { before: 220, after: 100, keepNext: true });
}

function displayQuestionText(text) {
  return String(text || 'Question')
    .replace(/^\s*Q(?:uestion)?\s*\d+\s*(?:[—–:-]\s*)?/i, '')
    .replace(/^\s*\d+\s*[—–:-]\s*/, '')
    .trim() || 'Question';
}

function questionHeading(text, retired = false) {
  return paragraph([
    run(displayQuestionText(text), { bold: true, size: 24 }),
    ...(retired ? [run(' (prior question)', { italic: true, color: '666666', size: 20 })] : []),
  ], { before: 180, after: 70, keepNext: true });
}

function metadataLine(label, value) {
  if (!value) return '';
  return paragraph([run(`${label}: `, { bold: true }), run(value)], { after: 45 });
}

function dateLabel(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function tableCell(content, width, {
  bold = false,
  fill = null,
  align = 'left',
  color = '000000',
  size = 20,
} = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>`
    + (fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '')
    + '<w:tcMar><w:top w:w="90" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tcMar>'
    + '<w:vAlign w:val="center"/>'
    + '</w:tcPr>'
    + paragraph([run(content ?? '', { bold, color, size })], { after: 0, align })
    + '</w:tc>';
}

function table(headers, rows, widths, { centerColumns = [] } = {}) {
  if (widths.reduce((sum, value) => sum + value, 0) !== PAGE_WIDTH) {
    throw new Error('Review DOCX table widths must total the 9360 DXA content width.');
  }
  const borders = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="B7B7B7"/><w:left w:val="single" w:sz="4" w:color="B7B7B7"/><w:bottom w:val="single" w:sz="4" w:color="B7B7B7"/><w:right w:val="single" w:sz="4" w:color="B7B7B7"/><w:insideH w:val="single" w:sz="3" w:color="D9D9D9"/><w:insideV w:val="single" w:sz="3" w:color="D9D9D9"/></w:tblBorders>';
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((value, index) => tableCell(value, widths[index], {
    bold: true,
    fill: 'EDEDED',
    align: centerColumns.includes(index) ? 'center' : 'left',
  })).join('')}</w:tr>`;
  const body = rows.map((row) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${row.map((value, index) => tableCell(value, widths[index], {
    align: centerColumns.includes(index) ? 'center' : 'left',
  })).join('')}</w:tr>`).join('');
  return '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/>'
    + borders + '<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>' + header + body + '</w:tbl>';
}

function blockParagraph(block, { after = 110, orderedIndex = null } = {}) {
  const heading = block?.type === 'heading2' || block?.type === 'heading3';
  const renderedRuns = [];
  if (block?.type === 'list-item') {
    renderedRuns.push(run(block.ordered ? `${orderedIndex ?? 1}.  ` : '•  '));
  }
  for (const item of Array.isArray(block?.runs) ? block.runs : []) {
    renderedRuns.push(run(item.text || '', {
      bold: item.bold === true || heading,
      italic: item.italic === true || block.type === 'blockquote',
      subscript: item.subscript === true,
      superscript: item.superscript === true,
    }));
    if (item.href && item.href !== item.text) {
      renderedRuns.push(run(` (${item.href})`, { color: '666666' }));
    }
  }
  if (renderedRuns.length === 0) renderedRuns.push(run(''));
  if (heading) {
    return paragraph(renderedRuns, {
      before: 80,
      after: 60,
      keepNext: true,
    });
  }
  if (block?.type === 'blockquote') return paragraph(renderedRuns, { left: 360, after });
  if (block?.type === 'list-item') return paragraph(renderedRuns, {
    left: 360,
    after: 60,
  });
  return paragraph(renderedRuns, { after, keepLines: true });
}

function richTextParagraphs(blocks, { after = 110 } = {}) {
  const paragraphs = [];
  let orderedIndex = 0;
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (block?.type === 'list-item' && block.ordered) {
      orderedIndex += 1;
    } else {
      orderedIndex = 0;
    }
    paragraphs.push(blockParagraph(block, {
      after,
      orderedIndex: block?.ordered ? orderedIndex : null,
    }));
  }
  return paragraphs;
}

function categoricalOptions(section) {
  const options = Array.isArray(section.questionOptions) ? section.questionOptions : null;
  const selected = section.questionType === 'multiselect'
    ? (Array.isArray(section.answerValues) ? section.answerValues : [])
    : (Number.isFinite(section.answerValue) && section.answerLabel
      ? [{ value: section.answerValue, label: section.answerLabel }]
      : []);
  const selectedKeys = new Set(selected.map((item) => `${item.value}\u0000${item.label}`));
  const lines = [];
  if (options) {
    for (const option of options) {
      const checked = selectedKeys.has(`${option.value}\u0000${option.label}`);
      lines.push(textParagraph(`${checked ? '☒' : '☐'}  ${option.label}`, {}, { left: 461, after: 80 }));
    }
  } else {
    lines.push(textParagraph(
      section.questionOptionsUnreadable
        ? 'The historical option list could not be read; selected responses are shown below.'
        : 'The historical option list was not captured for this review; selected responses are shown below.',
      { italic: true, color: '666666', size: 19 },
      { after: 70 },
    ));
    if (selected.length === 0 && section.answerLabel) {
      lines.push(textParagraph(`☒  ${section.answerLabel}`, {}, { left: 461, after: 80 }));
    } else {
      for (const option of selected) lines.push(textParagraph(`☒  ${option.label}`, {}, { left: 461, after: 80 }));
    }
  }
  return lines.join('');
}

function individualBody(copy) {
  const header = copy?.header || {};
  const children = [
    metadataLine('Applicant Institution', header.institution),
    metadataLine('Project Title', header.requestTitle),
    metadataLine('Request Number', header.requestNumber),
    textParagraph('', {}, { after: 80 }),
    metadataLine('Reviewer Name', header.reviewerName),
    metadataLine('Title & Organization', header.reviewerTitleAndOrganization),
    metadataLine('Submitted', dateLabel(header.submittedAt)),
    textParagraph('', {}, { after: 80 }),
  ];
  for (const section of Array.isArray(copy?.sections) ? copy.sections : []) {
    children.push(questionHeading(section.questionText));
    if (section.state === 'empty') {
      children.push(textParagraph('No answer provided', { italic: true, color: '777777' }, { after: 150 }));
    } else if (section.questionType === 'richtext') {
      children.push(...richTextParagraphs(section.blocks, { after: 150 }));
    } else if (section.questionType === 'picklist' || section.questionType === 'multiselect') {
      if (section.answerValuesUnreadable) {
        children.push(textParagraph('The submitted answer could not be read.', { italic: true, color: '9C0006' }, { after: 120 }));
      } else {
        children.push(categoricalOptions(section));
      }
    } else {
      children.push(textParagraph(section.answerLabel || 'No answer provided', {}, { after: 150 }));
    }
  }
  return children.join('');
}

function reviewerIdentity(reviewer) {
  return [reviewer?.name || 'Unnamed reviewer', reviewer?.affiliation || null].filter(Boolean).join(' — ');
}

function synthesisBody(synthesis) {
  if (!synthesis) return '';
  const children = [sectionHeading(synthesis.current === false ? 'AI Synthesis (stale)' : 'AI Synthesis')];
  if (synthesis.current === false) {
    children.push(textParagraph(
      'The reviewer roster and answers reflect current submissions; this synthesis may reflect an earlier reviewer set.',
      { italic: true, color: '996600', size: 20 },
      { after: 90 },
    ));
  }
  const groups = [
    ['Consensus', synthesis.consensus],
    ['Disagreements', synthesis.disagreements],
    ['Key concerns', synthesis.keyConcerns],
  ];
  for (const [label, items] of groups) {
    if (!Array.isArray(items) || items.length === 0) continue;
    children.push(textParagraph(label, { bold: true }, { before: 80, after: 30, keepNext: true }));
    for (const item of items) children.push(paragraph([run('•  '), run(item)], { left: 360, after: 50 }));
  }
  if (synthesis.overall) children.push(paragraph([run('Overall: ', { bold: true }), run(synthesis.overall)], { before: 80, after: 120 }));
  return children.join('');
}

function shortReviewerLabels(reviewers) {
  const base = reviewers.map((reviewer) => {
    const parts = String(reviewer.name || 'Reviewer').trim().split(/\s+/);
    return parts[parts.length - 1] || 'Reviewer';
  });
  return base.map((label, index) => {
    if (base.filter((candidate) => candidate === label).length === 1) return label;
    const name = String(reviewers[index].name || '').trim();
    const first = name.split(/\s+/)[0] || '';
    const withInitial = `${first.charAt(0)}. ${label}`.trim();
    return base.map((candidate, candidateIndex) => candidate === label
      ? `${String(reviewers[candidateIndex].name || '').trim().split(/\s+/)[0]?.charAt(0) || ''}. ${label}`.trim()
      : candidate).filter((candidate) => candidate === withInitial).length === 1
      ? withInitial
      : (name || `Reviewer ${index + 1}`);
  });
}

function selectedPair(answer, option) {
  return Array.isArray(answer?.values)
    && answer.values.some((value) => value.value === option.value && value.label === option.label);
}

function offeredPair(answer, option) {
  return Array.isArray(answer?.options)
    && answer.options.some((value) => value.value === option.value && value.label === option.label);
}

function optionSnapshotNotice(section) {
  const askedAnswers = (section.answers || []).filter((answer) => answer.state !== 'not-asked');
  const missing = askedAnswers.filter((answer) => !Array.isArray(answer.options) && !answer.optionsUnreadable);
  const unreadable = askedAnswers.filter((answer) => answer.optionsUnreadable);
  if (missing.length === 0 && unreadable.length === 0) return '';
  const names = (answers) => answers.map((answer) => answer.reviewerName || 'Unnamed reviewer').join(', ');
  const details = [];
  if (missing.length > 0) details.push(`historical options were not captured for ${names(missing)}`);
  if (unreadable.length > 0) details.push(`historical options could not be read for ${names(unreadable)}`);
  const consequence = section.type === 'multiselect'
    ? 'Unknown cells are labeled explicitly.'
    : 'Submitted selections remain shown, but unselected historical choices may be unavailable.';
  return textParagraph(
    `Option history is incomplete: ${details.join('; ')}. ${consequence}`,
    { italic: true, color: '996600', size: 19 },
    { after: 80, keepNext: true },
  );
}

function categoricalCell(answer, option) {
  if (selectedPair(answer, option)) return '☒';
  if (!answer || answer.state === 'not-asked') return '—';
  if (answer.optionsUnreadable) return 'Unreadable';
  if (!Array.isArray(answer.options)) return 'Unknown';
  if (offeredPair(answer, option)) return '☐';
  return '—';
}

function multiselectComparison(section, reviewers) {
  const options = Array.isArray(section.optionCatalog) ? section.optionCatalog : [];
  if (options.length === 0) {
    return textParagraph('No categorical responses were available.', { italic: true, color: '777777' }, { after: 100 });
  }
  const labels = shortReviewerLabels(reviewers);
  const lines = [];
  for (const option of options) {
    lines.push(textParagraph(option.label, { bold: true, size: 20 }, { before: 45, after: 25, keepNext: true }));
    if (reviewers.length <= 4) {
      let count = 0;
      const statusRuns = [];
      reviewers.forEach((reviewer, index) => {
        const answer = section.answers.find((candidate) => candidate.suggestionId === reviewer.suggestionId);
        if (selectedPair(answer, option)) count += 1;
        if (index > 0) statusRuns.push(run('  |  ', { color: '777777', size: 19 }));
        statusRuns.push(run(`${labels[index]}: `, { bold: true, size: 19 }));
        statusRuns.push(run(categoricalCell(answer, option), { size: 19 }));
      });
      statusRuns.push(run(`  |  Total: ${count}`, { bold: true, size: 19 }));
      lines.push(paragraph(statusRuns, { after: 70, borderBottom: true }));
    } else {
      const names = [];
      for (const reviewer of reviewers) {
        const answer = section.answers.find((candidate) => candidate.suggestionId === reviewer.suggestionId);
        if (selectedPair(answer, option)) names.push(reviewer.name || 'Unnamed reviewer');
      }
      lines.push(paragraph([
        run(`Total: ${names.length}; `, { bold: true, size: 19 }),
        run(`Selected by: ${names.join(', ') || 'None'}`, { size: 19 }),
      ], { after: 70, borderBottom: true }));
    }
  }
  return lines.join('');
}

function combinedBody(report) {
  const header = report?.header || {};
  const reviewers = Array.isArray(report?.reviewers) ? report.reviewers : [];
  const children = [
    metadataLine('Applicant Institution', header.institution),
    metadataLine('Project Title', header.requestTitle),
    metadataLine('Request Number', header.requestNumber),
    metadataLine('Principal Investigator', header.piName),
    metadataLine('Reviews Submitted', String(header.reviewerCount ?? reviewers.length)),
    sectionHeading('Reviewers'),
    table(
      ['Name', 'Affiliation'],
      reviewers.map((reviewer) => [reviewer.name || 'Unnamed reviewer', reviewer.affiliation || 'Not reported']),
      [4000, 5360],
    ),
    sectionHeading('Rating Summary'),
  ];
  const ratings = Array.isArray(report?.summary?.ratingQuestions) ? report.summary.ratingQuestions : [];
  if (ratings.length > 0) {
    children.push(table(
      ['Question', 'Average', 'Range', 'Answered'],
      ratings.map((item) => [
        item.retired ? `${displayQuestionText(item.text)} (prior question)` : displayQuestionText(item.text),
        item.average == null ? '—' : String(item.average),
        item.min == null || item.max == null ? '—' : `${item.min}–${item.max}`,
        `${item.answeredCount}/${item.totalReviewers}`,
      ]),
      [5100, 1300, 1300, 1660],
      { centerColumns: [1, 2, 3] },
    ));
  } else {
    children.push(textParagraph('No rating responses were available.', { italic: true, color: '777777' }));
  }
  children.push(synthesisBody(report?.synthesisSection));
  children.push(sectionHeading('Reviewer Responses'));

  for (const section of Array.isArray(report?.answerSections) ? report.answerSections : []) {
    children.push(questionHeading(section.text, section.retired));
    if (section.type === 'multiselect') {
      children.push(optionSnapshotNotice(section));
      children.push(multiselectComparison(section, reviewers));
    } else if (section.type === 'picklist') {
      children.push(optionSnapshotNotice(section));
      for (const answer of section.answers || []) {
        const selection = answer.state === 'answered' ? (answer.label || '—')
          : answer.state === 'not-asked' ? 'Not asked' : 'No answer provided';
        children.push(paragraph([
          run(`${answer.reviewerName || 'Unnamed reviewer'}: `, { bold: true, size: 21 }),
          run(selection, { size: 21 }),
        ], { after: 55, borderBottom: true }));
      }
      const summary = ratings.find((item) => item.key === section.key);
      if (summary) {
        children.push(textParagraph(
          `Summary: average ${summary.average ?? '—'}; range ${summary.min ?? '—'}–${summary.max ?? '—'}; answered ${summary.answeredCount}/${summary.totalReviewers}`,
          { italic: true, color: '555555', size: 20 },
          { before: 50, after: 100 },
        ));
      }
    } else if (section.type === 'string') {
      for (const answer of section.answers || []) {
        const reviewer = reviewers.find((item) => item.suggestionId === answer.suggestionId);
        children.push(textParagraph(reviewerIdentity(reviewer || { name: answer.reviewerName }), { bold: true, size: 21 }, { before: 70, after: 35, keepNext: true }));
        children.push(textParagraph(
          answer.state === 'answered' ? (answer.label || 'No answer provided')
            : answer.state === 'not-asked' ? 'Not asked' : 'No answer provided',
          answer.state === 'answered' ? {} : { italic: true, color: '777777', size: 20 },
          { after: 130, borderBottom: true },
        ));
      }
    } else {
      for (const answer of section.answers || []) {
        const reviewer = reviewers.find((item) => item.suggestionId === answer.suggestionId);
        children.push(textParagraph(reviewerIdentity(reviewer || { name: answer.reviewerName }), { bold: true, size: 21 }, { before: 70, after: 35, keepNext: true }));
        if (answer.state === 'answered' && Array.isArray(answer.blocks)) {
          children.push(...richTextParagraphs(answer.blocks, { after: 130 }));
        } else {
          children.push(textParagraph(
            answer.state === 'not-asked' ? 'Not asked' : 'No answer provided',
            { italic: true, color: '777777', size: 20 },
            { after: 130, borderBottom: true },
          ));
        }
      }
    }
  }
  return children.join('');
}

function templatePath(kind) {
  if (kind === 'individual') {
    return path.join(process.cwd(), 'shared', 'templates', 'reviews', 'individual-review-v1.docx');
  }
  if (kind === 'combined') {
    return path.join(process.cwd(), 'shared', 'templates', 'reviews', 'combined-review-v1.docx');
  }
  throw new Error(`Unknown review DOCX template kind: ${kind}`);
}

async function loadTemplate(kind, templateBuffer = null) {
  const template = REVIEW_DOCX_TEMPLATES[kind];
  if (!template) throw new Error(`Unknown review DOCX template kind: ${kind}`);
  let source = templateBuffer;
  if (!source) {
    if (!sourceCache.has(kind)) {
      const readPromise = fs.readFile(templatePath(kind)).catch((error) => {
        sourceCache.delete(kind);
        throw error;
      });
      sourceCache.set(kind, readPromise);
    }
    source = await sourceCache.get(kind);
  }
  const zip = await JSZip.loadAsync(source);
  const documentPart = zip.file('word/document.xml');
  if (!documentPart) throw new Error(`Review DOCX template ${template.id} is missing word/document.xml.`);
  const documentXml = await documentPart.async('string');
  const markerCount = (documentXml.match(/\[\[WMKF:BODY\]\]/g) || []).length;
  if (markerCount !== 1) {
    throw new Error(`Review DOCX template ${template.id} expected one ${BODY_MARKER} marker; found ${markerCount}.`);
  }
  if (!/<w:sectPr\b[\s\S]*?<\/w:sectPr>/.test(documentXml)) {
    throw new Error(`Review DOCX template ${template.id} is missing section properties.`);
  }
  const footerPart = zip.file('word/footer2.xml');
  if (!footerPart) throw new Error(`Review DOCX template ${template.id} is missing word/footer2.xml.`);
  const footerXml = await footerPart.async('string');
  const generatedMarkerCount = (footerXml.match(/\[\[WMKF:GENERATED\]\]/g) || []).length;
  if (generatedMarkerCount !== 1) {
    throw new Error(`Review DOCX template ${template.id} expected one ${GENERATED_MARKER} marker; found ${generatedMarkerCount}.`);
  }
  return { zip, documentXml, footerXml, template };
}

function outputAppXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
    + '<Template>Normal.dotm</Template><TotalTime>0</TotalTime><Application>Microsoft Office Word</Application><DocSecurity>0</DocSecurity>'
    + '<ScaleCrop>false</ScaleCrop><Company>W. M. Keck Foundation</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion>'
    + '</Properties>';
}

function outputCoreXml(template, titleText, generatedAtIso) {
  const date = new Date(generatedAtIso || Date.now());
  const iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${escapeWordXml(titleText)}</dc:title>`
    + '<dc:creator>W. M. Keck Foundation</dc:creator><cp:lastModifiedBy>W. M. Keck Foundation</cp:lastModifiedBy><cp:revision>1</cp:revision>'
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>`
    + `<dc:description>Generated from the ${escapeWordXml(template.id)} version ${template.version} template.</dc:description>`
    + '</cp:coreProperties>';
}

async function render(kind, payload, bodyXml, { templateBuffer = null } = {}) {
  const { zip, documentXml, footerXml, template } = await loadTemplate(kind, templateBuffer);
  const markerParagraphPattern = /<w:p(?=[ >])(?:(?!<\/w:p>)[\s\S])*?\[\[WMKF:BODY\]\](?:(?!<\/w:p>)[\s\S])*?<\/w:p>/;
  if (!markerParagraphPattern.test(documentXml)) {
    throw new Error(`Review DOCX template ${template.id} marker is not contained in one paragraph.`);
  }
  zip.file('word/document.xml', documentXml.replace(markerParagraphPattern, bodyXml));
  const generatedAt = payload?.header?.generatedAtIso || new Date().toISOString();
  zip.file('word/footer2.xml', footerXml.replace(GENERATED_MARKER, `Generated ${escapeWordXml(dateLabel(generatedAt))}`));
  const requestNumber = payload?.header?.requestNumber || '';
  zip.file('docProps/core.xml', outputCoreXml(
    template,
    kind === 'individual' ? `Proposal Review ${requestNumber}`.trim() : `Aggregated Proposal Reviews ${requestNumber}`.trim(),
    generatedAt,
  ));
  zip.file('docProps/app.xml', outputAppXml());
  const output = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  const check = await JSZip.loadAsync(output);
  if (!check.file('word/header1.xml') || !check.file('word/footer1.xml')) {
    throw new Error(`Rendered ${template.id} document lost its required header or footer.`);
  }
  const renderedFooterXml = await check.file('word/footer2.xml').async('string');
  if (renderedFooterXml.includes(GENERATED_MARKER)) {
    throw new Error(`Rendered ${template.id} document retained an unresolved generated-date marker.`);
  }
  return output;
}

export async function preflightReviewDocxTemplates(kinds = Object.keys(REVIEW_DOCX_TEMPLATES)) {
  await Promise.all(kinds.map((kind) => loadTemplate(kind)));
}

export async function renderIndividualReviewDocx(copy, options = {}) {
  return render('individual', copy, individualBody(copy), options);
}

export async function renderCombinedReviewDocx(report, options = {}) {
  return render('combined', report, combinedBody(report), options);
}
