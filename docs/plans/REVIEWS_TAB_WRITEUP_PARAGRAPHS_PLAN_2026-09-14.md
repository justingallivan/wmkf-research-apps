---
title: Reviews Tab — Phase II Writeup "Reviews" Paragraphs (2026-09-14)
domain: reviewer-workbench
kind: plan
status: in-progress
summary: "Bring the Summarize Peer Reviews output (review count, grade tally, underlined reviewer roster with rank, expertise sentence, tone/themes, ordered quotations) into the Request Workbench Reviews tab, composed from Dataverse reviewer identity and stored ratings instead of uploaded PDFs. Deterministic sentences first; two new model fields inside the existing synthesis second; Word export third; the same deterministic text fills [[STAFF:RefereeSection]] in the Pre-Site Visit draft fourth. Owner decisions W1–W8 decided 2026-09-14. Build record in the header note."
cataloged: 2026-09-14
owner: product-engineering
last_verified: 2026-09-14
related:
  - docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md
  - docs/atlas/dataverse-akoya-request.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
  - docs/EXECUTOR_CONTRACT.md
  - shared/config/prompts/review-synthesis.js
  - shared/config/prompts/peer-reviewer-dynamics.js
  - lib/services/review-manager/reviewers-service.js
  - lib/services/review-manager/synthesize-reviews-service.js
  - lib/services/pre-site-visit/docx-renderer.js
  - lib/services/pre-site-visit/funding-history.js
---

# Reviews Tab — Phase II Writeup "Reviews" Paragraphs

> Plan, not a commitment. Claims about current code are `[VERIFIED 2026-09-14 via source]` unless
> labelled otherwise; the build is `[PROPOSED]`. Written from a read-only exploration session on
> branch `claude/explore-2026-09-14`; no code changed. Next step before any build: a
> `/contract-reconcile` pass on this plan (repo precedent: the consultant-feedback plan took three
> Codex adversarial rounds before build). Owner decisions W1–W6 were made in the same session.
> **`/contract-reconcile` pass 1 (2026-09-14, Fable):** verdict READY WITH NAMED CHANGES; all six
> named changes are folded into §4.2–§4.5 and §6 (caps are hard failures; separate referee
> underline pass; snapshot v4 with legacy note; both fields `required` + read-boundary
> allowlist; request-scoped roster export; accepted-only "outstanding" naming).
> **Codex adversarial review AR-1 (2026-09-14, `--base 187b337c`):** six findings, all accepted by the
> owner and folded in: read-boundary quote provenance (no reviewer ordinal in the digest); caps and
> population budget made tolerant with W7 opened; `--force` republish for the production prompt row;
> explicit filled-or-preserved token assertion; `active_invitation` allowlist for "outstanding";
> renderer `{docx, diagnostics}` contract and the two v3-only diagnostics consumers added to the v4
> site list.
> **Build record:** Slice 1 built at 95e9a750 (Sonnet), Opus review APPROVE 2026-09-14 with
> non-blocking follow-ups folded into the Slice 2 commit (acronym-safe lowercasing, article for
> "University Professor", escaping fixture on a non-underlined field, precedence fall-through when
> the accept-time affiliation strips to empty, Copy label reset on content change).
> Slice 1 follow-ups e0fa4ccf; Slice 2 built at a9757f18 (Sonnet), Opus review APPROVE 2026-09-14,
> non-blocking follow-ups folded into the Slice 3 commit (export roster sorted like the tab before
> the renderer prints quotations; fall-through fixtures; `answerText`-not-`answerHtml` pin).
> Slice 3 built at a13d4f43 (Sonnet), Opus review APPROVE 2026-09-14; non-blocking: pin an explicit
> `'en'` locale in `compareReviewersByName` (folded into Slice 4).
> Slice 4 built at 6be66be0 (Sonnet), Opus review APPROVE 2026-09-14; non-blocking items folded
> into a wrap-up commit (double-token fixture, blank referee text treated as null, reason-enum
> export for the blocker test, denominator on the personnel-warning assertion, unlabelled-rating
> diagnostic in the referee section, split roster-read vs composer error codes, roadmap wiki v4).
> Wrap-up 9b378529; full-suite reconciliation d7746daa (reviewer-engagement census recorded caller,
> native-schema payload fixture). **Codex adversarial review AR-2 of the build (`--base 1b2f9b5c`,
> 2026-09-14):** three medium findings, all verified and fixed at 65b40a4e — quote verification now
> narrative-only, word-bounded, ≥6 words (picklist labels live in `answerText`,
> `lib/external/build-review-submission.js:219`); `getWriteupRoster` name-sorts so tied ratings
> order identically on tab, export and draft; Copy has a generation guard on both post-await
> writes. Remaining owner steps: production `--force` republish of `review-synthesis.generate`
> (§4.3), Slice 1 production smoke (§6), merge. Pre-existing unrelated red test:
> `tests/unit/grantee-abstract-editor.test.js` (fails identically at base).

## 1. Goal

Staff writing a Phase II writeup paste a "Reviews" section that today comes from the standalone
**Summarize Peer Reviews** app (`peer-review-summarizer`). That app extracts everything from
uploaded review PDFs with a model. The Request Workbench Reviews tab already holds the same facts
as structured data. The goal is to produce the same paragraphs on the Reviews tab, in the WMKF
house form, from stored data, with a copy affordance. A human edits the text before it lands in
the writeup, so stored fields are acceptable even when they are enrichment-derived (owner,
2026-09-14).

## 2. The target text

The owner supplied a recent hand-written example (2026-09-14, Keck-history clause removed because
a human added it as context):

> We received three reviews with scores of Excellent, Excellent, and Fair. The reviewers were
> Otto X. Cordero, a professor at MIT; Carey Nadell, an associate professor at Dartmouth; and Mya
> Breitbart, a professor at the University of South Florida. Nadell has expertise in microbial
> ecology, evolutionary dynamics, and bacterial community interactions, while Breitbart has
> expertise in viral ecology, marine microbiology, and phage-host interactions. Cordero has
> expertise in microbial ecology and environmental microbiology.

Names are underlined in the real document (formatting was stripped in the example). The owner
prefers the tallied score form of the old app ("two of Excellent and one of Fair") over the
per-review list. The decided target, in order:

1. **Count and scores.** "We received three reviews with scores of two Excellent and one Fair."
2. **Reviewers.** "The reviewers were <u>Name</u>, a professor at Institution; <u>Name</u>, an
   associate professor at Institution; and <u>Name</u>, a professor at Institution." Rank
   lowercased with a/an; department omitted; institution as stored (the editor shortens
   "Massachusetts Institute of Technology" to "MIT" if wanted).
3. **Expertise.** "Nadell has expertise in X, Y, and Z, while Breitbart has expertise in …" One
   clause per reviewer with expertise data, keyed by last name.
4. **Tone and themes.** Two to three sentences (model).
5. **Quotations.** Three representative quotes, most positive to most critical, at most one per
   reviewer (model proposes, server verifies and selects), with the house lead-ins from the old app
   (`shared/config/prompts/peer-reviewer-dynamics.js:78-82`).

Out of scope: the old app's bulleted questions output (the review form's Q8 already asks
reviewers for questions to raise with the PI and the tab shows those answers), Risk-rating prose,
and the Keck-history clause.

## 3. What exists today `[VERIFIED 2026-09-14 via source]`

| Ingredient | State | Where |
|---|---|---|
| Review count | Present. `p.reviewers` filtered by `reviewReceivedAt`. | `lib/services/review-manager/reviewers-service.js:450` |
| Numeric overall rating per reviewer | Present. `reviewerOverallAssessment` from the `wmkf_appreviewanswer` snapshot. | `reviewers-service.js:440` |
| Number → label adapter | Present. `labelForReviewRating('overallAssessment', 5)` → "Excellent" … "Poor" from the static form schema (5/4/3/2/1). Set-aware `labelForOption` also exists. The tab already decodes ratings this way. | `lib/external/review-form-schema.js:129-140,190-225`; `ReviewsTab.js:75` |
| Reviewer name | Present. `person.wmkf_name`. | `reviewers-service.js:342` |
| Reviewer institution | Present, two sources: suggestion-row `wmkf_revieweraffiliation` (accepted-reviewer free text, may carry a trailing email that `reviewerAffiliationOf` strips in the tab) and person `wmkf_primaryaffiliation` / `wmkf_organizationname`. | `reviewers-service.js:343,413`; `ReviewsTab.js:41-60` |
| Board-writeup identity: `wmkf_maininstitution`, `wmkf_primarydepartment`, `wmkf_academicrank` | Exist on `wmkf_potentialreviewers`; self-reported (UI-required) at Stage 2a accept since S308 and staff-editable in the candidate edit modal. RequiredLevel None in Dataverse, so reviewers accepted before S308 or created by enrichment only may be blank. **Not selected by the Reviews read model today.** | `docs/atlas/dataverse-wmkf-potentialreviewers.md:52`; `reviewers-service.js:575` (select list) |
| Expertise: `wmkf_areaofexpertise` and `wmkf_keywords` | Both written only by Reviewer Finder save from the model's "Expertise:" line, areas joined with `; `; nulled when identity is untrusted or PD-confirmed. `wmkf_areaofexpertise` is clamped to 100 chars; `wmkf_keywords` (Memo) holds the same string unclamped. No staff edit path. Neither is selected by the Reviews read model. | `lib/dataverse/adapters/potential-reviewer.js:53,182,283,399`; `lib/services/reviewer-finder/save-candidates-service.js:1011,1072,1492` |
| Last name | `wmkf_lastname` on the person (adapter writes first/last alongside `wmkf_name`). | `potential-reviewer.js:172-173,190` |
| Ratings required at submit | The submit producer asserts both core ratings (`riskLevel`, `overallAssessment`) are present and in-domain, so a submitted review always has an Overall score; a null can only come from a legacy row. | `lib/external/review-form-schema.js:182` (`CORE_RATING_KEYS`) |
| Pre-Site Visit draft tokens | Template renderer fills `[[AI:…]]` from the model and `[[DV:…]]` from Dataverse; five `[[STAFF:…]]` tokens, including `[[STAFF:RefereeSection]]`, are asserted to survive unfilled for staff. `[[AI:InstitutionalFundingHistory]]` is the precedent for a deterministic Dataverse sentence in that document: composed in `funding-history.js`, fails closed on inconsistent data, and drafts generated before the fill carry a `funding_history_manual` note. The renderer underlines a supplied list of personnel names inside filled text. Input snapshot v3 (S467) fingerprints the fills; regeneration locks once the draft becomes the Site Visit workspace. | `lib/services/pre-site-visit/docx-renderer.js:26-58,155-224,427-431`; `funding-history.js:1-40`; `artifact-service.js:313,376-377,767,1051-1075` |
| Tone / themes | Partly. Synthesis yields `consensus`, `disagreements`, `keyConcerns`, `ratingSummaries`, `overall` as plain-text panel-prep bullets. No writeup-voice paragraph. | `shared/config/prompts/review-synthesis.js` |
| Quotations | Absent. Prompt forbids HTML and reviewer names; asks for no quotes. | `review-synthesis.js:56-57` |
| Storage | One JSON memo `akoya_request.wmkf_reviewsynthesisjson` (20,000 chars), `guard: always-overwrite`, shape-sanitised on read by `parseReviewSynthesis`. | `docs/atlas/dataverse-akoya-request.md:83`; `reviewers-service.js:131-145` |
| Currency | `inputHash` = SHA-256 of `{version:1, contentHash, participants}`; `contentHash` hashes the digest (reviewer name, suggestion-row affiliation, answers). **The prompt text and output shape are not part of the hash.** | `lib/services/review-synthesis-readiness.js:173-177`; `lib/services/review-synthesis-content.js` |
| Digest composers | Two call sites build the same digest and must agree byte-for-byte: read model (`reviewers-service.js:450-457`) and generator (`synthesize-reviews-service.js:176-183`). | |
| Renderers | DOCX renders synthesis as `TextRun`s (underline available via `docx`). PDF flattens inline runs to plain text; no underline support today. | `shared/utils/review-report-docx.js:156-210`; `review-report-pdf.js:29-35` |
| Pinned prompt contract | Unit test asserts exactly one override variable (`reviews_digest`) and exactly one output (`synthesis`, JSON, native schema, always-overwrite). Seed script imports `SYSTEM_PROMPT`, `USER_PROMPT_TEMPLATE`, `PROMPT_VARIABLES`, `PROMPT_OUTPUT_SCHEMA` from the prompt source, so source and live row cannot drift after a reseed. | `tests/unit/review-synthesis-prompt-config.test.js`; `scripts/seed-review-synthesis-prompt.js:55-84` |

## 4. Design `[PROPOSED]`

### 4.1 Split deterministic from model-authored

Sentences 1–3 are composed in code from stored data. No model, no digest change, no hash churn,
and the synthesis prompt's "never name a reviewer" rule stays intact because the model never needs
names. Sentences 4–5 are model-authored and become two new fields **inside** the existing
`synthesis` object, so the pinned one-variable / one-output contract holds.

### 4.2 Deterministic composer (new pure module) — BUILT S1 (95e9a750)

`shared/utils/review-writeup-paragraphs.js` `[PROPOSED]`, pure, unit-tested, shared by the tab,
the Word report, and the Pre-Site Visit fill (Slice 4):

- Input filter: every composer takes only reviewers with `reviewReceivedAt` set, the same filter
  `digestReviewers` applies (`reviewers-service.js:451`); `p.reviewers` holds every status.
- `composeScoreSentence(reviewers)` → "We received three reviews with scores of two Excellent and
  one Fair." Tally `labelForReviewRating('overallAssessment', r.reviewerOverallAssessment)` in
  descending rating order; number words to twelve, digits above; "one review with a score of
  Excellent" for a single review. A null label (legacy row only, see §3) is skipped and noted in
  the tab as a warning rather than written into the sentence.
- `composeReviewerSentence(reviewers)` → one clause per submitted reviewer in descending rating
  order (ties keep the tab's order), as runs `[{text, underline}]` so renderers underline the name
  without HTML: `<u>Name</u>, a professor at Institution`. Rank from `wmkf_academicrank`,
  lowercased, article a/an by first letter; blank rank collapses the clause to `<u>Name</u> of
  Institution`. Institution precedence: `wmkf_maininstitution` → suggestion-row
  `wmkf_revieweraffiliation` (email suffix stripped; lift `reviewerAffiliationOf` out of
  `ReviewsTab.js`; if the strip leaves nothing, fall through rather than stop) →
  `wmkf_primaryaffiliation` → `wmkf_organizationname` → "institution not recorded" so the editor
  notices. Article a/an by first letter, with "University Professor" and similar vowel-initial
  consonant sounds handled by a small exception list. Department omitted (W1). Clauses joined with semicolons and a
  final "and".
- `composeExpertiseSentence(reviewers)` → "Nadell has expertise in X, Y, and Z, while Breitbart has
  expertise in …" Last name from `wmkf_lastname`, falling back to the final token of `wmkf_name`.
  Areas from `wmkf_keywords` split on `;`, falling back to `wmkf_areaofexpertise`, first three
  areas, first letter lowercased unless the second character is uppercase (acronyms such as "DNA
  repair" and "CRISPR screens" keep their case). Reviewers with no expertise data are omitted; the sentence is
  omitted when nobody has data. Pairs joined with "while"; a third or later reviewer starts a new
  sentence, as in the example.
- `composeWriteupParagraphs({reviewers, synthesis})` → the three deterministic sentences as runs
  plus `themes` and `quotations` when present, with plain-text and HTML serialisations for Copy.

Read model change: add `wmkf_lastname,wmkf_academicrank,wmkf_maininstitution,wmkf_areaofexpertise,wmkf_keywords`
to the person select at `reviewers-service.js:575` and project them as `lastName`, `academicRank`,
`mainInstitution`, `areaOfExpertise`, `keywords`. These fields are **not** added to the digest
(`digestReviewers` at :450 stays `{name, affiliation, answers}`), so stored syntheses stay current.

Composition is read-time (W3): the sentences follow later edits to the person record. The Word
writeup is frozen and versioned by staff and is the record; regeneration of a writeup is rare.

### 4.3 Model fields (Slice 2) — BUILT S2 (a9757f18)

Extend `synthesis` with:

```json
"writeupThemes": "2-3 sentences in a neutral academic register on the overall tone of the reviews and themes shared across reviewers, suitable for a foundation writeup",
"writeupQuotations": [
  { "questionKey": "<the question key the quote was taken from>", "quote": "verbatim sentence or clause copied exactly from one reviewer's Answer text" }
]
```

Rules added to the system prompt: **three representative quotations** (house rule of thumb, owner
2026-09-14; fewer when fewer than three reviews are submitted), at most one per reviewer, spanning
the most positive to the most critical review, each copied character-for-character from an
`Answer text` block (no paraphrase, no ellipsis, no stitching), at most about 60 words each;
themes at most about 120 words; still no names, no HTML, no markdown. The model does **not** rank
the quotes and carries no `stance` field: ordering and attribution are done server-side (below),
so nothing about the paragraph depends on the model naming or ranking anyone.

**Quote provenance is enforced at the read boundary, not trusted (Codex AR-1 finding 1).** Neither
the native JSON schema nor `validateAiJson` can prove a string is a substring of a review
(`lib/utils/ai-output-schema.js:48-83`). The Reviews read model already holds every submitted
reviewer's `answers[].answerText` alongside the stored synthesis (`reviewers-service.js:430-441`),
so `composeWriteupParagraphs` verifies each quotation there: normalise whitespace, straight/curly
quotes and apostrophes, and case; keep a quote only if it is a substring of exactly one submitted
reviewer's **narrative** answer text (richtext/string answers only — picklist and multiselect
rows store their option label in `answerText` and are excluded; any narrative answer of that
reviewer; the declared `questionKey` is carried for audit but not used for matching), matched at
word boundaries and only when the candidate is at least six normalised words (Codex AR-2); keep at most one verified quote per reviewer; order the survivors by that reviewer's
`reviewerOverallAssessment` descending (ties by the roster order); **keep three**: the highest-rated,
the lowest-rated, and the middle one (the median by rating) when more than three survive; derive
the house lead-ins from position ("The most positive reviewer said:", "Another reviewer noted:",
"The most critical reviewer noted:"). With one or two survivors the lead-ins collapse accordingly. Unverified or duplicate quotes are dropped and counted; the tab shows "N
quotation(s) could not be matched to a review and were omitted" so the editor knows. This keeps
the digest, the hash, and the write path unchanged: no reviewer ordinal is added to the digest.

Co-edited set (one commit): prompt `SYSTEM_PROMPT` (rules above); `jsonSchema.properties.synthesis`
gains both fields **and both join `required`** (Anthropic's native grammar then always emits them;
write-time validation is the only place `required` matters, the read path is `parseReviewSynthesis`);
`validationSchema` entries `required:false` with defaults `''` / `[]`, caps `writeupThemes` 2,000
chars, `writeupQuotations` `maxItems` 10 (the prompt asks for three; headroom for a non-compliant
answer without failing the run) × `quote` 600 chars (~100 words against the prompt's 60),
`questionKey` 100 chars. **A cap is a hard failure, not a
truncation**: `validateAiJson` fails on `maxLength`/`maxItems` and the Executor throws
`claude_output_schema_invalid`, which the service does not retry
(`ai-output-schema.js:65-66`, `execute-prompt.js:908-917`, `synthesize-reviews-service.js:297-300`)
— hence caps well above the prompt's asks. **Caps live in `validationSchema` only.** The LLM
client forwards the declared `jsonSchema` to Anthropic untouched (no keyword stripping in
`lib/services/llm-client.js`; `execute-prompt.js:807-812` passes it as `format.schema`), and the
existing synthesis `jsonSchema` carries no `maxItems`/`maxLength` — all bounds are local. Slice 2
keeps that pattern so no unsupported keyword reaches the provider grammar `[VERIFIED 2026-09-14]`. `parseReviewSynthesis` (`reviewers-service.js:131-160`,
the read trust boundary; strips unknown keys, never throws) gains `writeupThemes` (string or `''`)
and `writeupQuotations` (objects with string `quote` and string `questionKey`, everything else
dropped). `review-report.js` `synthesisSection` gains the **verified** quotations and themes (the
report composer receives the already-verified list); `docs/atlas/dataverse-akoya-request.md:83` and
the wiki section at `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md:1347` record the
seven-key shape; `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` Phase 4 gets a dated addendum.

Population and budget (Codex AR-1 finding 2): nothing bounds a request's reviewer count except the
Dataverse row cap (`reviewer-suggestion.js:1591-1619`), and `reviews_digest` is truncated at 60,000
chars by the payload boundary (`review-synthesis.js:73-84`, `ai-payload-boundary.js:79-103`), so a
very large panel may not be fully seen by the model. Both are **pre-existing** properties of the
synthesis; the new contract tolerates them because a missing or unverifiable quote is dropped, not
required, and the paragraph simply has fewer quotes. Realistic WMKF panels are three to six
reviewers. `wmkf_reviewsynthesisjson` is a 20,000-char memo with no total-length guard in the
Executor (grep of `execute-prompt.js` returns nothing); the five existing keys' caps already exceed
it in the worst case and the new caps add at most 9,000 more in theory. **W7 decided (owner
2026-09-14): accept the unchanged posture** — an over-long write fails at Dataverse and surfaces as
a failed generation, as today; no service-side preflight, which would also break the existing
panel-prep synthesis for large panels.

Because the hash excludes the prompt, existing syntheses remain `current: true` without the new
fields. UI rule: when `synthesis` is current but `writeupThemes` is empty, the writeup block shows
the three deterministic sentences and a "Regenerate synthesis to add themes and quotations" hint
on the existing Regenerate control. Not an error, not a staleness flag. The automatic drain will
not refill them on its own (it only fires on hash change), so pre-existing requests need a manual
regenerate.

**Production publish of the prompt row is an owner step** and the seed script is create-only by
default: `planSeed` returns `refuse` whenever a row exists and `--force` was not passed
(`lib/services/prompt-seed.js:58-65`), and a sole-current v3 row is documented in production
(`docs/atlas/dataverse-akoya-request.md:83`), so a plain `--execute` exits without publishing
(Codex AR-1 finding 3). Use the force path, which publishes version max+1 and keeps exactly one
current row, from the main checkout after the merge deploys the reading code:

```bash
node scripts/seed-review-synthesis-prompt.js --dry-run --force
node scripts/seed-review-synthesis-prompt.js --execute --force
```

Then confirm one current row at the expected version (the script prints the plan), regenerate one
live request, and eyeball the paragraphs. The admin Prompt Templates publisher
(`pages/api/admin/prompts/[name].js`) is the alternative governed path for the text; it cannot
change the tracked output schema, so the script is the right tool here. Either deploy order is
safe: new code tolerates the old row (fields absent → empty), old code tolerates the new row
(`parseReviewSynthesis` strips unknown keys).

### 4.4 Rendering and copy (Slices 1 and 3) — BUILT S1/S3 (95e9a750, a13d4f43)

- Tab: a separate **"Writeup paragraphs"** card directly below the Synthesis card (W4). Sentences
  1–3 render as soon as one review is submitted; themes and quotations render when the stored
  synthesis carries them, otherwise a one-line hint points at the existing Regenerate control.
  Names render as `<u>` from runs, never from model strings; every model string is escaped as
  text. The primary action is **Copy**, writing `text/html` (with `<u>`) and `text/plain` via the
  async clipboard API so Word keeps the underlines (`ClipboardItem` with `text/html` is
  `[ASSUMED]` supported in current Chrome, Edge and Safari; the plain-text write is the fallback). The card's staleness is never shown for the
  deterministic sentences; the Synthesis card's stale banner stays where it is. Dropped
  (unverified/duplicate) quotations surface as a one-line count on the card (§4.3).
- Word panel-prep export: a "Reviews (writeup)" section using `TextRun({underline:{}})` for name
  runs and plain runs for model strings. Cheap, and the underline survives.
- PDF: no change. The PDF flattener has no underline support and PDF is not a destination for
  this text (owner 2026-09-14).

### 4.5 Pre-Site Visit draft fill (Slice 4) — BUILT S4 (6be66be0)

Reuse the deterministic sentences to fill `[[STAFF:RefereeSection]]` in the Phase II Pre-Site
Visit Word draft, following the Institutional Funding History precedent:

- Token contract: move `[[STAFF:RefereeSection]]` from `MANUAL_PLACEHOLDERS` to a new
  `CONDITIONAL_PLACEHOLDERS` set with an explicit filled-or-preserved assertion (Codex AR-1 finding
  4: the existing "lost placeholder" loop iterates only `MANUAL_PLACEHOLDERS`,
  `docx-renderer.js:429-431`, and the required-token loop covers only AI/DV tokens, `:426-427`, so
  simply removing it would let an empty replacement erase the token silently). When referee text is
  absent: assert the token survives exactly once. When supplied: assert replacement count is exactly
  one and the token is absent afterwards. Both cases tested against the real template.
- Roster source: generation has no reviewer data today; the seam is `dependencies.loadInputs`
  (`artifact-service.js:77,1083`), and the route already runs under `requireAppAccess('reviewers')`
  inside `withDalContext` (`pages/api/workbench/pre-site-visit.js:70,75`). `getReviewers` is the
  only export of the Reviews service and is caller-scoped (`scope`, `azureEmail`), so add a
  request-scoped export `getWriteupRoster({ requestId })` in `reviewers-service.js` that reuses the
  person select, the ratings derivation (`ratingsFromAnswers`) and the readiness blockers, and call
  it from `loadPreSiteVisitInputs`. The snapshot stores the **composed sentences** (plain text plus
  the list of reviewer names to underline), not the raw roster, so the fingerprint stays small and
  stable.
- Fill rule (owner 2026-09-14: reviews arrive both before and after deliberations begin, so put
  in what is known at generation): compose from the reviews **submitted at generation time**
  whenever at least one is in. When readiness reports blockers, append one qualifying sentence
  naming the outstanding reviewers: "A review from <u>Name</u> is outstanding." / "Reviews from
  <u>Name</u> and <u>Name</u> are outstanding." Name only blockers whose row is accepted
  (`accepted === true`, projected at `reviewers-service.js:495-505`) and whose reason is not
  `malformed_*` / `unknown_*`; blocker reasons also include never-issued or missing tokens
  (`review-synthesis-readiness.js:61-116`), which are not "a review outstanding" — those collapse
  to "One invitation is unresolved." plus a tab warning. The count sentence counts submitted
  reviews only ("We have received two reviews so far, with scores of …" when blockers exist; the
  plain form when none). When no review is submitted, leave the token and attach a
  `referee_section_manual` note modelled on `funding_history_manual` (`artifact-service.js:313`),
  cleared on regeneration.
- Naming rule is an **allowlist**, not a denylist (Codex AR-1 finding 5): a blocker is named as
  outstanding only when `accepted === true` **and** `reason === 'active_invitation'`
  (`review-synthesis-readiness.js:118`). Every other unresolved reason — `missing_current_token`,
  `missing_token_*`, `malformed_*`, `unknown_*` (`:61-110`) — collapses to a counted generic clause
  ("One invitation is unresolved." / "Two invitations are unresolved.") plus a tab warning. A
  table-driven unit test enumerates every reason string the readiness module can emit and asserts
  its bucket, so a new reason fails the test rather than falling into a sentence.
- Underline: the renderer's underline pass runs **only** on paragraphs containing the Personnel
  tokens (`docx-renderer.js:275-279,303-307`), and `prepareGeneratedCore` warns
  `personnel_name_not_matched` for any roster name absent from a Personnel section
  (`proposal-core-service.js:391`). So reviewer names must **not** join `personnelNames`. Add a
  separate `refereeNames` option and run `underlineTermsInParagraph` on the paragraph that
  contained `[[STAFF:RefereeSection]]`, counting underlines per name.
- Renderer diagnostics contract (Codex AR-1 finding 6): the renderer returns a bare Buffer today
  (`docx-renderer.js:413-432`) and the artifact service persists the diagnostics envelope **before**
  rendering (`artifact-service.js:1210-1224`), so an underline count found during rendering has no
  path to `WARNING_MESSAGES`. Change the renderer to return `{ docx, diagnostics }` and have the
  artifact service merge render diagnostics into the envelope before the artifact is marked ready.
  **Decided: write then update.** Generation persists the envelope, re-reads the draft via
  `persistedDraft`, renders, then issues a second `updateDocument` with the render fingerprint and
  content hash (`artifact-service.js:1190-1247`); that second update also rewrites
  `wmkf_presiteproposalcorejson` with the stored diagnostics ∪ render diagnostics (schemaVersion 4).
  The referee text and the names to underline travel in the v4 input snapshot and reach the
  renderer through `documentFieldsFromSnapshot` (`:797`) → `draft.documentFields`, so the regenerate
  path (draft already persisted, render only) gets the same inputs as first generation. Add
  `referee_name_not_matched` to `WARNING_MESSAGES` and the label map.
- Snapshot v4, following the S467 v3 precedent (commit e40ad309), now **six** sites plus the warning
  map: builder `schemaVersion: 4` (`artifact-service.js:241`) with a `refereeSection` field;
  `diagnosticsForRow` accepts `[2, 3, 4]` and maps v2/v3 rows to a `referee_section_manual` legacy
  note the way v2 maps to `funding_history_manual` (`:359,370,393`); `persistedDraft` strict check
  becomes `!== 4` (`:770`); writer (`:1221`); and **both** stored-diagnostics consumers that today
  admit diagnostics only when `schemaVersion === 3` (`:387-389`, `:792-795`) accept `[3, 4]` —
  otherwise every v4 diagnostic, including the new referee warnings, is discarded on read. Old
  drafts are unreachable from new generation keys by design (fingerprint changes), so nothing
  migrates.
- Regeneration lock is unchanged: a draft already promoted to the Site Visit workspace is not
  touched.

Timing (owner 2026-09-14): a toss-up whether reviews land before or after deliberations begin,
hence the partial fill with an outstanding clause rather than a readiness gate. Regenerating the
draft later refreshes the paragraph while the draft is still regenerable; once it is the Site
Visit workspace the editor updates Word by hand, helped by Copy on the tab.

## 5. Owner decisions (W1–W8 decided 2026-09-14)

| # | Decision | Outcome |
|---|---|---|
| W1 | Reviewer clause form and institution precedence | `<u>Name</u>, a professor at Institution`; rank included (lowercase, a/an), department omitted; institution `wmkf_maininstitution` → accept-time affiliation → `wmkf_primaryaffiliation` → `wmkf_organizationname`; separate expertise sentence keyed by last name, three areas each. |
| W2 | Score sentence | Overall rating only, tallied: "with scores of two Excellent and one Fair". No unrated clause (ratings are required at submit). |
| W3 | Read-time composition vs snapshot | Read-time. The Word writeup is frozen and versioned by staff and is the record. |
| W4 | Placement and exports | Separate "Writeup paragraphs" card with Copy (rich text) as the primary action; section added to the Word export; no PDF work. |
| W5 | Expertise source | `wmkf_keywords` / `wmkf_areaofexpertise` (enrichment-derived, unedited by staff) is acceptable; the human editor verifies. |
| W6 | Template the Pre-Site Visit `[[STAFF:RefereeSection]]` from the same sentences | Yes, as Slice 4, deterministic sentences only, filled from the reviews in hand at generation plus an "outstanding" sentence naming reviewers still to report. |
| W7 | Synthesis memo/population budget (§4.3): accept the unchanged fail-at-write posture, or add a service preflight refusing synthesis above N submitted reviews | Accept the unchanged posture; no preflight. |
| W8 | Number of quotations | Three representative quotes (most positive, middle, most critical), even when there are more than three reviewers; fewer when fewer reviews. Server selects by rating after provenance verification. |

## 6. Slices, tiers, verification `[PROPOSED]`

All slices are Tier 1 (feature branch, automated tests, owner merges) per
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`. No migration, no new route, no new table.

**Slice 1 — deterministic sentences + Copy (no prompt change).**
Files: `reviewers-service.js` (select + projection), new `shared/utils/review-writeup-paragraphs.js`,
`ReviewsTab.js` (card + Copy; lift `reviewerAffiliationOf` to the shared module).
Tests: new `tests/unit/review-writeup-paragraphs.test.js` (number words, tally order, single-review
grammar, a/an, blank rank, precedence chain, email-suffix strip, keywords→areaofexpertise fallback,
three-area cap, "while" pairing, omitted reviewers); extend `reviews-tab.test.js` (fixture churn:
`p.reviewers` gains five fields).
Gates: `check:types`, `check:atlas` (projection noted on the potentialreviewers Atlas page),
`check:dataverse-access-layer`, `check:route-service-boundary`.
Smoke: on a request with all reviews in, print the composed sentences and the count of blank
rank / institution / expertise fields so the fallback rate is known.

**Slice 2 — model fields.** Files listed in §4.3. Tests: extend
`review-synthesis-prompt-config.test.js` (still one variable, one output; new properties present
with caps), `synthesize-reviews-service.test.js` (old row without fields parses to defaults),
`reviews-tab.test.js` (regenerate hint state, dropped-quote count), and new provenance tests in
`review-writeup-paragraphs.test.js`: a paraphrased quote is dropped, a curly-quote/whitespace
variant of a real sentence is kept, two quotes from one reviewer keep one, ordering follows the
rating not the model's order, a quote matching two reviewers is dropped, five survivors reduce to
the top, median and bottom by rating. Gates: `check:prompt-injection-tagging`,
`check:fact-consistency`, `check:atlas`, `check:agent-wiki`, `check:doc-currency`. Owner reseeds
production after deploy (§4.3) and regenerates one live request to eyeball the paragraphs.

**Slice 3 — Word export section.** `review-report.js` (section) and `review-report-docx.js`
(underlined name runs). Tests: `review-report.test.js`, `review-report-renderers.test.js`.

**Slice 4 — Pre-Site Visit `[[STAFF:RefereeSection]]` fill (§4.5).** Files:
`lib/services/pre-site-visit/docx-renderer.js` (token class change), `artifact-service.js`
(compose from the loaded roster, snapshot v4 at the six sites, renderer `{docx, diagnostics}` contract, `referee_section_manual` note and
label), `reviewers-service.js` (new request-scoped `getWriteupRoster`), and
`loadPreSiteVisitInputs` (roster wired in). Tests: `pre-site-visit-docx-renderer.test.js`
(filled and preserved cases; reviewer names underlined in the referee paragraph and NOT in
Personnel sections; no `personnel_name_not_matched` for reviewer names), artifact-service
snapshot/fingerprint tests (v2/v3 legacy note, v4 strict claim check, v4 diagnostics admitted by
both consumers, `referee_name_not_matched` survives persistence and renders as a warning),
table-driven readiness-reason bucket test, token filled-or-preserved assertion in both cases,
partial fill with outstanding clause, zero-submitted manual note. Gates: `check:types`, `check:atlas` (Pre-Site Visit artifact page),
`check:request-document-writers` if the artifact writer boundary is touched.

## 7. Risks and constraints

- **Blank identity fields.** Reviewers accepted before S308, or never asked, have no
  `wmkf_maininstitution` / `wmkf_academicrank`. The precedence chain degrades to the affiliation
  text the tab already shows and the clause drops its rank; the editor fills gaps. Print the count
  of blank fields in the Slice 1 smoke so the fallback rate is known, not assumed.
- **Institution wording.** Self-reported institutions are formal names; the example uses "MIT" and
  "Dartmouth". The editor shortens; no abbreviation table is proposed.
- **Expertise truncation.** `wmkf_areaofexpertise` is clamped to 100 chars; prefer `wmkf_keywords`.
  Areas are the Reviewer Finder model's phrasing, capped at three per reviewer.
- **Board-facing fill (Slice 4).** The referee sentences enter a board-facing document from a
  possibly partial roster. The outstanding sentence makes the partial state explicit in the text
  itself, and the manual note covers the zero-submitted case. A reviewer who later declines or is
  released after generation leaves a stale "outstanding" sentence until regeneration or a hand
  edit; the tab card shows the live state.
- **Enrichment-derived expertise** may be wrong or a namesake's. Accepted by the owner because a
  human edits the text. The Reviewer Finder nulls it on untrusted identity, so the clause simply
  disappears for those people.
- **Static rating labels.** `labelForReviewRating` uses the shipped form schema; the admin
  question editor can change the live set (an older "impact" picklist may appear during
  expand/rollback). The tab already accepts this tradeoff; a value with no label is skipped from
  the tally and surfaced as a tab warning rather than turned into a word.
- **Quotations are reviewer-authored text echoed back and persisted.** They stay inside the
  A7-wrapped path on the way in, are verified as substrings of a real answer at the read boundary
  (§4.3), and are rendered as escaped plain text everywhere on the way out. A quote the model
  invents never reaches the paragraph; it is counted as dropped.
  Verbatim quoting raises the chance of a reviewer recognising their own words if the writeup ever
  leaves the Foundation; that is the current practice with the standalone app and is unchanged.
- **Schema caps fail the run.** `maxLength` is a hard validation failure, not a truncation, and it
  is not retried; a single over-long verbatim quotation would fail the whole synthesis. Mitigated
  by generous caps and the prompt's length instruction (§4.3). Memo-size exposure is pre-existing
  (§4.3).
- **Two digest composers.** Do not add the new identity fields to either digest call site; if a
  future change wants them in the model input, change both and accept that every stored synthesis
  goes stale.
- **Dataverse select of a column.** All four columns already exist in production (wave10 and the
  original entity); no deploy-order hazard like wave10/wave11.

## 8. Out of scope

Retiring or changing the standalone Summarize Peer Reviews app; the questions-for-PI output;
Risk rating prose; the Keck-history clause; per-request snapshotting of person identity; PDF
rendering; touching the automatic drain; filling the other four `[[STAFF:…]]` tokens.
