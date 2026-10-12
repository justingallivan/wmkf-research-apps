/** @jest-environment node */
import {
  EXPENSE_EXTRACT_DOCUMENT_ROW,
  EXPENSE_EXTRACT_IMAGE_ROW,
  TOOL_PROMPT_ROWS,
  buildExpenseDocumentVariables,
  buildExpenseImageVariables,
} from '../../../shared/config/prompts/expense-reporter-dynamics';
import { composeToolPromptPair } from '../../../lib/services/tool-prompt-composer';
import { validatePromptTemplatePair } from '../../../lib/utils/prompt-validators';
import { DATA_CLASSES, wrapUntrustedContent } from '../../../lib/utils/ai-payload-boundary';
import { withDeterministicNonces } from '../../helpers/prompt-parity';
import { expectGolden } from '../../helpers/golden';

const compose = (row, { variables, nonces }) =>
  composeToolPromptPair({ systemPrompt: row.systemPrompt, body: row.body }, variables, { nonces });

const FILE_NAMES = ['receipt.pdf', 'Lunch {{file_name}} $& ${x}.pdf', "it's a `weird` name.jpg"];
const TEXTS = ['VENDOR: Test Cafe TOTAL: $12.00', 'Has {{a7_preamble}} and ${dollar} and $& and `ticks`'];
const wrap = (text) => wrapUntrustedContent({
  text,
  source: 'process-expenses.documentText',
  dataClass: DATA_CLASSES.STAFF_PROVIDED_CONTEXT,
  maxChars: 60000,
  label: 'receipt or invoice',
});

describe('expense-reporter.extract-document parity (PDF/text path)', () => {
  for (const fileName of FILE_NAMES) {
    for (const text of TEXTS) {
      test(`byte-equal: ${fileName} / ${text.slice(0, 12)}`, () => {
        const newOut = withDeterministicNonces(['x1'], () => compose(
          EXPENSE_EXTRACT_DOCUMENT_ROW,
          buildExpenseDocumentVariables({ wrappedDocumentText: wrap(text).text, fileName }),
        ));
        expect(newOut.systemPrompt).toBe('');
        expectGolden('expense-reporter', newOut.body);
      });
    }
  }
});

describe('expense-reporter.extract-image parity (image path)', () => {
  for (const [fileName, fileType] of [['receipt.png', 'png'], ['r {{x}} $&.jpg', 'jpg'], ['r.JPEG', 'JPEG'], ["it's.jpeg", 'jpeg']]) {
    test(`byte-equal: ${fileName}`, () => {
      const newOut = compose(EXPENSE_EXTRACT_IMAGE_ROW, buildExpenseImageVariables({ fileName }));
      expect(newOut.systemPrompt).toBe('');
      expectGolden('expense-reporter', newOut.body);
      expect(newOut.body).toContain('ATTACHED IMAGE');
    });
  }
});

describe('row definitions', () => {
  test.each([
    [EXPENSE_EXTRACT_DOCUMENT_ROW, 'expense-reporter.extract-document'],
    [EXPENSE_EXTRACT_IMAGE_ROW, 'expense-reporter.extract-image'],
  ])('%# metadata, validator, slot, no A7 text', (ROW, name) => {
    expect(ROW).toMatchObject({ promptName: name, model: 'haiku', maxTokens: 1000 });
    expect(ROW.temperature).toBeUndefined();
    const declared = ROW.variables.variables.map((v) => v.name);
    expect(declared).toContain('a7_preamble');
    expect(validatePromptTemplatePair(ROW.promptName, { systemPrompt: ROW.systemPrompt, body: ROW.body, declaredVars: declared }))
      .toEqual({ valid: true, issues: [] });
    const stripped = ROW.body.replace('{{a7_preamble}}', '');
    const r = validatePromptTemplatePair(ROW.promptName, { systemPrompt: ROW.systemPrompt, body: stripped, declaredVars: declared });
    expect(r.valid).toBe(false);
    expect(r.issues.join(' ')).toMatch(/a7_preamble/);
    for (const t of [ROW.systemPrompt, ROW.body]) {
      expect(t).not.toMatch(/UNTRUSTED CONTENT RULES:|WMKF-UNTRUSTED-CONTENT|\[\[WMKF-/);
    }
  });
  test('manifest rows', () => {
    expect(TOOL_PROMPT_ROWS).toEqual([EXPENSE_EXTRACT_DOCUMENT_ROW, EXPENSE_EXTRACT_IMAGE_ROW]);
  });
});
