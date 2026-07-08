/**
 * Peer Review Summarizer — Phase 0 prompt templates for Executor / Dynamics
 * storage. Mirrors `phase-i-dynamics.js` and `reviewer-finder-dynamics.js`.
 *
 * Two live Claude calls; both seeded into `wmkf_ai_prompt`:
 *   - peer-review-summarizer.analyze   (combined SUMMARY + QUESTIONS pass)
 *   - peer-review-summarizer.questions (fallback when main-pass questions
 *     parsing comes back empty/short — the existing route makes a second
 *     call to a stricter questions-only prompt)
 *
 * `peer-reviewer.js` formerly also defined `createThemeSynthesisPrompt` and
 * `createActionItemsPrompt`, which were never imported anywhere. They were
 * removed as dead code S344 (2026-07-08); if theme-synthesis / action-items
 * passes are ever wanted, author fresh prompts here + in the seed script.
 *
 * SOURCE OF TRUTH RECONCILIATION
 * ──────────────────────────────────────────────────────────────────────────
 * WIRED S344 (2026-07-08): `pages/api/process-peer-reviews.js` now runs these
 * rows via `executePrompt('peer-review-summarizer.analyze'|'.questions', ...)`
 * — the templates below ARE the live execution source, and staff /admin edits
 * take effect. The function generators in `peer-reviewer.js` are retained only
 * as the rollback path (revert the route diff); do not delete them. The route
 * still owns per-review A7 wrapping and passes the preamble via `a7_preamble`.
 * See docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md.
 *
 * VARIABLE CONVENTIONS
 * ──────────────────────────────────────────────────────────────────────────
 * Both legacy prompts interpolate `${reviewTexts.length}` and join the texts
 * inline. Phase 0 Executor doesn't compute or join, so the route owns:
 *   - `{{review_count}}`         — number, caller-passed
 *   - `{{review_count_suffix}}`  — "s" or "" (analyze only) — same pattern as
 *                                  summary_length_suffix in phase-i.summary
 *   - `{{reviews_block}}`        — caller-built joined string in the form:
 *                                  "**Review 1:**\n<text>\n\n---\n**Review 2:**\n..."
 *   - `{{a7_preamble}}`          — A7 untrusted-content preamble, caller-built
 *                                  from the per-review nonces (S344). Placed in
 *                                  the SYSTEM block (below) so it leads the
 *                                  hardening instructions. `reviews_block` is
 *                                  passed as already-wrapped text (route owns the
 *                                  per-review nonce wrapping), so the Executor
 *                                  does NOT re-wrap or auto-inject a preamble —
 *                                  the route MUST supply this. Seeded as
 *                                  required:true (fail closed).
 *
 * PARSEMODE: RAW
 * ──────────────────────────────────────────────────────────────────────────
 * Both prompts emit markdown text (not JSON), parsed by post-call string
 * splitting in the route. Single `response_text` output, `target.kind: "none"`.
 */

// ────────────────────────────────────────────────────────────────────────────
// peer-review-summarizer.analyze
// ────────────────────────────────────────────────────────────────────────────
// One Claude call produces two markdown sections (OUTPUT 1 - SUMMARY,
// OUTPUT 2 - QUESTIONS). Route splits on "**OUTPUT 2 - QUESTIONS:**" markers.

// A7 preamble (built by the route from the per-review nonces) lands here. See
// the header note on {{a7_preamble}}; composeMessages interpolates {{var}} in
// the system block.
export const ANALYZE_SYSTEM_PROMPT = '{{a7_preamble}}';

export const ANALYZE_USER_PROMPT_TEMPLATE = `Please analyze these peer review documents and provide a comprehensive summary in markdown format. I will provide you with {{review_count}} peer review document(s).

**INSTRUCTIONS:**

Please create TWO separate markdown outputs:

**OUTPUT 1 - SUMMARY:**

1. **Review Count**: Start with "We received {{review_count}} review{{review_count_suffix}}"

2. **Grade Summary**: Write a sentence summarizing the grades/ratings from the reviews. Look for ratings like Excellent, Very Good, Good, Fair, Poor, or numerical scores. If reviewers provide mixed ratings (like "Excellent/Very Good"), note those. Example: "The proposal received two reviews of Excellent, one of Very Good, and one mixed rating of Good/Fair."

3. **Reviewer Details**: Start with "The reviewers were " and list each reviewer's name underlined using <u>Name</u> format, followed by their institutional affiliation in parentheses. If names/affiliations cannot be determined, state "could not be determined from the review documents." After each reviewer, include their general area of expertise if it can be inferred (e.g., "has expertise in bioinformatics").

4. **Overall Tone & Themes**: Provide 2-3 sentences about the overall tone of the reviews and general themes that emerged across reviewers.

5. **Key Quotations**: Provide relevant quotations from each reviewer, ordered from most positive to most critical. Format as:
   - "The most positive reviewer said: '[quote]'"
   - "Another reviewer noted: '[quote]'"
   - Continue for each reviewer...
   - "The most critical reviewer noted: '[quote]'"

**OUTPUT 2 - QUESTIONS:**

Create a separate section listing all questions, concerns, or issues raised by the reviewers. Format as a bulleted list.

---

**PEER REVIEW TEXTS:**

{{reviews_block}}

Please provide both outputs as separate markdown sections.`;

// ────────────────────────────────────────────────────────────────────────────
// peer-review-summarizer.questions
// ────────────────────────────────────────────────────────────────────────────
// Fallback questions-extraction call. Live route makes this when the analyze
// pass either skipped questions or produced <50 chars of questions content.

export const QUESTIONS_SYSTEM_PROMPT = '{{a7_preamble}}';

export const QUESTIONS_USER_PROMPT_TEMPLATE = `Please extract all questions, concerns, issues, and points requiring clarification that were raised by the peer reviewers in these {{review_count}} review document(s).

**INSTRUCTIONS:**
- Extract any explicit questions asked by reviewers
- Include concerns or issues that imply questions need to be addressed
- Include requests for clarification or additional information
- Format as a bulleted list in markdown
- Group similar questions/concerns together if appropriate
- If no clear questions are found, note "No specific questions were identified in the peer reviews"

**PEER REVIEW TEXTS:**

{{reviews_block}}

Please provide the questions list in markdown format.`;
