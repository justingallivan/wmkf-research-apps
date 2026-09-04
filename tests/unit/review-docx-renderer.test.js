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
    expect(REVIEW_DOCX_TEMPLATES.individual).toMatchObject({ version: 4, relativePath: 'shared/templates/reviews/individual-review-v4.docx' });
    expect(REVIEW_DOCX_TEMPLATES.combined).toMatchObject({ version: 4, relativePath: 'shared/templates/reviews/combined-review-v4.docx' });
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
    const appXml = await archive.file('docProps/app.xml').async('string');
    const generatedFooter = await archive.file('word/footer2.xml').async('string');
    const rootRelationships = await archive.file('_rels/.rels').async('string');
    const firstPageHeader = await archive.file('word/header2.xml').async('string');
    const continuationHeader = await archive.file('word/header1.xml').async('string');
    expect(archive.file('word/header1.xml')).not.toBeNull();
    expect(archive.file('word/footer1.xml')).not.toBeNull();
    expect(firstPageHeader).toContain('Proposal Review');
    expect(firstPageHeader).toContain('Research Program');
    expect(firstPageHeader).toContain('W.M. KECK');
    expect(firstPageHeader).toContain('FOUNDATION');
    expect(firstPageHeader).toContain('<w:tblW w:w="9360" w:type="dxa"/>');
    expect(firstPageHeader).toContain('<w:gridCol w:w="3888"/>');
    expect(firstPageHeader).toContain('<w:gridCol w:w="5472"/>');
    expect(firstPageHeader).toContain('<w:jc w:val="right"/>');
    expect(firstPageHeader).not.toContain('<w:tab');
    expect(firstPageHeader).not.toContain('<w:drawing');
    expect(firstPageHeader).not.toContain('<wp:anchor');
    expect(firstPageHeader).not.toContain('<wp:inline');
    expect(archive.file('word/_rels/header2.xml.rels')).toBeNull();
    expect(archive.file('word/media/image2.png')).toBeNull();
    expect(archive.file('word/media/image3.svg')).toBeNull();
    expect(continuationHeader).toContain('Proposal Review');
    expect(`${firstPageHeader}${continuationHeader}`).not.toContain('Individual');
    expect(documentXml).not.toContain('EXTERNAL REVIEW');
    expect(documentXml).toMatch(/<w:spacing w:before="0" w:after="0"\/>[\s\S]*?Applicant Institution/);
    expect(documentXml).toContain('☒  First &amp; strongest');
    expect(documentXml).toContain('☐  Second &lt;later&gt;');
    expect(documentXml).toContain('Choose one');
    expect(documentXml).not.toContain('Q1 — Choose one');
    expect(documentXml).toContain('<w:br/>');
    expect((documentXml.match(/\[\[WMKF:BODY\]\]/g) || [])).toHaveLength(1);
    expect(documentXml).toContain('Dr. A &lt;Reviewer&gt;');
    expect(coreXml).toContain('W. M. Keck Foundation');
    expect(coreXml).toContain('Proposal Review R-101');
    expect(coreXml).toContain('individual-review version 4 template');
    expect(coreXml).not.toContain('Individual');
    expect(coreXml).not.toMatch(/SAMPLE|Mockup/i);
    expect(generatedFooter).toContain('Generated August 20, 2026');
    expect(generatedFooter).not.toContain('[[WMKF:GENERATED]]');
    expect(appXml).toContain('<DocSecurity>0</DocSecurity>');
    expect(appXml).not.toMatch(/<(Pages|Words|Characters|Lines|Paragraphs)>/);
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

  test('empty multiselect snapshots render every option unchecked', async () => {
    const copy = composeSingleReviewCopy({
      generatedAtIso: GENERATED_AT,
      answers: [{
        questionText: 'Applicable outcomes',
        questionType: 'multiselect',
        answerValues: [],
        questionOptions: [{ value: 1, label: 'Tools' }, { value: 2, label: 'Training' }],
      }],
    });
    expect(copy.sections[0].state).toBe('answered');
    const xml = await archiveText(await renderIndividualReviewDocx(copy), 'word/document.xml');
    expect(xml).toContain('☐  Tools');
    expect(xml).toContain('☐  Training');
    expect(xml).not.toContain('No answer provided');
  });

  test('question cleanup preserves digit-leading words and strips only question numbering', async () => {
    const copy = composeSingleReviewCopy({
      generatedAtIso: GENERATED_AT,
      answers: [
        { questionText: '3D methods and expected impact', questionType: 'string', answerText: 'Strong' },
        { questionText: 'Question 12: Feasibility', questionType: 'string', answerText: 'High' },
      ],
    });
    const xml = await archiveText(await renderIndividualReviewDocx(copy), 'word/document.xml');
    expect(xml).toContain('3D methods and expected impact');
    expect(xml).toContain('Feasibility');
    expect(xml).not.toContain('Question 12: Feasibility');
  });

  test('separate ordered lists restart at one with stable literal numbering', async () => {
    const copy = composeSingleReviewCopy({
      generatedAtIso: GENERATED_AT,
      answers: [
        { questionText: 'First list', questionType: 'richtext', answerHtml: '<ol><li>Alpha</li><li>Beta</li></ol>' },
        { questionText: 'Second list', questionType: 'richtext', answerHtml: '<ol><li>Gamma</li><li>Delta</li></ol>' },
      ],
    });
    const buffer = await renderIndividualReviewDocx(copy);
    const documentXml = await archiveText(buffer, 'word/document.xml');
    expect(documentXml.match(/>1\.  <\/w:t>/g)).toHaveLength(2);
    expect(documentXml.match(/>2\.  <\/w:t>/g)).toHaveLength(2);
    expect(documentXml).not.toContain('<w:numId w:val="37"/>');
  });

  test('combined output labels incomplete option history and retains string answers', async () => {
    const report = composeReviewReport({
      matrix: deriveReviewMatrix([
        {
          suggestionId: 'legacy', name: 'Legacy Reviewer', answers: [
            { questionKey: 'outcomes', questionOrder: 1, questionText: 'Outcomes', questionType: 'multiselect', answerValues: [{ value: 2, label: 'Training' }], questionOptions: null },
            { questionKey: 'identifier', questionOrder: 2, questionText: '3D identifier', questionType: 'string', answerText: 'ID-17' },
          ],
        },
        {
          suggestionId: 'corrupt', name: 'Corrupt Reviewer', answers: [
            { questionKey: 'outcomes', questionOrder: 1, questionText: 'Outcomes', questionType: 'multiselect', answerValuesUnreadable: true, questionOptionsUnreadable: true },
            { questionKey: 'identifier', questionOrder: 2, questionText: '3D identifier', questionType: 'string', answerText: 'ID-22' },
          ],
        },
      ], null),
      requestNumber: 'R-202',
      institution: 'Example Institute',
      generatedAtIso: GENERATED_AT,
      synthesis: { consensus: ['Shared strength'], disagreements: [], keyConcerns: [], overall: '' },
    });
    const buffer = await renderCombinedReviewDocx(report);
    const xml = await archiveText(buffer, 'word/document.xml');
    const header = await archiveText(buffer, 'word/header1.xml');
    const core = await archiveText(buffer, 'docProps/core.xml');
    expect(xml).toContain('Option history is incomplete');
    expect(xml).toMatch(/<w:spacing w:before="0" w:after="0"\/>[\s\S]*?Applicant Institution/);
    expect(xml).toContain('Unknown');
    expect(xml).toContain('Unreadable');
    expect(xml).toContain('3D identifier');
    expect(xml).toContain('ID-17');
    expect(xml).toContain('ID-22');
    expect(xml).toContain('•  ');
    expect(xml).toContain('Shared strength');
    expect(xml).not.toContain('COMBINED EXTERNAL REVIEWS');
    expect(header).toContain('Aggregated Proposal Reviews');
    expect(core).toContain('Aggregated Proposal Reviews R-202');
  });

  test('invalid XML control characters are removed from generated content', async () => {
    const copy = composeSingleReviewCopy({
      generatedAtIso: GENERATED_AT,
      reviewerName: 'A\u0000B\u0008C',
      answers: [{ questionText: 'Comments', questionType: 'string', answerText: 'D\u0001E' }],
    });
    const xml = await archiveText(await renderIndividualReviewDocx(copy), 'word/document.xml');
    expect(xml).toContain('ABC');
    expect(xml).toContain('DE');
    expect(xml).not.toMatch(/[\u0000\u0001\u0008]/);
  });

  test('combined comparison uses compact checkbox attribution through four and named attribution above four', async () => {
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
    const archive4 = await JSZip.loadAsync(buffer4);
    const xml4 = await archive4.file('word/document.xml').async('string');
    const header4 = await archive4.file('word/header2.xml').async('string');
    expect(header4).toContain('Aggregated Proposal Reviews');
    expect(header4).toContain('W.M. KECK');
    expect(header4).toContain('FOUNDATION');
    expect(header4).toContain('<w:tblW w:w="9360" w:type="dxa"/>');
    expect(header4).toContain('<w:jc w:val="right"/>');
    expect(header4).not.toContain('<w:tab');
    expect(header4).not.toContain('<w:drawing');
    expect(header4).not.toContain('<wp:anchor');
    expect(header4).not.toContain('<wp:inline');
    expect(archive4.file('word/_rels/header2.xml.rels')).toBeNull();
    expect(archive4.file('word/media/image2.png')).toBeNull();
    expect(archive4.file('word/media/image3.svg')).toBeNull();
    expect(header4).not.toContain('Combined Proposal Review');
    expect(xml4).toContain('Tools');
    expect(xml4).toContain('1: ');
    expect(xml4).toContain('Total: 2');
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
