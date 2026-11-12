/** Shared pure cleanup for the legacy title caller and the durable title task. */
export const MIN_TITLE_OUTPUT_CHARS = 8;

/**
 * Clean the model's one-line output: strip a stray ```/```text fence (raw
 * parseMode does NOT strip fences), pick the objective line, and remove
 * surrounding quotes / a trailing sentence period the prompt says to omit.
 *
 * Line handling: prefer the first line that starts with "To" (the objective), so
 * a stray preamble line ("Here is the objective:") is SKIPPED rather than
 * returned; fall back to the first non-empty line. The downstream `/^To\b/` guard
 * then rejects a refusal that has no "To …" line at all.
 *
 * Period handling: strip ONE trailing sentence period, but NOT an abbreviation
 * period (keep "… in the U.S.") — only strip when the char before it is not an
 * uppercase letter.
 */
export function cleanTitle(text) {
  let t = String(text).trim();
  const fence = t.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```$/);
  if (fence) t = fence[1].trim();
  const lines = t.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  t = lines.find((l) => /^["'“]*To\b/i.test(l)) || lines[0] || '';
  t = t.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  t = t.replace(/(?<![A-Z])\.$/, '').trim();
  return t;
}

