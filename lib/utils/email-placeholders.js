/**
 * Shared literal placeholder substitution for server-rendered email templates.
 * Callers own their token dictionaries and rendering/escaping rules. Longer
 * keys are applied first; replacements are global, sequential, and unescaped.
 */
export function applyPlaceholders(template, replacements) {
  let text = String(template || '');
  const entries = Object.entries(replacements).sort((a, b) => b[0].length - a[0].length);
  for (const [placeholder, value] of entries) {
    text = text.split(placeholder).join(String(value ?? ''));
  }
  return text;
}
