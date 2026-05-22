/**
 * Output schema for the Expense Reporter extraction LLM call (A7 Part 5, #11).
 *
 * /api/process-expenses `JSON.parse`s raw model output (both the image-vision
 * path and the PDF-text path) and spreads it into the expenses result array.
 * A prompt-injected model — receipts are an image content block, an obvious
 * injection vector — can add keys or smuggle values. This schema is validated
 * AFTER the parse (via `validateAiJson`) so undeclared keys are dropped and
 * the confidence enum is enforced.
 */

const optStr = (maxLength) => ({
  type: 'string',
  required: false,
  default: null,
  nullable: true,
  maxLength,
});

/** Schema for `createExpenseExtractionPrompt` output. */
export const EXPENSE_EXTRACTION_SCHEMA = {
  type: 'object',
  fields: {
    date: optStr(100),
    vendor: optStr(500),
    description: optStr(2_000),
    amount: optStr(100),
    tax: optStr(100),
    paymentMethod: optStr(200),
    cardType: optStr(100),
    cardLast4: optStr(20),
    category: optStr(200),
    confidence: {
      type: 'string',
      required: false,
      default: 'low',
      nullable: true,
      enum: ['high', 'medium', 'low'],
      coerceEnum: true,
    },
    notes: optStr(4_000),
  },
};
