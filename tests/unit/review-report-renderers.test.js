/**
 * @jest-environment node
 */

import {
  TextDecoder as NodeTextDecoder,
  TextEncoder as NodeTextEncoder,
} from 'util';
import JSZip from 'jszip';
import { composeReviewReport, composeSingleReviewCopy } from '../../shared/utils/review-report';
import { generateReviewReportDocx, generateSingleReviewCopyDocx } from '../../shared/utils/review-report-docx';
import { generateReviewReportPdf } from '../../shared/utils/review-report-pdf';
import { PDFReportBuilder } from '../../shared/utils/pdf-export';

global.TextEncoder = global.TextEncoder || NodeTextEncoder;
global.TextDecoder = global.TextDecoder || NodeTextDecoder;

afterEach(() => jest.restoreAllMocks());

function categoricalReport() {
  return composeReviewReport({
    requestNumber: 'R-100',
    requestTitle: 'Renderer smoke',
    generatedAtIso: '2026-07-26T12:00:00.000Z',
    synthesis: { overall: 'Earlier synthesis.' },
    synthesisCurrent: false,
    matrix: {
      reviewers: [
        { suggestionId: 'suggestion-1', name: 'Reviewer One', affiliation: 'Florida International University' },
        { suggestionId: 'suggestion-2', name: 'Reviewer Two', affiliation: null },
      ],
      questions: [{
        key: 'impactAreas',
        type: 'multiselect',
        text: 'Q3 — Check all that apply',
        retired: false,
        cells: [
          {
            suggestionId: 'suggestion-1',
            state: 'answered',
            answerValues: [
              { value: 1, label: 'Provide enabling tools to the community' },
              { value: 4, label: 'Revise textbooks' },
            ],
            answerValuesUnreadable: false,
          },
          {
            suggestionId: 'suggestion-2',
            state: 'unreadable',
            answerValues: null,
            answerValuesUnreadable: true,
          },
        ],
        tallies: [],
      }],
    },
  });
}

describe('review report categorical renderers', () => {
  test('DOCX renderer accepts readable and unreadable multiselect answers', async () => {
    const blob = await generateReviewReportDocx(categoricalReport());
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  test('DOCX renderer preserves reviewer subscript and superscript runs', async () => {
    const report = composeReviewReport({
      requestNumber: 'R-101',
      generatedAtIso: '2026-08-13T12:00:00.000Z',
      matrix: {
        reviewers: [{ suggestionId: 'suggestion-1', name: 'Reviewer One', affiliation: null }],
        questions: [{
          key: 'comments',
          type: 'richtext',
          text: 'Comments',
          retired: false,
          cells: [{
            suggestionId: 'suggestion-1',
            state: 'answered',
            answerHtml: '<p>H<sub>2</sub>O and x<sup>2</sup></p>',
          }],
        }],
      },
    });

    const blob = await generateReviewReportDocx(report);
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await archive.file('word/document.xml').async('string');
    expect(documentXml).toContain('<w:vertAlign w:val="subscript"/>');
    expect(documentXml).toContain('<w:vertAlign w:val="superscript"/>');
  });

  test('courtesy-copy DOCX preserves reviewer subscript and superscript runs', async () => {
    const copy = composeSingleReviewCopy({
      reviewerName: 'Reviewer One',
      requestNumber: 'R-102',
      generatedAtIso: '2026-08-13T12:00:00.000Z',
      answers: [{
        questionText: 'Comments',
        questionType: 'richtext',
        answerHtml: '<p>H<sub>2</sub>O and x<sup>2</sup></p>',
      }],
    });

    const buffer = await generateSingleReviewCopyDocx(copy);
    const archive = await JSZip.loadAsync(buffer);
    const documentXml = await archive.file('word/document.xml').async('string');
    expect(documentXml).toContain('<w:vertAlign w:val="subscript"/>');
    expect(documentXml).toContain('<w:vertAlign w:val="superscript"/>');
  });

  test('DOCX "Reviews (writeup)" section underlines the reviewer name run and NOT institution text or model strings (Slice 3)', async () => {
    const report = composeReviewReport({
      requestNumber: 'R-103',
      generatedAtIso: '2026-09-14T12:00:00.000Z',
      matrix: { reviewers: [], questions: [] },
      synthesis: {
        writeupThemes: 'Reviewers were broadly enthusiastic and consistent.',
        writeupQuotations: [{ questionKey: 'q1', quote: 'This work is genuinely excellent and rigorous.' }],
      },
      fullReviewers: [{
        suggestionId: 'suggestion-1',
        name: 'Dr. Underlined Name',
        reviewReceivedAt: '2026-09-01T00:00:00Z',
        reviewerOverallAssessment: 5,
        mainInstitution: 'Plain Institution Text University',
        answers: [{ questionKey: 'q1', answerText: 'This work is genuinely excellent and rigorous.' }],
      }],
    });
    expect(report.writeupSection).not.toBeNull();

    const blob = await generateReviewReportDocx(report);
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await archive.file('word/document.xml').async('string');

    expect(documentXml).toContain('Reviews (writeup)');
    expect(documentXml).toContain('Reviewers were broadly enthusiastic and consistent.');
    expect(documentXml).toContain('This work is genuinely excellent and rigorous.');

    // Isolate each <w:r>...</w:r> run and assert underline placement by
    // content rather than by proximity — a name run has <w:u .../> AND
    // contains the reviewer's name; no other run (institution, theme,
    // quotation) does.
    const runMatches = [...documentXml.matchAll(/<w:r>.*?<\/w:r>/gs)];
    expect(runMatches.length).toBeGreaterThan(0);
    const nameRuns = runMatches.filter((m) => m[0].includes('Dr. Underlined Name'));
    const institutionRuns = runMatches.filter((m) => m[0].includes('Plain Institution Text University'));
    const themeRuns = runMatches.filter((m) => m[0].includes('Reviewers were broadly enthusiastic'));
    const quoteRuns = runMatches.filter((m) => m[0].includes('This work is genuinely excellent'));

    expect(nameRuns.length).toBeGreaterThan(0);
    expect(institutionRuns.length).toBeGreaterThan(0);
    expect(themeRuns.length).toBeGreaterThan(0);
    expect(quoteRuns.length).toBeGreaterThan(0);

    for (const run of nameRuns) expect(run[0]).toMatch(/<w:u\b/);
    for (const run of [...institutionRuns, ...themeRuns, ...quoteRuns]) {
      expect(run[0]).not.toMatch(/<w:u\b/);
    }
  });

  test('DOCX omits the "Reviews (writeup)" section entirely when no review was submitted', async () => {
    const report = composeReviewReport({
      requestNumber: 'R-104',
      generatedAtIso: '2026-09-14T12:00:00.000Z',
      matrix: { reviewers: [], questions: [] },
    });
    expect(report.writeupSection).toBeNull();

    const blob = await generateReviewReportDocx(report);
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await archive.file('word/document.xml').async('string');
    expect(documentXml).not.toContain('Reviews (writeup)');
  });

  test('PDF renderer does not throw and ignores writeupSection (no underline support, W4: no PDF work)', async () => {
    const report = composeReviewReport({
      requestNumber: 'R-105',
      generatedAtIso: '2026-09-14T12:00:00.000Z',
      matrix: { reviewers: [], questions: [] },
      synthesis: {
        writeupThemes: 'Reviewers were broadly enthusiastic.',
        writeupQuotations: [{ questionKey: 'q1', quote: 'This work is genuinely excellent.' }],
      },
      fullReviewers: [{
        suggestionId: 'suggestion-1',
        name: 'Dr. PDF Reviewer',
        reviewReceivedAt: '2026-09-01T00:00:00Z',
        reviewerOverallAssessment: 5,
        answers: [{ questionKey: 'q1', answerText: 'This work is genuinely excellent.' }],
      }],
    });
    expect(report.writeupSection).not.toBeNull();

    await expect(generateReviewReportPdf(report)).resolves.toBeInstanceOf(Uint8Array);
  });

  test('PDF renderer accepts readable and unreadable multiselect answers', async () => {
    const keyValueSpy = jest.spyOn(PDFReportBuilder.prototype, 'addKeyValue');
    const sectionSpy = jest.spyOn(PDFReportBuilder.prototype, 'addSection');
    const bytes = await generateReviewReportPdf(categoricalReport());
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new NodeTextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF');
    expect(keyValueSpy).toHaveBeenCalledWith(
      'Reviewer One',
      'Florida International University',
    );
    expect(keyValueSpy).toHaveBeenCalledWith('Reviewer Two', 'Not reported');
    expect(sectionSpy).toHaveBeenCalledWith('AI Synthesis (stale)');
  });
});
