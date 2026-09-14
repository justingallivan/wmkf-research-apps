---
title: Reviews Tab — Phase II Writeup "Reviews" Paragraphs (2026-09-14)
domain: reviewer-workbench
kind: plan
status: proposal
summary: "Bring the Summarize Peer Reviews output (review count, grade tally, underlined reviewer roster, tone/themes, ordered quotations) into the Request Workbench Reviews tab, composed from Dataverse reviewer identity and stored ratings instead of uploaded PDFs. Deterministic sentences first; two new model fields inside the existing synthesis second; exports third. Owner decisions W1–W5 open."
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
---

# Reviews Tab — Phase II Writeup "Reviews" Paragraphs

> Plan, not a commitment. Claims about current code are `[VERIFIED 2026-09-14 via source]` unless
> labelled otherwise; the build is `[PROPOSED]`. Written from a read-only exploration session on
> branch `claude/explore-2026-09-14`; no code changed. Next step before any build: a
> `/contract-reconcile` pass on this plan (repo precedent: the consultant-feedback plan took three
> Codex adversarial rounds before build).

## 1. Goal

Staff writing a Phase II writeup paste a "Reviews" section that today comes from the standalone
**Summarize Peer Reviews** app (`peer-review-summarizer`). That app extracts everything from
uploaded review PDFs with a model. The Request Workbench Reviews tab already holds the same facts
as structured data. The goal is to produce the same paragraphs on the Reviews tab, in the WMKF
house form, from stored data, with a copy affordance. A human edits the text before it lands in
the writeup, so stored fields are acceptable even when they are enrichment-derived (owner,
2026-09-14).

## 2. The target text

From `shared/config/prompts/peer-reviewer-dynamics.js:70-82` `[VERIFIED]`, the house form is:

1. **Count.** "We received N reviews."
2. **Grades.** "The proposal received two reviews of Excellent, one of Very Good, and one of Good."
3. **Reviewers.** "The reviewers were <u>Name</u> (Institution, expertise in X), <u>Name</u> (…), and
   <u>Name</u> (…)." Names underlined with `<u>…</u>`; affiliation in parentheses; expertise clause
   when known; "could not be determined" fallback.
4. **Tone and themes.** Two to three sentences.
5. **Quotations.** One per reviewer, ordered most positive to most critical: "The most positive
   reviewer said: '…'", "Another reviewer noted: '…'", "The most critical reviewer noted: '…'".

The old prompt never asked for rank or title. The Summarize Peer Reviews second output (bulleted
questions for the PI) is out of scope here: the review form already has Q8 "What questions should
the Foundation raise with the principal investigator?" and the tab shows those answers.

## 3. What exists today `[VERIFIED 2026-09-14 via source]`

| Ingredient | State | Where |
|---|---|---|
| Review count | Present. `p.reviewers` filtered by `reviewReceivedAt`. | `lib/services/review-manager/reviewers-service.js:450` |
| Numeric overall rating per reviewer | Present. `reviewerOverallAssessment` from the `wmkf_appreviewanswer` snapshot. | `reviewers-service.js:440` |
| Number → label adapter | Present. `labelForReviewRating('overallAssessment', 5)` → "Excellent" … "Poor" from the static form schema (5/4/3/2/1). Set-aware `labelForOption` also exists. The tab already decodes ratings this way. | `lib/external/review-form-schema.js:129-140,190-225`; `ReviewsTab.js:75` |
| Reviewer name | Present. `person.wmkf_name`. | `reviewers-service.js:342` |
| Reviewer institution | Present, two sources: suggestion-row `wmkf_revieweraffiliation` (accepted-reviewer free text, may carry a trailing email that `reviewerAffiliationOf` strips in the tab) and person `wmkf_primaryaffiliation` / `wmkf_organizationname`. | `reviewers-service.js:343,413`; `ReviewsTab.js:41-60` |
| Board-writeup identity: `wmkf_maininstitution`, `wmkf_primarydepartment`, `wmkf_academicrank` | Exist on `wmkf_potentialreviewers`; self-reported (UI-required) at Stage 2a accept since S308 and staff-editable in the candidate edit modal. RequiredLevel None in Dataverse, so reviewers accepted before S308 or created by enrichment only may be blank. **Not selected by the Reviews read model today.** | `docs/atlas/dataverse-wmkf-potentialreviewers.md:52`; `reviewers-service.js:575` (select list) |
| Expertise: `wmkf_areaofexpertise` | Exists (100 chars). Written only by Reviewer Finder save from the model's "Expertise:" line, joined with `; `, and nulled when identity is untrusted or PD-confirmed. No staff edit path. Not selected by the Reviews read model. | `lib/dataverse/adapters/potential-reviewer.js:53,182,283,399`; `lib/services/reviewer-finder/save-candidates-service.js:1011,1072` |
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

`shared/utils/review-writeup-paragraphs.js` `[PROPOSED]`, pure, unit-tested, used by the tab and
the report composer:

- `composeReviewCountSentence(n)` → "We received three reviews." (number words to twelve, digits
  above; singular "review").
- `composeGradeSentence(reviewers)` → tally `labelForReviewRating('overallAssessment', r.reviewerOverallAssessment)`
  in descending rating order; reviewers with a null label are counted in a trailing "and one
  without a rating" clause rather than dropped. Overall only by default (decision W2).
- `composeReviewerSentence(reviewers)` → one clause per submitted reviewer, in the tab's existing
  order, as runs `[{text, underline}]` so renderers can underline the name without HTML:
  `<u>Name</u> (Institution, Department; expertise in X)`. Institution precedence (decision W1,
  proposed default): `wmkf_maininstitution` → suggestion-row `wmkf_revieweraffiliation` (email
  suffix stripped, reuse `reviewerAffiliationOf` by lifting it out of `ReviewsTab.js`) →
  `wmkf_primaryaffiliation` → `wmkf_organizationname` → "institution not recorded". Department is
  `wmkf_primarydepartment` when present. Expertise clause is `wmkf_areaofexpertise` when non-blank,
  lower-cased first letter, prefixed "expertise in"; omitted when blank (owner accepted this source
  2026-09-14). Rank (`wmkf_academicrank`) is omitted by default (decision W1).
- `composeWriteupParagraphs({reviewers, synthesis})` → `{ runsParagraph1, themes, quotations }`
  plus a plain-text and an HTML serialisation for the copy affordance.

Read model change: add `wmkf_maininstitution,wmkf_primarydepartment,wmkf_academicrank,wmkf_areaofexpertise`
to the person select at `reviewers-service.js:575` and project them as `mainInstitution`,
`primaryDepartment`, `academicRank`, `areaOfExpertise` on each reviewer. These fields are **not**
added to the digest (`digestReviewers` at :450 stays `{name, affiliation, answers}`), so stored
syntheses stay current.

Read-time composition means the sentence follows later edits to the person record rather than
freezing at synthesis time. The Atlas notes board write-ups freeze moment-in-time values; here the
freeze is the human copying the text into the writeup document (decision W3).

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

- Tab: a "Writeup paragraphs" block below the Synthesis card (or inside it, decision W4) rendering
  sentences 1–3 always (when at least one review is submitted) and 4–5 when present. Names render
  as `<u>` from runs, never from model strings. A single **Copy** button copies HTML
  (`text/html`, with `<u>`) and plain text (`text/plain`) via the async clipboard API so Word keeps
  the underline. Every model string is escaped as text.
- DOCX export: new "Reviews (writeup)" section using `TextRun({underline:{}})` for name runs;
  model strings as plain runs.
- PDF export: names rendered plain (no underline support in the flattener today); adding an
  underline path to `review-report-pdf.js` is optional follow-up, not a blocker (decision W5).

## 5. Owner decisions

| # | Decision | Proposed default |
|---|---|---|
| W1 | Reviewer clause form and institution precedence. Include department? Include rank? | `<u>Name</u> (Institution, Department; expertise in X)`; precedence `wmkf_maininstitution` → suggestion affiliation → `wmkf_primaryaffiliation` → `wmkf_organizationname`; rank omitted. |
| W2 | Grade sentence uses Overall only, or Overall and Risk? | Overall only (matches the old app's "grade" sentence). |
| W3 | Read-time composition (sentences follow later person edits) vs snapshotting the composed text into the synthesis JSON. | Read-time; the pasted writeup is the freeze. |
| W4 | Block placement: separate card vs inside the Synthesis card; also shown on the standalone report exports? | Separate card with Copy; included in DOCX; PDF plain. |
| W5 | Expertise clause from `wmkf_areaofexpertise` (enrichment-derived, unedited by staff). | **Decided 2026-09-14: use it; the human editor verifies.** |

## 6. Slices, tiers, verification `[PROPOSED]`

All slices are Tier 1 (feature branch, automated tests, owner merges) per
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`. No migration, no new route, no new table.

**Slice 1 — deterministic sentences + Copy (no prompt change).**
Files: `reviewers-service.js` (select + projection), new `shared/utils/review-writeup-paragraphs.js`,
`ReviewsTab.js` (block + Copy; lift `reviewerAffiliationOf` to the shared module),
`review-report.js` (section) and `review-report-docx.js` (underlined runs).
Tests: new `tests/unit/review-writeup-paragraphs.test.js` (number words, tally order, null
rating clause, precedence chain, blank expertise, single-reviewer grammar, email-suffix strip);
extend `reviews-tab.test.js`, `review-report.test.js`, `review-report-renderers.test.js` (fixture
churn expected: `p.reviewers` gains four fields).
Gates: `check:types`, `check:atlas` (reviewer projection documented on the potentialreviewers Atlas
page), `check:dataverse-access-layer`, `check:route-service-boundary`.

**Slice 2 — model fields.** Files listed in §4.3. Tests: extend
`review-synthesis-prompt-config.test.js` (still one variable, one output; new properties present
with caps), `synthesize-reviews-service.test.js` (old row without fields parses to defaults),
`reviews-tab.test.js` (regenerate hint state). Gates: `check:prompt-injection-tagging`,
`check:fact-consistency`, `check:atlas`, `check:agent-wiki`, `check:doc-currency`. Owner reseeds
production after deploy (§4.3) and regenerates one live request to eyeball the paragraphs.

**Slice 3 — PDF underline (optional).** Only if W5 says PDF must match Word.

## 7. Risks and constraints

- **Blank identity fields.** Reviewers accepted before S308, or never asked, have no
  `wmkf_maininstitution` / department. The precedence chain degrades to the affiliation text the
  tab already shows; the editor fills gaps. Print the count of blank fields in the Slice 1 smoke so
  the fallback rate is known, not assumed.
- **Enrichment-derived expertise** may be wrong or a namesake's. Accepted by the owner because a
  human edits the text. The Reviewer Finder nulls it on untrusted identity, so the clause simply
  disappears for those people.
- **Static rating labels.** `labelForReviewRating` uses the shipped form schema; the admin
  question editor can change the live set (an older "impact" picklist may appear during
  expand/rollback). The tab already accepts this tradeoff; if a label is missing the tally counts
  it as unrated rather than inventing a word.
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
Risk rating prose; per-request snapshotting of person identity; touching the automatic drain.
