/**
 * @jest-environment node
 */

import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { composeReviewReport, composeSingleReviewCopy } from '../../shared/utils/review-report';
import { deriveReviewMatrix } from '../../shared/utils/review-matrix';
import {
  preflightReviewDocxTemplates,
  renderCombinedReviewDocx,
  renderIndividualReviewDocx,
  REVIEW_DOCX_TEMPLATES,
} from '../../lib/services/review-documents/docx-renderer';

const GENERATED_AT = '2026-08-20T18:00:00.000Z';

async function archiveText(buffer, name) {
  const archive = await JSZip.loadAsync(buffer);
  return archive.file(name)?.async('string');
}

function reviewer(suggestionId, name, options, answerValues) {
  return {
    suggestionId,
    name,
    affiliation: `${name} University`,
    answers: [{
      questionKey: 'outcomes',
      questionOrder: 1,
      questionText: 'Which outcomes apply?',
      questionType: 'multiselect',
      answerText: answerValues.map((item) => item.label).join('; '),
      answerValues,
      answerValuesUnreadable: false,
      questionOptions: options,
      questionOptionsUnreadable: false,
    }],
  };
}

describe('template-backed review DOCX renderer', () => {
  test('tracked templates pass marker/section preflight', async () => {
    await expect(preflightReviewDocxTemplates()).resolves.toBeUndefined();
  });

  test('individual render preserves the shell and safely injects full categorical options', async () => {
    const options = [{ value: 1, label: 'First & strongest' }, { value: 2, label: 'Second <later>' }];
    const copy = composeSingleReviewCopy({
      reviewerName: 'Dr. A <Reviewer>',
      reviewerTitleAndOrganization: 'Professor, Example University',
      requestNumber: 'R-101',
      requestTitle: 'A & B',
      institution: 'Example University',
      submittedAt: '2026-08-19T23:30:00.000Z',
      generatedAtIso: GENERATED_AT,
      answers: [
        {
          questionKey: 'rating',
          questionOrder: 1,
          questionText: 'Q1 — Choose one',
          questionType: 'picklist',
          answerText: 'First & strongest',
          answerValue: 1,
          questionOptions: options,
        },
        {
          questionKey: 'comments',
          questionOrder: 2,
          questionText: 'Comments',
          questionType: 'richtext',
          answerHtml: '<p>Line one<br>[[WMKF:BODY]] &amp; line two</p>',
        },
      ],
    });

    const buffer = await renderIndividualReviewDocx(copy);
    const archive = await JSZip.loadAsync(buffer);
    const documentXml = await archive.file('word/document.xml').async('string');
    const coreXml = await archive.file('docProps/core.xml').async('string');
    const rootRelationships = await archive.file('_rels/.rels').async('string');
    expect(archive.file('word/header1.xml')).not.toBeNull();
    expect(archive.file('word/footer1.xml')).not.toBeNull();
    expect(documentXml).toContain('☒  First &amp; strongest');
    expect(documentXml).toContain('☐  Second &lt;later&gt;');
    expect(documentXml).toContain('Choose one');
    expect(documentXml).not.toContain('Q1 — Choose one');
    expect(documentXml).toContain('<w:br/>');
    expect((documentXml.match(/\[\[WMKF:BODY\]\]/g) || [])).toHaveLength(1);
    expect(documentXml).toContain('Dr. A &lt;Reviewer&gt;');
    expect(coreXml).toContain('W. M. Keck Foundation');
    expect(coreXml).not.toMatch(/SAMPLE|Mockup/i);
    expect(Object.keys(archive.files).some((name) => name.startsWith('customXml/'))).toBe(false);
    expect(rootRelationships).not.toContain('custom-properties');
  });

  test('legacy missing option snapshot is labeled honestly and does not invent choices', async () => {
    const copy = composeSingleReviewCopy({
      generatedAtIso: GENERATED_AT,
      answers: [{
        questionText: 'Historical rating',
        questionType: 'picklist',
        answerText: 'Selected answer',
        answerValue: 4,
        questionOptions: null,
        questionOptionsUnreadable: false,
      }],
    });
    const xml = await archiveText(await renderIndividualReviewDocx(copy), 'word/document.xml');
    expect(xml).toContain('historical option list was not captured');
    expect(xml).toContain('☒  Selected answer');
  });

  test('combined comparison uses a reviewer grid through four and vertical attribution above four', async () => {
    const options = [{ value: 1, label: 'Tools' }, { value: 2, label: 'Training' }];
    const four = Array.from({ length: 4 }, (_, index) => reviewer(
      `r${index + 1}`,
      `Reviewer ${index + 1}`,
      options,
      index % 2 === 0 ? [options[0]] : [options[1]],
    ));
    const report4 = composeReviewReport({
      matrix: deriveReviewMatrix(four, null),
      generatedAtIso: GENERATED_AT,
    });
    const buffer4 = await renderCombinedReviewDocx(report4);
    const xml4 = await archiveText(buffer4, 'word/document.xml');
    const header4 = await archiveText(buffer4, 'word/header2.xml');
    expect(header4).toContain('Aggregated Proposal Reviews');
    expect(header4).not.toContain('Combined Proposal Review');
    expect(xml4).toContain('Outcome');
    expect(xml4).toContain('☒');
    expect(xml4).toContain('☐');

    const five = [...four, reviewer('r5', 'Reviewer 5', options, [options[0]])];
    const report5 = composeReviewReport({
      matrix: deriveReviewMatrix(five, null),
      generatedAtIso: GENERATED_AT,
    });
    const xml5 = await archiveText(await renderCombinedReviewDocx(report5), 'word/document.xml');
    expect(xml5).toContain('Selected by');
    expect(xml5).toContain('Reviewer 1, Reviewer 3, Reviewer 5');
  });

  test('template with a missing or duplicated body marker fails closed', async () => {
    const source = await fs.readFile(path.join(process.cwd(), REVIEW_DOCX_TEMPLATES.individual.relativePath));
    const missingZip = await JSZip.loadAsync(source);
    const xml = await missingZip.file('word/document.xml').async('string');
    missingZip.file('word/document.xml', xml.replace('[[WMKF:BODY]]', 'missing'));
    const missing = await missingZip.generateAsync({ type: 'nodebuffer' });
    await expect(renderIndividualReviewDocx({ header: {}, sections: [] }, { templateBuffer: missing }))
      .rejects.toThrow(/expected one/);

    const duplicateZip = await JSZip.loadAsync(source);
    duplicateZip.file('word/document.xml', xml.replace('[[WMKF:BODY]]', '[[WMKF:BODY]][[WMKF:BODY]]'));
    const duplicate = await duplicateZip.generateAsync({ type: 'nodebuffer' });
    await expect(renderIndividualReviewDocx({ header: {}, sections: [] }, { templateBuffer: duplicate }))
      .rejects.toThrow(/found 2/);
  });
});
