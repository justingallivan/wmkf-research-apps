/**
 * Canonical server-side producer for multiselect review answers.
 *
 * The browser submits numeric values only. Labels, ordering, deduplication, and
 * the historical snapshot text are derived exclusively from the live question
 * options so a client can never persist a forged label.
 */

export class ReviewMultiselectError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReviewMultiselectError';
  }
}

/**
 * @param {{key?:string,label?:string,required?:boolean,options?:Array<{value:number,label:string}>}} field
 * @param {unknown} submittedValues
 * @returns {{values:number[],pairs:Array<{value:number,label:string}>,answerText:string}}
 */
export function canonicalizeMultiselectSelection(field, submittedValues) {
  const label = field?.label || field?.key || 'Multiselect question';
  if (!Array.isArray(submittedValues)) {
    throw new ReviewMultiselectError(`${label}: must be an array of numeric values.`);
  }
  if (!Array.isArray(field?.options) || field.options.length === 0) {
    throw new ReviewMultiselectError(`${label}: has no configured options.`);
  }

  const submitted = new Set();
  for (const value of submittedValues) {
    if (!Number.isInteger(value)) {
      throw new ReviewMultiselectError(`${label}: selections must be whole-number option values.`);
    }
    submitted.add(value);
  }

  const pairs = [];
  const optionValues = new Set();
  for (const option of field.options) {
    if (!Number.isInteger(option?.value)
      || typeof option?.label !== 'string'
      || option.label.trim().length === 0
      || optionValues.has(option.value)) {
      throw new ReviewMultiselectError(`${label}: has malformed configured options.`);
    }
    optionValues.add(option.value);
    if (submitted.has(option.value)) {
      pairs.push({ value: option.value, label: option.label });
    }
  }

  for (const value of submitted) {
    if (!optionValues.has(value)) {
      throw new ReviewMultiselectError(`${label}: invalid choice ${value}.`);
    }
  }
  if (field.required && pairs.length === 0) {
    throw new ReviewMultiselectError(`${label}: required.`);
  }

  return {
    values: pairs.map((pair) => pair.value),
    pairs,
    answerText: pairs.map((pair) => pair.label).join('; '),
  };
}
