---
title: Reviews Tab — Phase II Writeup "Reviews" Paragraphs (2026-09-14)
domain: reviewer-workbench
kind: plan
status: proposal
summary: "Bring the Summarize Peer Reviews output (review count, grade tally, underlined reviewer roster with rank, expertise sentence, tone/themes, ordered quotations) into the Request Workbench Reviews tab, composed from Dataverse reviewer identity and stored ratings instead of uploaded PDFs. Deterministic sentences first; two new model fields inside the existing synthesis second; Word export third; the same deterministic text fills [[STAFF:RefereeSection]] in the Pre-Site Visit draft fourth. Owner decisions W1–W5 decided 2026-09-14."
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
5. **Quotations.** One per reviewer, most positive to most critical (model), with the house
   lead-ins from the old app (`shared/config/prompts/peer-reviewer-dynamics.js:78-82`).

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

### 4.2 Deterministic composer (new pure module)

`shared/utils/review-writeup-paragraphs.js` `[PROPOSED]`, pure, unit-tested, shared by the tab,
the Word report, and the Pre-Site Visit fill (Slice 4):

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
  `ReviewsTab.js`) → `wmkf_primaryaffiliation` → `wmkf_organizationname` → "institution not
  recorded" so the editor notices. Department omitted (W1). Clauses joined with semicolons and a
  final "and".
- `composeExpertiseSentence(reviewers)` → "Nadell has expertise in X, Y, and Z, while Breitbart has
  expertise in …" Last name from `wmkf_lastname`, falling back to the final token of `wmkf_name`.
  Areas from `wmkf_keywords` split on `;`, falling back to `wmkf_areaofexpertise`, first three
  areas, first letter lowercased. Reviewers with no expertise data are omitted; the sentence is
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

### 4.3 Model fields (Slice 2)

Extend `synthesis` with:

```json
"writeupThemes": "2-3 sentences in a neutral academic register on the overall tone of the reviews and themes shared across reviewers, suitable for a foundation writeup",
"writeupQuotations": [
  { "stance": "most_positive" | "middle" | "most_critical", "quote": "verbatim sentence or clause from one reviewer's written answers" }
]
```

Rules added to the system prompt: one quotation per submitted reviewer; order most positive to
most critical, using the numeric `overallAssessment` answer values in the digest to break ties;
quotes verbatim from `Answer text`, no paraphrase, no ellipsis inside a quote; still no names, no
HTML, no markdown. The code turns `stance` into the house lead-ins ("The most positive reviewer
said:", "Another reviewer noted:", "The most critical reviewer noted:"), so attribution never
depends on the model naming anyone.

Co-edited set (one commit): prompt `SYSTEM_PROMPT`; `jsonSchema.properties.synthesis` gains both
fields (`required` list unchanged so older rows still validate on read); `validationSchema` caps
`writeupThemes` at 1,500 chars and `writeupQuotations` at 12 items × 600 chars (keeps the memo
well under 20,000 with the existing caps); `parseReviewSynthesis` in `reviewers-service.js:131`
passes both fields through with defaults `''` / `[]`; `review-report.js` `synthesisSection` gains
them; `docs/atlas/dataverse-akoya-request.md:83` and the wiki section at
`docs/agent-wiki/topics/reviewer-workbench-lifecycle.md:1347` record the seven-key shape;
`docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` Phase 4 gets a dated addendum.

Because the hash excludes the prompt, existing syntheses remain `current: true` without the new
fields. UI rule: when `synthesis` is current but `writeupThemes` is empty, the writeup block shows
the three deterministic sentences and a "Regenerate synthesis to add themes and quotations" hint
on the existing Regenerate control. Not an error, not a staleness flag. The automatic drain will
not refill them on its own (it only fires on hash change), so pre-existing requests need a manual
regenerate.

Production reseed of the `review-synthesis.generate` row is an **owner** step, run from the main
checkout against production only after the merge deploys the reading code:

```bash
node scripts/seed-review-synthesis-prompt.js --dry-run
node scripts/seed-review-synthesis-prompt.js --execute
```

Order matters the other way from wave10: here the new code tolerates the old row (fields absent →
empty), and the old code tolerates the new row (`parseReviewSynthesis` strips unknown keys), so
either order is safe; reseed after deploy is simply cleaner.

### 4.4 Rendering and copy (Slices 1 and 3)

- Tab: a separate **"Writeup paragraphs"** card directly below the Synthesis card (W4). Sentences
  1–3 render as soon as one review is submitted; themes and quotations render when the stored
  synthesis carries them, otherwise a one-line hint points at the existing Regenerate control.
  Names render as `<u>` from runs, never from model strings; every model string is escaped as
  text. The primary action is **Copy**, writing `text/html` (with `<u>`) and `text/plain` via the
  async clipboard API so Word keeps the underlines. The card's staleness is never shown for the
  deterministic sentences; the Synthesis card's stale banner stays where it is.
- Word panel-prep export: a "Reviews (writeup)" section using `TextRun({underline:{}})` for name
  runs and plain runs for model strings. Cheap, and the underline survives.
- PDF: no change. The PDF flattener has no underline support and PDF is not a destination for
  this text (owner 2026-09-14).

### 4.5 Pre-Site Visit draft fill (Slice 4) `[PROPOSED]`

Reuse the deterministic sentences to fill `[[STAFF:RefereeSection]]` in the Phase II Pre-Site
Visit Word draft, following the Institutional Funding History precedent:

- Move `[[STAFF:RefereeSection]]` from `MANUAL_PLACEHOLDERS` to a filled-or-preserved token: filled
  when the referee text is supplied, otherwise left in place exactly as today (the "lost
  placeholder" assertion keeps protecting the unfilled case).
- Fill rule: compose only when `evaluateReviewSynthesisReadiness` reports `ready` for the request
  (every participating reviewer resolved, at least one submitted). Otherwise leave the token and
  attach a `referee_section_manual` note modelled on `funding_history_manual`
  (`artifact-service.js:313`), cleared on regeneration. Partial rosters must never render into a
  board-facing document.
- Content: sentences 1–3 only. Model themes and quotations stay tab-only; the synthesis prompt is
  tuned for panel prep, not board prose.
- Underline: reviewer names join the `personnelNames` list handed to the renderer
  (`artifact-service.js:376-377`), which already splits filled text into underlined runs.
- Snapshot: bump the input snapshot to v4 with a `refereeSection` field so the fingerprint and
  regeneration-diff logic see the fill; follow the v3 (S467) addition at `artifact-service.js:767`.
- Regeneration lock is unchanged: a draft already promoted to the Site Visit workspace is not
  touched.

Open measurement before building Slice 4: how often is the draft first generated before the last
review lands? If usually, the fill rarely fires on first generation and staff will rely on
Copy from the tab plus a regenerate; that is acceptable but should be known, not assumed.

## 5. Owner decisions (all decided 2026-09-14)

| # | Decision | Outcome |
|---|---|---|
| W1 | Reviewer clause form and institution precedence | `<u>Name</u>, a professor at Institution`; rank included (lowercase, a/an), department omitted; institution `wmkf_maininstitution` → accept-time affiliation → `wmkf_primaryaffiliation` → `wmkf_organizationname`; separate expertise sentence keyed by last name, three areas each. |
| W2 | Score sentence | Overall rating only, tallied: "with scores of two Excellent and one Fair". No unrated clause (ratings are required at submit). |
| W3 | Read-time composition vs snapshot | Read-time. The Word writeup is frozen and versioned by staff and is the record. |
| W4 | Placement and exports | Separate "Writeup paragraphs" card with Copy (rich text) as the primary action; section added to the Word export; no PDF work. |
| W5 | Expertise source | `wmkf_keywords` / `wmkf_areaofexpertise` (enrichment-derived, unedited by staff) is acceptable; the human editor verifies. |
| W6 | Template the Pre-Site Visit `[[STAFF:RefereeSection]]` from the same sentences | Yes, as Slice 4, deterministic sentences only, filled only when all participating reviews are in. |

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
`reviews-tab.test.js` (regenerate hint state). Gates: `check:prompt-injection-tagging`,
`check:fact-consistency`, `check:atlas`, `check:agent-wiki`, `check:doc-currency`. Owner reseeds
production after deploy (§4.3) and regenerates one live request to eyeball the paragraphs.

**Slice 3 — Word export section.** `review-report.js` (section) and `review-report-docx.js`
(underlined name runs). Tests: `review-report.test.js`, `review-report-renderers.test.js`.

**Slice 4 — Pre-Site Visit `[[STAFF:RefereeSection]]` fill (§4.5).** Files:
`lib/services/pre-site-visit/docx-renderer.js` (token class change), `artifact-service.js`
(readiness check, compose, snapshot v4, `referee_section_manual` note), and whichever loader
supplies reviewers to generation (reuse the Reviews read model or `loadReviewSynthesisContext`,
decided at build time after `/contract-reconcile`). Tests: `pre-site-visit-docx-renderer.test.js`
(filled and preserved cases, underline count), artifact-service snapshot/fingerprint tests,
readiness-gated fill. Gates: `check:types`, `check:atlas` (Pre-Site Visit artifact page),
`check:request-document-writers` if the artifact writer boundary is touched. Precondition:
the timing measurement in §4.5.

## 7. Risks and constraints

- **Blank identity fields.** Reviewers accepted before S308, or never asked, have no
  `wmkf_maininstitution` / `wmkf_academicrank`. The precedence chain degrades to the affiliation
  text the tab already shows and the clause drops its rank; the editor fills gaps. Print the count
  of blank fields in the Slice 1 smoke so the fallback rate is known, not assumed.
- **Institution wording.** Self-reported institutions are formal names; the example uses "MIT" and
  "Dartmouth". The editor shortens; no abbreviation table is proposed.
- **Expertise truncation.** `wmkf_areaofexpertise` is clamped to 100 chars; prefer `wmkf_keywords`.
  Areas are the Reviewer Finder model's phrasing, capped at three per reviewer.
- **Board-facing fill (Slice 4).** The referee sentences enter a board-facing document. The fill
  is gated on full readiness and otherwise leaves the manual token with a note, matching the
  funding-history fail-closed posture; it never renders a partial roster.
- **Enrichment-derived expertise** may be wrong or a namesake's. Accepted by the owner because a
  human edits the text. The Reviewer Finder nulls it on untrusted identity, so the clause simply
  disappears for those people.
- **Static rating labels.** `labelForReviewRating` uses the shipped form schema; the admin
  question editor can change the live set (an older "impact" picklist may appear during
  expand/rollback). The tab already accepts this tradeoff; a value with no label is skipped from
  the tally and surfaced as a tab warning rather than turned into a word.
- **Quotations are reviewer-authored text echoed back and persisted.** They stay inside the
  A7-wrapped path on the way in and are rendered as escaped plain text everywhere on the way out.
  Verbatim quoting raises the chance of a reviewer recognising their own words if the writeup ever
  leaves the Foundation; that is the current practice with the standalone app and is unchanged.
- **Memo size.** New caps plus the existing five keys must stay under the 20,000-char memo. The
  validation schema strips before write, so an over-long model answer is truncated, not failed.
- **Two digest composers.** Do not add the new identity fields to either digest call site; if a
  future change wants them in the model input, change both and accept that every stored synthesis
  goes stale.
- **Dataverse select of a column.** All four columns already exist in production (wave10 and the
  original entity); no deploy-order hazard like wave10/wave11.

## 8. Out of scope

Retiring or changing the standalone Summarize Peer Reviews app; the questions-for-PI output;
Risk rating prose; the Keck-history clause; per-request snapshotting of person identity; PDF
rendering; touching the automatic drain; filling the other four `[[STAFF:…]]` tokens.
