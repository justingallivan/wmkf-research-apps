// Only a panel specialty and its source location continue into reviewer discovery.
import { DATA_CLASSES, REVIEWER_FINDER_PROPOSAL_MAX_CHARS, buildUntrustedContentPreamble, wrapUntrustedContent } from '../utils/ai-payload-boundary';

export function collectExpertisePage(pages) {
  return async page => {
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    pages[page.pageNumber - 1] = text;
    return text;
  };
}

export async function readPanelExpertise({ pages, complete }) {
  const lines = pages.map((text, index) => '[Source ' + (index + 1) + ']\n' + text);
  const input = wrapUntrustedContent({
    text: lines.join('\n'), source: 'reviewer-finder.discovery-brief',
    dataClass: DATA_CLASSES.PROPOSAL_TEXT, maxChars: REVIEWER_FINDER_PROPOSAL_MAX_CHARS,
  });
  const prompt = [
    buildUntrustedContentPreamble([input.nonce]),
    'Identify the broad academic specialties needed on an independent review panel. Return only a JSON array of up to six objects with specialty (short field name), source (integer source number), and anchor (a short exact phrase from that source supporting the specialty). Do not describe proposed experiments, give instructions, evaluate the research, or suggest people.',
    input.text,
  ].join('\n');
  const response = await complete(prompt);
  if (response.refused || response.stopReason === 'refusal') return { status: 'analysis_refused' };
  let items;
  try {
    const json = response.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    items = JSON.parse(json);
  } catch {
    return { status: 'analysis_invalid' };
  }
  const norm = value => value.replace(/\s+/g, ' ').trim();
  const topics = (Array.isArray(items) ? items.slice(0, 6) : []).filter(item =>
    typeof item?.specialty === 'string' && item.specialty.trim() && item.specialty.length <= 100
    && Number.isInteger(item.source) && typeof pages[item.source - 1] === 'string'
    && typeof item.anchor === 'string' && norm(item.anchor).length >= 8 && item.anchor.length <= 180
    && norm(pages[item.source - 1]).includes(norm(item.anchor))
  ).map(({ specialty, source }) => ({ specialty: specialty.trim(), source }));
  return topics.length ? { topics } : { status: 'analysis_invalid' };
}
