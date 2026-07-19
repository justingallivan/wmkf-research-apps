/**
 * ContactEnrichmentService — search-tiers cluster (Tier 3 Claude web search +
 * the Google Scholar URL builder).
 *
 * Stage 6 of the ContactEnrichmentService decomposition
 * (docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md, Checkpoint A2).
 * Behavior-freeze, pure code motion: `claudeWebSearch` and
 * `buildGoogleScholarUrl` moved verbatim out of contact-enrichment-service.js.
 * DAG leaf — depends only on ContactParser, getModelForApp, and
 * CLAUDE_WEB_SEARCH_SCHEMA (all stateless).
 *
 * A7 prompt-injection surface (id: 'contact-enrichment', inv 21,
 * scripts/check-prompt-injection-tagging.js) — `claudeWebSearch` wraps the
 * untrusted candidate name/affiliation via `wrapUntrustedContent` and hardens
 * the system prompt via `buildUntrustedContentPreamble` before calling the
 * model. Both markers now live in THIS file; the gate registry's
 * `callSiteFiles` for this surface points here (moved in the same commit as
 * this file, per C6 of the decomposition plan).
 *
 * C11/C13 (decomposition plan): `claudeWebSearch` uses THREE dynamic
 * `import()`s of ESM modules that cannot be `require`d from this CommonJS
 * file — `ai-payload-boundary.js`, `llm-client.js`, `ai-output-schema.js`.
 * Preserved as dynamic imports; string paths rewritten for this file's
 * one-level-deeper location under lib/services/contact-enrichment/.
 */

const { ContactParser } = require('../../utils/contact-parser');
const { getModelForApp } = require('../../../shared/config/baseConfig');
const { CLAUDE_WEB_SEARCH_SCHEMA } = require('./constants');

function webSearchCitations(content) {
  const out = [];
  for (const block of (Array.isArray(content) ? content : [])) {
    for (const citation of (Array.isArray(block?.citations) ? block.citations : [])) {
      if (typeof citation?.url !== 'string' || !citation.url.trim()) continue;
      out.push({
        sourceKind: 'claude_web_search_citation',
        sourceUrl: citation.url,
        sourceTitle: typeof citation.title === 'string' ? citation.title.slice(0, 300) : null,
        citedText: typeof citation.cited_text === 'string' ? citation.cited_text.slice(0, 800) : null,
      });
    }
  }
  return out;
}

function evidenceForEmail(citations, email, facultyPageUrl) {
  if (!email || !Array.isArray(citations) || citations.length === 0) return null;
  const normalizedEmail = String(email).toLowerCase();
  const exact = citations.find((citation) =>
    String(citation.citedText || '').toLowerCase().includes(normalizedEmail));
  const page = citations.find((citation) =>
    facultyPageUrl && citation.sourceUrl === facultyPageUrl);
  const evidence = exact || page || null;
  return evidence ? { ...evidence, observedAt: new Date().toISOString() } : null;
}

/**
 * Claude Web Search implementation (Tier 3)
 * Uses Claude's web_search tool to find contact information
 * Uses Haiku for cost efficiency with a minimal prompt
 * Temperature set to 0.2 for deterministic, accurate contact extraction
 */
async function claudeWebSearch(candidate, apiKey, { signal, deadlineAt } = {}) {
  // Extract just institution name for cleaner search
  const institution = candidate.affiliation
    ? candidate.affiliation.split(',')[0].trim()
    : '';

  // Clean name by removing honorifics (Dr., Prof., etc.)
  const cleanName = ContactParser.stripHonorifics(candidate.name);

  // The candidate name/affiliation are U-EXT discovery data (A7 Part 6) —
  // wrap them in nonce-bearing sentinels and harden the system prompt so a
  // malicious "name" cannot inject instructions. This file is CommonJS;
  // the boundary helpers are ESM, so import dynamically.
  const { wrapUntrustedContent, buildUntrustedContentPreamble, DATA_CLASSES } =
    await import('../../utils/ai-payload-boundary.js');
  const wrappedCandidate = wrapUntrustedContent({
    text: `Name: ${cleanName}\nInstitution: ${institution || 'unknown'}`,
    source: 'contact-enrichment.candidate',
    dataClass: DATA_CLASSES.EXTERNAL_API_TEXT,
    maxChars: 2_000,
    label: 'candidate identity',
  });

  // Route through the canonical LLMClient wrapper (SSRF allowlist, abortable
  // timeout, 429/529 retry, API-key redaction) instead of a raw Anthropic
  // fetch (A7 follow-up step 5). The `web_search` tool is preserved via
  // `complete()`'s `tools` passthrough. This file is CommonJS; LLMClient is
  // ESM, so import dynamically.
  const { LLMClient } = await import('../llm-client.js');
  const clientOpts = {
    apiKey,
    model: getModelForApp('contact-enrichment'),
    appName: 'contact-enrichment',
  };
  // Under a reviewer-search deadline, bound this attempt by min(remaining
  // budget, 180s); otherwise leave the LLMClient default (120s).
  if (deadlineAt != null) {
    const remainingMs = deadlineAt - Date.now();
    clientOpts.timeoutMs = Math.max(1, Math.min(remainingMs, 180_000));
  }
  const client = new LLMClient(clientOpts);

  let result;
  try {
    result = await client.complete({
      maxTokens: 256,
      temperature: 0.2, // Low temperature for accurate, deterministic contact extraction
      system: buildUntrustedContentPreamble([wrappedCandidate.nonce]),
      signal,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 1,
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Find the verified institutional email address and faculty/profile page for the researcher identified in the untrusted block below, using the web_search results.

RULES (this contact will be used to send an invitation, so accuracy matters more than completeness):
- Only return an email you actually found published on an authoritative page (faculty directory, lab site, or institutional page) for THIS EXACT person at THIS institution.
- If you cannot find a real published email for this specific person, set "email" to null. NEVER guess, construct, infer, or pattern-match an address (e.g. "firstname@gmail.com"). A null email is the correct, expected answer when none is published.
- Never return an email that belongs to a different person who merely shares part of the name.

Return ONLY JSON: {"email": <string|null>, "facultyPageUrl": <string|null>, "website": <string|null>}\n\n${wrappedCandidate.text}`,
        },
      ],
    });
  } catch (e) {
    // Preserve a deadline/cancel abort as-is so the route can surface a
    // timeout rather than a generic "Claude API error".
    if (signal?.aborted) throw e;
    throw new Error(`Claude API error: ${e.message}`);
  }

  // `result.text` joins all text content blocks (the web_search tool also
  // emits non-text blocks, which we don't need here).
  const responseText = result.text;
  if (!responseText) {
    return null;
  }

  // Parse + validate JSON from response (A7 Part 6) — drop any keys an
  // injected model added before the contact record is used.
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const { validateAiJson } = await import('../../utils/ai-output-schema.js');
      const validated = validateAiJson(parsed, CLAUDE_WEB_SEARCH_SCHEMA);
      if (validated.ok) {
        const value = validated.value;
        const citations = webSearchCitations(result.content);
        if (citations.length > 0) {
          value.searchEvidence = citations;
          value.emailEvidence = evidenceForEmail(citations, value.email, value.facultyPageUrl);
          if (!value.facultyPageUrl && value.emailEvidence?.sourceUrl
            && !ContactParser.isDocumentUrl(value.emailEvidence.sourceUrl)) {
            value.facultyPageUrl = value.emailEvidence.sourceUrl;
          }
        }
        // Grounding guard: even with retained citations, model output can
        // surface a same-named person's address. Reject any returned email
        // whose local part doesn't plausibly match THIS person's name. The
        // cited page is retained for the server-side page-grounding tier.
        if (value.email && !ContactParser.isNameConsistentEmail(value.email, candidate.name)) {
          value.emailRejectedReason = 'name_mismatch';
          value.rejectedEmail = value.email; // preserved for the quarantined lead (Slice 2a)
          value.email = null;
        }
        return value;
      }
      console.warn('Contact enrichment output failed schema validation:', validated.errors.join('; '));
    }
  } catch (e) {
    console.error('Failed to parse Claude response:', e.message);
  }

  return null;
}

/**
 * Build Google Scholar search URL for a researcher
 */
function buildGoogleScholarUrl(name, affiliation) {
  if (!name) return null;

  // Clean up name
  const cleanName = name.replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, '').trim();

  // Extract institution name from affiliation
  let institution = '';
  if (affiliation) {
    const parts = affiliation.split(',').map(p => p.trim());
    const instPart = parts.find(p =>
      /university|institute|college/i.test(p) &&
      !/^(department|dept|division|school)/i.test(p)
    );
    institution = instPart || parts[0] || '';
  }

  const query = institution ? `${cleanName} ${institution}` : cleanName;
  return `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(query)}`;
}

module.exports = {
  claudeWebSearch,
  buildGoogleScholarUrl,
  webSearchCitations,
  evidenceForEmail,
};
