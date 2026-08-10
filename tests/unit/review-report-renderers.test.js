import {
  TextDecoder as NodeTextDecoder,
  TextEncoder as NodeTextEncoder,
} from 'util';
import { composeReviewReport } from '../../shared/utils/review-report';
import { generateReviewReportDocx } from '../../shared/utils/review-report-docx';
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
