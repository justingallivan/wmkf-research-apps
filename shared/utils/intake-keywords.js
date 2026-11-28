/**
 * Parse the J27 intake keyword fields for display.
 *
 * `wmkf_ai_keywords` holds `wmkf-keywords/1` and `wmkf_ai_methodologies` holds
 * `wmkf-methods/1` (Power Automate step 3; format in
 * docs/POWER_AUTOMATE_RESEARCH_INTAKE_FLOWS.md). Only term strings are returned:
 * keyword-row ids, run references and coined/group metadata are never surfaced.
 * Anything that is not one of these shapes (or a plain JSON list of strings, the
 * older format) parses to `null` so the caller can say it could not be read.
 */

const term = (item) => (item && typeof item === 'object' && typeof item.term === 'string' && item.term.trim()
  ? item.term.trim() : null);
const terms = (list) => (Array.isArray(list) ? list.map(term).filter(Boolean) : []);
const strings = (list) => (Array.isArray(list)
  ? list.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()) : []);

function parse(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @returns {null|undefined|{primary, runnerUp, secondary: string[], objects: string[], other: string[]}} */
export function parseFieldKeywords(raw) {
  const data = parse(raw);
  if (data === undefined) return undefined;
  if (Array.isArray(data)) return { primary: null, runnerUp: null, secondary: strings(data), objects: [], other: [] };
  if (!data || typeof data !== 'object' || data.schema !== 'wmkf-keywords/1') return null;
  return {
    primary: term(data.primary),
    runnerUp: term(data.runner_up),
    secondary: terms(data.secondary),
    objects: terms(data.objects),
    other: strings(data.other),
  };
}

/** @returns {null|undefined|string[]} */
export function parseMethodsKeywords(raw) {
  const data = parse(raw);
  if (data === undefined) return undefined;
  if (Array.isArray(data)) return strings(data);
  if (!data || typeof data !== 'object' || data.schema !== 'wmkf-methods/1') return null;
  return terms(data.methods);
}
