---
title: "Reviewer Analyze Prompt — Metadata Redundancy & Program-Area Crash"
domain: reviewers
kind: audit
status: active
summary: "Reviewer analyze now sources request metadata from Dataverse and normalizes program-area writes instead of trusting LLM metadata extraction."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - shared/config/prompts/reviewer-finder.js
  - lib/services/claude-reviewer-service.js
  - lib/dataverse/adapters/reviewer-suggestion.js
  - pages/api/reviewer-finder/save-candidates.js
  - shared/components/reviewers/ReviewerSearchSection.js
  - docs/atlas/dataverse-akoya-request.md
---

# Reviewer Analyze Prompt — Metadata Redundancy & Program-Area Crash

**Status: FIXED in `codex/program-area-normalization` (2026-07-03).** Two linked
problems surfaced while diagnosing a production save failure. The original immediate
band-aid truncated overlong LLM output; the current fix requires `requestId`, sources
administrative proposal metadata from Dataverse, slims the analyze prompt to scientific
context + reviewer suggestions, and normalizes `wmkf_programarea` writes so
overlong/placeholder values are dropped rather than truncated. Program area remains an
app-owned Dataverse value for save compatibility; it is not sent to the model.

## Symptom (production, verified in logs)

Promoting reviewers for req **1002916** ("GreeNland Oldest ice exploration and ModEling
(GNOME)", GUID `6cc32fc4-d044-f111-88b5-000d3a3064b7`) failed on
`/api/reviewer-finder/save-candidates` with a Dataverse 400:

> The length of the 'wmkf_programarea' attribute of the 'wmkf_appreviewersuggestion'
> entity exceeded the maximum allowed length of '100'.

Vercel runtime error clusters (route `/api/reviewer-finder/save-candidates`, 2026-07-02
**23:26–23:28**, 3 attempts, 1 user) show **5 candidates all failing identically**:
Michael Bender, Joseph MacGregor, Eric Rignot, Paul Bierman, Thomas Blunier (all
cryosphere scientists — fits the Greenland-ice proposal). They fail identically because
`programArea` is **one shared value** applied to every candidate in the batch, not a
per-reviewer field. The logs do **not** contain the literal offending string — only the
Dataverse error is logged (`save-candidates.js:435` logs `candidateError.message`).

## Root-cause chain (all verified)

1. **The field limit is correct.** `wmkf_programarea` is `String`, `maxLength: 100`
   [schema `lib/dataverse/schema/wave2/wmkf_app_reviewer_suggestion.json:26`]. It is a
   deliberate short-label field — its sibling for long text is `wmkf_matchreason`, a
   `Memo(50000)` in the same entity. The valid values are ~40-char labels.
2. **The value is LLM free text.** Client sends `programArea =
   analysis?.proposalInfo?.programArea` [`ReviewerSearchSection.js:1031`] →
   `save-candidates.js` (`req.body.programArea`, `:103`, written `:415`) → adapter
   `reviewer-suggestion.js` (`upsert`, `ensureApplicantRecommended`).
3. **The parser is faithful, not over-capturing.** `parseAnalysisResponse`
   [`shared/config/prompts/reviewer-finder.js:209`, regex `:243`] captures the single
   line after `PROGRAM_AREA:` (dot doesn't cross newlines).
4. **The prompt is correct.** The live production prompt is a Dataverse override
   (`wmkf_ai_prompts`, name `reviewer-finder.analyze`, `iscurrent=true`, modified
   2026-06-14). Its `PROGRAM_AREA` instruction constrains to `"Science and Engineering
   Research Program"` / `"Medical Research Program"` / `"Not specified"` — identical to
   the bundled `ANALYZE_USER_PROMPT_TEMPLATE`.
5. **The model intermittently violated the constraint.** Reproduction (S318): fetched
   1002916's proposal (`ProjectDescription.pdf`) via the same SharePoint path
   `/load-proposal` uses; its cover page has **no "Program:" line** (only Title/Abstract).
   Re-running the analyze prompt, the model returned `"**PROGRAM_AREA:** Not specified"`
   → parsed `"Not specified"` (13 chars). **The >100 crash did NOT reproduce.** Best
   read: with no Program field to find, the model occasionally writes a descriptive
   research-area sentence on the `PROGRAM_AREA` line instead of "Not specified"; that one
   over-long line is captured verbatim and rejected by the 100-char field.

**Net:** correct field → correct prompt → intermittent model constraint-violation →
single-line parse captures it → 100-char field 400s. The defect is that unvalidated LLM
output is fed straight into a controlled-vocabulary field.

## Historical band-aid (replaced by the current fix)

Commit `0aa7c1d1` added `clampProgramArea()` in `reviewer-suggestion.js` and applied it
at all five `wmkf_programarea` write sites. It **truncates** an over-long value to 100 so
the save no longer 400s. This unblocks the user but **stores truncated garbage** in that
field for such proposals. It is a stopgap, not the fix — remove/replace it when the real
fix lands. (It does NOT touch the durable `wmkf_matchreason` prefix or anything else.)

Current code replaces that stopgap with `normalizeSuggestionProgramArea()` in
`lib/dataverse/adapters/reviewer-suggestion.js`. The normalizer preserves short request
labels, maps the old prompt labels to canonical Dataverse labels, and returns `null` for
overlong or placeholder values.

## The deeper issue — the prompt re-derived metadata Dataverse already owns

The analyze prompt's PART 1 makes the LLM extract, from the PDF, fields that are already
**authoritative structured data** on the `akoya_request` record — verified against the
live 1002916 record and `docs/atlas/dataverse-akoya-request.md`:

| PART 1 field (LLM extracts) | Authoritative source on `akoya_request` |
|---|---|
| TITLE | `akoya_title` |
| PRINCIPAL_INVESTIGATOR | `wmkf_projectleader` (→ contact) |
| CO_INVESTIGATORS / COUNT | `wmkf_copi1..5` (legacy slots) / `wmkf_apprequestperson` junction (canonical since S139) |
| AUTHOR_INSTITUTION | `akoya_applicantid` (→ account) |
| PROGRAM_AREA | `wmkf_grantprogram` / `wmkf_programareaserved` / `akoya_programid`; also `wmkf_mrconcept1title` |
| ABSTRACT | `wmkf_abstract` (WMKF-added) |

**Why the redundancy exists (historical):** the reviewer finder was originally a
standalone **PDF-upload** tool with no request context, so PART 1 had to pull everything
from the PDF. The **Dataverse-native entry path came later** — `load-proposal.js`
describes itself as "the new Dataverse-native entry path (replacing PDF upload)" and
resolves by `requestId`. The finder now *has* the request record but the analyze prompt
was never refactored to use it, so it keeps re-deriving what's already there.

**Consequences:** (a) redundant; (b) less reliable than a lookup to a contact/account
record — and the direct cause of this crash class; (c) a **COI-accuracy** risk — the
same-institution exclusion depends on the PI's institution, currently the LLM's guess off
the PDF rather than the authoritative `akoya_applicantid`.

What the LLM is genuinely still needed for: understanding the science
(PRIMARY/SECONDARY_RESEARCH_AREA, methodologies, keywords) and generating the reviewer
suggestions (PART 2). (Some AI fields like `wmkf_ai_keywords`/`wmkf_ai_methodologies`
exist on the request too but may not always be populated.)

## Implemented fix

1. `ReviewerSearchSection` now includes `requestId` in the analyze POST body; the analyze
   route now fails early if it is missing.
2. `/api/reviewer-finder/analyze` loads trusted request metadata through
   `loadReviewerRequestContext()` before calling Claude.
3. `reviewer-request-context.js` reads title / PI / Co-PIs / institution / program /
   abstract from Dataverse. Program uses `akoya_programid` first, then older fallback
   fields, but is only overlaid into `proposalInfo` for downstream save compatibility;
   Co-PIs come from `wmkf_apprequestperson`.
4. `composeAnalyzePrompt()` prepends a trusted metadata block and slims stale prompt
   bodies for request-backed analysis, so Dataverse/user prompt rows cannot keep asking
   the model to infer TITLE / PI / Co-PIs / institution / abstract. Program area is omitted
   from the prompt entirely.
5. `ClaudeReviewerService.analyzeProposal()` overlays the trusted metadata after parsing,
   preserving the existing `proposalInfo` shape for discovery, enrichment, and save.
6. `reviewer-suggestion.js` uses `normalizeSuggestionProgramArea()` instead of truncation
   across create/update/fill/bulk lifecycle paths.

## Pointers (so the next session needn't re-probe)

- Analyze prompt template + parser: `shared/config/prompts/reviewer-finder.js`
  (`createAnalysisPrompt`, `parseAnalysisResponse`, `ANALYZE_USER_PROMPT_TEMPLATE`).
- Prompt resolution (Dataverse override): `lib/services/prompt-store.js`
  (`wmkf_ai_prompts`, filter `wmkf_ai_promptname eq 'reviewer-finder.analyze' and
  wmkf_ai_iscurrent eq true`), `lib/services/reviewer-prompt-resolver.js`.
- Trusted request metadata: `lib/services/reviewer-request-context.js`.
- Write chokepoint + normalizer: `lib/dataverse/adapters/reviewer-suggestion.js`
  (`normalizeSuggestionProgramArea`, `upsert`, `ensureApplicantRecommended`,
  `updateLifecycle`).
- Request field inventory: `docs/atlas/dataverse-akoya-request.md`.
- Running the analyze standalone under node is blocked by extensionless imports (Next
  resolves them; raw node can't) — reproduce via the inlined-prompt approach or drive the
  deployed app.
