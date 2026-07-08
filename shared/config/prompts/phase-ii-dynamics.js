/**
 * Phase II Writeup — Phase 0 prompt templates for Executor / Dynamics
 * storage. Mirrors phase-i-dynamics.js, reviewer-finder-dynamics.js,
 * peer-reviewer-dynamics.js.
 *
 * Four live Claude prompts feed both `phase-ii-writeup` AND
 * `batch-proposal-summaries` (the two apps share the prompt set):
 *
 *   - phase-ii.summarize          — main two-part proposal writeup
 *                                    (PART 1 summary page + PART 2 detailed)
 *   - phase-ii.extract-structured — JSON extraction of metadata fields
 *                                    (institution, PI, funding amount, etc.)
 *   - phase-ii.qa                 — system prompt for streaming Q&A chat
 *   - phase-ii.refine             — refine an existing writeup based on user
 *                                    feedback
 *
 * Naming uses `phase-ii.<purpose>` as the domain prefix (parallel to
 * `phase-i.<purpose>`) rather than tying to either app key, since the
 * prompts are genuinely shared.
 *
 * SOURCE OF TRUTH RECONCILIATION
 * ──────────────────────────────────────────────────────────────────────────
 * Live route still uses the function-based generators in
 * shared/config/prompts/proposal-summarizer.js (and the inline
 * REFINEMENT_PROMPT in pages/api/refine.js). That is unchanged; this file
 * is dormant Phase 0 storage that lets staff view/edit prompts in Dynamics
 * ahead of the post-cycle route refactor. When the routes (process.js,
 * qa.js, refine.js) migrate to executePrompt(), the legacy generators
 * become unused and can be deleted.
 *
 * SUNSET S344 (2026-07-08): the Phase-0-to-Executor migration this file was
 * staged for is NOT happening for these apps. `phase-ii-writeup` and
 * `batch-proposal-summaries` are now sunset-candidates (PDF-upload format
 * retired; see APP_LIFECYCLE_REGISTRY). The `phase-ii.extract-structured`
 * template below is retained only as the reference for the planned
 * Dataverse-native migration (source admin fields from `akoya_request`
 * instead of inferring them from the PDF) — see docs/PROMPT_LEGACY_AUDIT.md.
 * These rows remain viewable/editable in /admin but drive nothing.
 *
 * SYSTEM VS USER PLACEMENT (PHASE 0 COMPROMISE)
 * ──────────────────────────────────────────────────────────────────────────
 * Per Phase 0 contract, every variable declares placement: "user". In
 * reality:
 *   - phase-ii.summarize / extract-structured / refine — sent as user message
 *   - phase-ii.qa — sent as system message (with cache_control: ephemeral)
 *
 * For all four we store the full template in wmkf_ai_promptbody and leave
 * wmkf_ai_systemprompt empty. The route consumes the body string and
 * places it in either `system:` (qa.js) or `messages[].content` (others).
 * Same approach as phase-i.summary's compromise — keep prompt text
 * unchanged from what's shipping today.
 *
 * VARIABLE CONVENTIONS
 * ──────────────────────────────────────────────────────────────────────────
 * Conditional truncation in the legacy code (e.g.,
 * `${text.substring(0, 100000)} ${text.length > 100000 ? '...' : ''}`) is
 * collapsed to a single caller-pre-formatted variable. The route is
 * responsible for truncating + appending the "..." suffix before passing.
 * Same pattern as `additional_notes_block` in reviewer-finder.
 *
 * For `phase-ii.summarize`, `detailed_word_target` is the caller-derived
 * value (legacy: `summaryLength * 400`). Caller owns the math.
 */

// ────────────────────────────────────────────────────────────────────────────
// phase-ii.summarize
// ────────────────────────────────────────────────────────────────────────────

export const SUMMARIZE_SYSTEM_PROMPT = '';

export const SUMMARIZE_USER_PROMPT_TEMPLATE = `Please analyze this research proposal and create a two-part writeup following the exact structure below.

Begin with the project title and a one-line summary of the institution, requested amount, and project period:

# [Project Title]
**[Institution] | Requested Amount: [Amount] | Project Period: [Years]**

Then proceed with the two-part writeup.

**PART 1: SUMMARY PAGE**
Write for a "grade 13 science audience" (an educated reader who is NOT a specialist in this field). Avoid jargon entirely; if a technical term is unavoidable, include a brief plain-English parenthetical. Each item below should be concise (1-3 sentences).

**Executive Summary:**
[2-4 sentences describing what this project is about: the core scientific question, the approach, and the expected outcome. Written so a non-specialist can understand.]

**Impact:**
[1-3 sentences. If this research succeeds, what will be learned or enabled? Focus on broad significance.]

**Methodology Overview:**
[1-3 sentences. High-level description of the methods, approach, and goals. No jargon.]

**Personnel Overview:**
[2-4 sentences. Introduce the PI and each co-investigator by name with their title, institution, and area of expertise. Use format: "The principal investigator is <u>Full Name</u>, a [lowercase title] at [institution], who [studies/specializes in area]." Then list co-investigators similarly: "Co-investigators include <u>Full Name</u>, [expertise]; <u>Full Name</u>, [expertise]."
Example: "The principal investigator is <u>Aneel Aggarwal</u>, a professor of pharmacological sciences and oncological sciences at the Icahn School of Medicine at Mount Sinai, who studies the structural biology of bacterial defense systems. Co-investigators include <u>Yi Shi</u>, a mass spectrometry expert; <u>Harm van Bakel</u>, a microbiologist specializing in host-pathogen interactions; and <u>Olga Rechkoblit</u>, who studies cyclic nucleotide biochemistry."]

**Rationale for Keck Funding:**
[1-3 sentences. Why does this project need foundation support rather than traditional funding? Focus on risk, novelty, or cross-disciplinary nature.]

---

**PART 2: DETAILED WRITEUP**
Technical language is acceptable here, but define all abbreviations on first use (e.g., "cryo-electron microscopy (cryo-EM)"). Target approximately {{detailed_word_target}} words for Part 2.

**Background & Impact:**
[1-2 paragraphs. The scientific problem, current state of knowledge, what gap this work fills, and the potential impact if successful. Include specific technical details.]

**Methodology:**
[1-2 paragraphs. Research approach, techniques, experimental design. Be specific about methods and technical approaches.]

**Personnel:**
[3-5 sentences. Name each investigator with their title, institution, and specific role on this project. Keep it factual and brief; no lengthy descriptions of lab capabilities or career achievements. Use <u>Name</u> tags. Format: "The principal investigator is <u>John Smith</u>, a professor of biology at [institution]. For this project, he will lead [specific contribution]. The co-investigator is <u>Jane Doe</u>, an associate professor of chemistry at [institution], who will [specific contribution]."]

**TONE AND LANGUAGE RULES (apply to both parts):**
- Use neutral, matter-of-fact language. Avoid promotional or effusive terms
- Avoid unnecessary adjectives like "technical", "deep", "rigorous", "proper", "comprehensive", "excellent", "outstanding"
- Write in a straightforward, academic tone similar to scientific review documents
- State facts and qualifications directly without embellishment
- Focus on what the researchers do/study rather than how well they do it
- Minimize use of em dashes. Prefer commas, semicolons, parentheses, or separate sentences instead.

**FORMATTING RULES:**
- Principal Investigator and Co-Investigator names should be underlined using HTML tags <u>Name</u>
- Academic titles should be lowercase (professor, associate professor, assistant professor)
- Use the exact section headers shown above (Executive Summary, Impact, Methodology Overview, Personnel Overview, Rationale for Keck Funding, Background & Impact, Methodology, Personnel)
- Include the "---" separator between Part 1 and Part 2

Research Proposal Text:
---
{{proposal_text}}

Write in a neutral, factual tone. Avoid promotional language or unnecessary adjectives. State information directly and let the science speak for itself.`;

// ────────────────────────────────────────────────────────────────────────────
// phase-ii.extract-structured — SUNSET S344 (retained as DV-native migration
// reference; see file header + docs/PROMPT_LEGACY_AUDIT.md). Drives nothing.
// ────────────────────────────────────────────────────────────────────────────

export const EXTRACT_SYSTEM_PROMPT = '';

export const EXTRACT_USER_PROMPT_TEMPLATE = `Based on this research proposal, please extract the following information and return it as a JSON object.

IMPORTANT: The filename "{{filename}}" may contain hints about the institution name. Use this information to help identify the correct institution.

{
  "filename": "{{filename}}",
  "institution": "Primary institution name (check filename for hints)",
  "city_state": "City, State of the primary institution using postal abbreviation (e.g., 'Pasadena, CA')",
  "project_title": "Full project title as stated in the proposal",
  "principal_investigator": "Name of PI",
  "investigators": ["List", "of", "investigators"],
  "research_area": "Main research domain",
  "methods": ["List", "of", "key", "methods"],
  "funding_amount": "Amount requested if mentioned",
  "invited_amount": "Invited amount if mentioned on cover page",
  "total_project_cost": "Total project cost/budget if mentioned on cover page",
  "meeting_date": "Meeting date from the cover page (e.g., 'June 2026')",
  "duration": "Project duration if mentioned",
  "keywords": ["Key", "research", "terms"]
}

Research text:
{{proposal_text}}

Return only the JSON object, no other text.`;

// ────────────────────────────────────────────────────────────────────────────
// phase-ii.qa
// ────────────────────────────────────────────────────────────────────────────
// System prompt for streaming Q&A chat with web search. Route consumes
// this in the system slot (with cache_control: ephemeral). proposal_text
// is pre-truncated to ~80,000 chars by the caller; if truncated, caller
// appends the "[...proposal text truncated at 80,000 characters]" notice.
// summary_text may be "[No summary available]" if the route didn't run a
// preceding summarize call.

export const QA_SYSTEM_PROMPT = '';

export const QA_USER_PROMPT_TEMPLATE = `You are an expert research assistant helping analyze a research proposal. You have access to the full proposal text and a staff-generated summary.

## Document: {{filename}}

## Generated Summary
{{summary_text}}

## Full Proposal Text
{{proposal_text}}

## Instructions
- Answer questions thoroughly, referencing specific details from the proposal when relevant
- Use web search when asked about PI publications, institutional context, technical concepts, recent developments, or anything not contained in the proposal itself
- When you use web search results, briefly cite the source
- Be conversational but substantive; give real answers, not hedging
- If the proposal doesn't contain information needed to answer, say so directly
- You can quote specific passages from the proposal to support your answers`;

// ────────────────────────────────────────────────────────────────────────────
// phase-ii.refine
// ────────────────────────────────────────────────────────────────────────────
// Currently lives inline in pages/api/refine.js as REFINEMENT_PROMPT.
// proposal-summarizer.js also exports a `createRefinementPrompt` (different
// content) but that one is dead code — confirmed by grep. The live prompt
// is the inline one in refine.js, captured below verbatim.

export const REFINE_SYSTEM_PROMPT = '';

export const REFINE_USER_PROMPT_TEMPLATE = `Please refine the following research proposal summary based on the specific feedback provided. Maintain the same structure and level of detail, but improve the content according to the feedback.

**Original Summary:**
{{current_summary}}

**Feedback for improvement:**
{{user_feedback}}

**Instructions:**
- Keep the same overall structure and formatting
- Use proper markdown formatting: <u>underlines</u> for names, **bold** for emphasis, *italics* for secondary emphasis
- Incorporate the feedback to improve clarity, accuracy, or completeness
- Maintain the professional tone and technical accuracy
- If the feedback requests specific changes, implement them while keeping the rest of the summary intact
- If the feedback is unclear or contradictory, make reasonable improvements based on your best interpretation

Please provide the refined summary:`;
