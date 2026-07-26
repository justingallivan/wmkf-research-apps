---
title: "Review Form Multi-Select Questions — Build Plan"
domain: architecture
kind: plan
status: active
summary: "Add a multiselect question type and re-author the review question set from the owner's reworked form, expand-first with rehearsal before activation."
canonical: false
cataloged: 2026-07-25
owner: product-engineering
related:
  - lib/external/review-form-schema.js
  - lib/external/review-question-fetcher.js
  - lib/external/build-review-submission.js
  - shared/components/external/ReviewAuthoringForm.js
  - shared/components/workbench/ReviewsTab.js
  - shared/utils/review-matrix.js
  - lib/admin/review-question-save.js
  - docs/atlas/dataverse-wmkf-appreviewanswer.md
---

# Review Form Multi-Select Questions — Build Plan

**Status:** ACCEPTED AND FROZEN (S375, 2026-07-26). Backward-compatible code
implementation and the additive wave-15 schema package are complete on
`codex/review-form-multiselect`; production expansion and exact metadata/select
readback completed 2026-07-26, followed by compatible code promotion to `main`
(`5282cee8`) and a Ready production deployment
(`dpl_7sfTLrMafYPKp7mnYdrEVjs9HmW5`). Publication, controlled rehearsal/rollback,
fixture disposition, and reviewer exposure remain pending. The 2026-07-26
read-only pre-activation evidence pass found that the EICAR fixture already has a
sent thank-you timestamp, which is an explicit §8 stop condition; no fixture was
deleted and cutover remains blocked pending an owner decision on that lifecycle
history. [VERIFIED via
`outputs/review-form-multiselect/preactivation-evidence-2026-07-26.json`]
**Target go-live: 2026-08-15** (owner-set; the date external reviewers first see the
new form).

This is the executable contract for adding a fixed-option, check-all-that-apply
question to the research review form. Draft 4 was authored by Codex, reviewed by
Claude, and accepted: §2.3's single-canonicalizer payload contract, §3's type-gate
inventory with the §3.6 raw-comparison closeout, and §8's simplified cleanup path
were each verified against source rather than taken on assertion.

**Owner decisions applied after that review — closed, do not reopen:**

1. **Re-key the whole set** (§1.1). Draft 4's semantic-retention rule was correct in
   principle but produced four keys pointing at differently-numbered questions
   forever. The only stored answers belong to the owner-named EICAR fixture and
   require the separately controlled §8 disposition; no genuine reviewer answer
   history was identified. Only `affiliation` keeps its key.
2. **Manual rollback procedure** (§4) rather than building a reusable restore service.
3. **Sandbox rehearsal dropped**; the controlled production smoke is the primary
   pre-exposure rehearsal (§7, §9).
4. **Deletion of the test artifacts is NOT authorized** by this plan (§8). The
   read-only consumer probe is; deletion needs a separate approval naming exact writes.

**FROZEN CONTRACT, RECONCILED IMPLEMENTATION STATUS.** The normative decisions and
release sequence remain frozen. The document was reconciled once after the code
implementation landed; `[IMPLEMENTED IN SOURCE]` does not mean the corresponding
production schema, configuration, prompt publication, rehearsal, cleanup, or
exposure step has occurred.

**PRE-DEPLOYMENT BLOCKER — CLEARED 2026-07-26:** wave 15 was applied to
production and `wmkf_answervalues` read back as a nullable custom Memo with
`MaxLength=150000`; an entity-set query also proved the property selectable.
Compatible readers select the property and all answer writers emit it even while
the old question set remains active, so this expand had to precede code deployment.
[VERIFIED via `scripts/probe-review-answer-multiselect-field.mjs`, production run
2026-07-26; implementation dependency verified via
`lib/dataverse/adapters/review-answer.js`]

**Scope for the 2026-08-15 date: all of it, fully tested.** Owner direction
2026-07-26 — the system must be ready and rehearsed before the date, not partially
shipped with a follow-up queue. An earlier draft of this note proposed deferring the
DOCX/PDF categorical sections and the rollback rehearsal; that deferral was not
requested and is withdrawn. Every section of this plan is in scope: the `multiselect`
type end to end, the `wmkf_answervalues` column, every write path in §3.4, the
re-keyed set published, PD read-back (cards, Compare section, per-option tally),
the DOCX and PDF categorical sections, the §5 synthesis prompt version, the §7
controlled production rehearsal, the §4 rollback procedure exercised rather than
merely written, and the §10 test contract in full.

## 0. Evidence, boundaries, and prerequisites

### 0.1 Measured live state

The probes below were read-only. Their implementations explicitly query Dataverse
without writes and inspect both active and inactive question rows, answer snapshots,
received-review suggestions, Postgres drafts, and question-set audit records.
[VERIFIED via `scripts/probe-live-review-questions.mjs:1-11`,
`scripts/probe-live-review-questions.mjs:36-49`, and
`scripts/probe-review-blank-slate.mjs:1-21`]

| Surface | Measured | Interpretation |
|---|---|---|
| `wmkf_reviewquestion` | **12 rows, all active**, byte-identical to the seeded schema. [DERIVED-FROM: `scripts/probe-live-review-questions.mjs` read-only run 2026-07-25; a direct row count, independent of every other figure in this plan] | The active configuration had not diverged from the static seed when measured. [VERIFIED via `scripts/probe-live-review-questions.mjs:23-69`] |
| `review_question_audit` | **4 rows**, all dated 2026-06-29: **2 pending, 1 failed, 1 completed**. [DERIVED-FROM: `scripts/probe-review-blank-slate.mjs` §4 read-only run 2026-07-25; a direct row count, independent of every other figure in this plan] | The measurement did not show a later successful admin publication. [VERIFIED via `scripts/probe-review-blank-slate.mjs:106-123`] |
| `wmkf_appreviewanswer` | **3 rows** on **1 suggestion**, keys `impact`, `risk`, and `overallRating`; each has `answerValue=99` and empty `answerText`. [DERIVED-FROM: `scripts/probe-review-blank-slate.mjs` §1 read-only run 2026-07-25; a direct row count, independent of every other figure in this plan] | These are sentinel answer snapshots and cannot remain when `impact` is retired. [VERIFIED via `scripts/probe-review-blank-slate.mjs:37-64`] |
| Suggestions with `wmkf_reviewreceivedat` | **1** — `6ad328b4-f044-f111-88b5-000d3a306d45`, a staff upload named `eicar-test-bytes.pdf`. The narrow 2026-07-25 probe did not select reviewer identity fields; the 2026-07-26 preflight resolved the person as `Justin Gallivan Test` / `justingallivan@me.com`. [DERIVED-FROM: `scripts/probe-review-blank-slate.mjs` §2 and `scripts/probe-review-multiselect-preactivation.mjs`] | This is the EICAR fixture suggestion named by the owner, not evidence of an empty answer store; its sent thank-you marker now blocks the planned automatic fixture-cleanup progression. [VERIFIED via `outputs/review-form-multiselect/preactivation-evidence-2026-07-26.json`] |
| `review_drafts` | **1** — suggestion `3c4bb952-e061-f111-a826-000d3a306da2`, updated 2026-07-04, containing every current question key. [DERIVED-FROM: `scripts/probe-review-blank-slate.mjs` §3 read-only run 2026-07-25; a direct row count, independent of every other figure in this plan] | This is the `Gallivan_test` draft named by the owner and must be removed through the audited suggestion-removal path, not abandoned. [VERIFIED via `scripts/probe-review-blank-slate.mjs:82-104`] |

The table records a point-in-time measurement, not authorization to mutate either
store. Re-run the read-only ownership/consumer probe in §8 immediately before the
cutover decision. [COMPLETED 2026-07-26; result is a STOP, not deletion authority]

### 0.1a Pre-activation evidence pass (2026-07-26)

The committed read-only probe
`scripts/probe-review-multiselect-preactivation.mjs` captured the production
question rows with immutable IDs/ETags, active version `119da525418d1d43`,
target version `347a37e820f73890`, current synthesis prompt version 1 and its
content hash, recent question/prompt publication audits, both fixture consumer
graphs, four isolated no-write service-boundary checks, and a deliberately blocked
rollback template. The full JSON evidence digest is
`a22c5029bdd7341fe81f74d53d4668b37f6f77699fea7370135cba5bd9155e30`.
[VERIFIED via
`outputs/review-form-multiselect/preactivation-evidence-2026-07-26.json`]

The four service probes each resolved the same live version in a fresh local
process targeting production Dataverse and stopped before their first write:
external submit and manual entry returned `409 set_changed`; legacy upload and
mark-received returned validation failures. This verifies the service boundaries,
but it is not the independently routed production HTTP evidence required by
§9.1(3), so that gate remains open. [VERIFIED service-level / PLANNED HTTP-level]

The EICAR fixture is selected, accepted, received, included by the workbench/report
and synthesis predicates, owns the three sentinel answers and linked test file,
and has `wmkf_thankyousentat=2026-05-01T01:11:26Z`. Section 8 says to stop when a
sent thank-you exists. The `Gallivan_test` fixture has no answers, report,
synthesis inclusion, honorarium, or sent thank-you, but still owns the sole
Postgres draft. Neither fixture was changed. [VERIFIED via the same evidence]

### 0.2 Dependency: question-set coherence at write boundaries — SHIPPED

**Status: RESOLVED for the property this plan depends on (commit `afed10ec`,
2026-07-26).** The acceptance criterion below was narrowed from draft 4's version
by the reviewer; the reasoning is recorded so the change is auditable rather than
silently relaxed.

The question fetcher keeps a module-local cache with a five-minute TTL, and
`invalidate()` clears only the process that receives the call. [VERIFIED via
`lib/external/review-question-fetcher.js:34-36` and
`lib/external/review-question-fetcher.js:231-234`]

Draft 4 required cross-instance coherence for **every** consumer — context, draft
load, and the four write paths — before this plan could proceed. That criterion is
stronger than the correctness property at stake, and meeting it would require a
genuine distributed invalidation mechanism.

The failure that actually matters is at the **write** boundary: the submitting
instance compared the client's `setVersion` against its own possibly-stale set, so
both sides agreed, the `set_changed` guard passed, and rows committed against a
question set that was no longer live. A stale **read** is not equivalent — it
renders a superseded form, and the write boundary now rejects that submission with
`set_changed`, so the system converges.

What shipped: `getAuthoritativeQuestionSet()` resolves uncached (refreshing the
cache, preserving the fail-closed behavior and the generation guard) and is used by
portal submit, staff manual entry, legacy review upload, and mark-received-no-file.
[VERIFIED via `lib/external/review-question-fetcher.js:215-224`,
`lib/services/external-review/submit-service.js:126-128`,
`lib/services/review-manager/manual-review-entry-service.js:136-138`,
`lib/services/review-upload.js:132-134`, and
`lib/services/review-manager/mark-received-no-file-service.js:78-80`]

The admin save path never had this exposure: it reads live rows through
`readActiveSetWithIds()`, so its optimistic lock was already authoritative across
instances. [VERIFIED via `lib/services/admin/review-questions-service.js:117-124`]

**Accepted residual.** For up to the cache TTL after a publication, an instance may
still render the previous form via `context` or validate a draft against it. A
reviewer who submits from that form receives `set_changed` and reloads; the reviewer
form flushes the in-progress draft before reloading, so answers are not lost. The
cost is a possible wasted form-fill inside a five-minute window that the cutover
sequence (§9) already keeps external reviewers out of. Implementation must NOT add
TTL waits, hybrid question sets, or another cache layer to close this residual.

Full read-path coherence remains available as optional future work; it is **not** a
prerequisite for this plan.

Per-file recheck of the sources this plan cites, after the 2026-07-26 fix:

- [RECHECKED after lib/external/review-question-fetcher.js change: `getAuthoritativeQuestionSet` added at `:215`; the cached resolver, single-flight guard, generation guard, and fail-closed set validation are unchanged, so every §3 gate that this plan places in the fetcher still applies as written.]
- [RECHECKED after lib/services/external-review/submit-service.js change: the only edit is the resolver at `:128`; `snapshotKeys` at `:130-132` still filters `picklist || richtext`, so the §3.4 allowlist work this plan requires is still outstanding.]
- [RECHECKED after lib/services/review-manager/manual-review-entry-service.js change: submit resolves authoritatively at `:138` while the GET form loader at `:118` stays cached; `snapshotKeys` at `:164-168` still filters `picklist || richtext`, so the §3.4 item stands.]
- [RECHECKED after lib/services/review-upload.js change: resolver only, at `:134`; the legacy rating dual-write and its `snapshotKeys` are untouched, so the §3.4 item stands.]
- [RECHECKED after lib/services/review-manager/mark-received-no-file-service.js change: resolver only, at `:80`; the legacy rating dual-write and its `snapshotKeys` are untouched, so the §3.4 item stands.]

None of these changes reduce the implementation scope in §3; they change only when
each path learns about a question-set publication.

### 0.3 Expand-first is mandatory

The current answer entity has a nullable numeric answer value, text/HTML snapshots,
and an alternate key on suggestion plus question key; it has no multi-value answer
property. [VERIFIED via `lib/dataverse/adapters/review-answer.js:43-52`,
`lib/dataverse/adapters/review-answer.js:173-199`, and
`docs/atlas/dataverse-wmkf-appreviewanswer.md:21-29`]

The Dataverse sandbox cannot host this rehearsal as currently provisioned. The
read-only 2026-07-26 probe authenticates to `orgd9e66399.crm.dynamics.com`, probes
the required entity metadata, and defaults to that tracked host when
`DYNAMICS_SANDBOX_URL` is unset. That variable was unset locally during the
measurement. The result was that `akoya_request` is present while
`wmkf_appreviewersuggestion`, `wmkf_appreviewanswer`,
`wmkf_reviewquestion`, and `wmkf_potentialreviewer` are absent. This is an
unprovisioned reviewer chain, not a stale copy of the production chain.
[VERIFIED via `scripts/probe-sandbox-reviewer-schema.mjs:27-37`,
`scripts/probe-sandbox-reviewer-schema.mjs:54-78`,
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:176-198`, and
`docs/atlas/dataverse-wmkf-appreviewanswer.md:48-51`]

Building that environment would require the reviewer entities and their
relationships/configuration plus the release gate's independent authentication,
file, background-job, email, and reset verification. It is a separate environment
project and is not part of this plan. [VERIFIED via
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:184-200`]

Therefore the change remains additive first, but the pre-exposure proof moves to
controlled production: provision the nullable storage property, deploy readers and
writers that tolerate both old and new rows, then exercise the real `impactAreas`
configuration and new prompt end-to-end against dedicated internal test records
before any external reviewer is exposed. [PLANNED]

## 1. Closed product and key decisions

### 1.1 Key contract

**Owner decision 2026-07-26 — supersedes draft 4's semantic-retention rule.** Draft 4
kept `risk`, `overallRating`, `q2`, `q4`, `q5`, `q6`, `q8`, and `q11` on the principle
that a key is retired only when the answer's meaning changes. That rule is sound when
it protects stored answers. There are none: the only answer rows are sentinel fixtures
scheduled for removal (§0.1, §8).

Its cost, however, is permanent. Under draft 4's list, `q4` held Q5, `q5` held Q6,
`q6` held Q8, and `q8` held Q9 — four keys pointing at differently-numbered questions,
forever, for every future reader of an answer snapshot. Weighed against a
human-legibility preference and a zero-data window that closes at the first real
submission, the owner chose to re-key the whole set now.

**Every question key is therefore re-authored except `affiliation`**, which is the
reviewer-identity field, is unchanged by the new form, and remains bound to a parent
column (`reviewParentColumnByKey`). Retire: `impact`, `risk`, `overallRating`, `q2`,
`q4`, `q5`, `q6`, `q7`, `q8`, `q9`, `q11`.

After the change, these constants must resolve exactly as follows:

```js
export const CORE_RATING_KEYS = Object.freeze([
  'riskLevel',
  'overallAssessment',
]);

export const PARENT_BOUND_KEYS = Object.freeze([
  'affiliation',
  'riskLevel',
  'overallAssessment',
]);
```

`PARENT_BOUND_KEYS` may be implemented as
`Object.freeze(['affiliation', ...CORE_RATING_KEYS])`, but the resulting values and
order must be exactly the array above. `impactAreas` is NOT a core rating — it is a
multiselect and must never appear in either list, or `assertRatingInvariants` will
demand a numeric `answerValue` it cannot have. [IMPLEMENTED IN SOURCE]

At plan freeze, the pre-implementation code included `impact` in
`CORE_RATING_KEYS`, derived the parent-bound set from it, and exposed rating
snapshots for all three prior rating keys. [HISTORICAL baseline verified via
`lib/external/review-form-schema.js:151-181`,
`lib/admin/review-question-save.js:40-45`,
`lib/dataverse/adapters/review-answer.js:60-130`, and
`lib/external/review-answer-snapshot.js:26-38`]

Both additional hardcoded rating-key lists must be re-authored to the same two names:
`REVIEW_RATING_KEYS` in `lib/dataverse/adapters/review-answer.js` and in
`lib/external/review-answer-snapshot.js`, plus `RATING_KEYS`/`PROJECTION_FIELD` in
`shared/components/workbench/ReviewsTab.js`. Draft 4's instruction to withdraw the
names `riskLevel` and `overallAssessment` is itself withdrawn. [IMPLEMENTED IN SOURCE]

### 1.2 Target question set

The admin publication must reconcile to this complete ordered set. The content
column is normative display text and must be authored verbatim; hints are omitted
unless stated. [IMPLEMENTED IN SOURCE; PRODUCTION PUBLICATION PENDING]

Omitted active questions are deactivated by the existing full-set save behavior.
[VERIFIED via `lib/services/admin/review-questions-service.js:82-145`]

Apply one stable-key rule uniformly: keep the current key when revised wording
still asks the same underlying question and an answer retains the same meaning;
retire the current key and create a new one when the answer semantics or answer
type changes. The Atlas prohibits reusing a key for a different question, not
continued use of the same question after rewording. [VERIFIED via
`docs/atlas/dataverse-wmkf-reviewquestion.md:24-30`]

| Order | Key | Type | Required display text and option contract |
|---:|---|---|---|
| — | `affiliation` | `string` | Required: “Title & Organization”; `maxLength: 300`; `prefillFromCrm: true`; hint: “Pre-filled from CRM if known. Edit if your affiliation has changed.” This identity field is unnumbered and has no snapshot order. |
| 1 | `priorWork` | `richtext` | Required, `maxLength: 50000`: “Q1 — Are there existing publications, technologies, or prior work that address part of the proposed work? What distinguishes this proposal?” |
| 2 | `foreseenImpacts` | `richtext` | Required, `maxLength: 50000`: “Q2 — What specific significant impacts do you foresee? Which outcomes may be useful to your work?” |
| 3 | `impactAreas` | `multiselect` | Required: “Q3 — If the proposed project is successful in its entirety, it will (check all that apply)”. Options, in canonical order: `1` Provide enabling tools to the community; `2` Result in publications of disciplinary interest; `3` Result in publications of broad interest; `4` Revise textbooks. |
| 4 | `riskLevel` | `picklist` | Required: “Q4 — How risky is the project overall?” Hint: “The Keck Foundation is comfortable funding risky projects.” Unchanged domain: `1` Low risk (will likely work in its entirety); `2` Medium risk (parts may succeed, others may fail); `3` High risk (significant risk of failure); `4` Impossible (fatal flaw). |
| 5 | `riskDetail` | `richtext` | Required, `maxLength: 50000`: “Q5 — What are the risks (technical, hypothesis, or scope)?” |
| 6 | `methodsAppropriate` | `richtext` | Required, `maxLength: 50000`: “Q6 — Are the proposed methods, data gathering, and analysis appropriate?” |
| 7 | `teamCapacity` | `richtext` | Required, `maxLength: 50000`: “Q7 — Do you have concerns about the team’s capacity, including personnel, infrastructure, or budget?” |
| 8 | `questionsForPi` | `richtext` | Required, `maxLength: 50000`: “Q8 — What questions should the Foundation raise with the principal investigator?” |
| 9 | `traditionalFunding` | `richtext` | Required, `maxLength: 50000`: “Q9 — Would this proposal be competitive in peer review at a traditional funding agency?” |
| 10 | `overallAssessment` | `picklist` | Required: “Q10 — Please assign an overall rating to the proposal.” Unchanged domain: `1` Poor; `2` Fair; `3` Good; `4` Very Good; `5` Excellent. Reorder the options array to display Excellent first; array order is display order, but every option retains its existing numeric value and label (`5` Excellent through `1` Poor). Never renumber the values. |
| 11 | `additionalComments` | `richtext` | Optional, `maxLength: 50000`: “Q11 — Is there anything else you would like to share with the Foundation about the proposal or this review process?” |

Only `impactAreas` is check-all-that-apply. `riskLevel` and `overallAssessment` remain
single-choice questions even if the source form’s glyphs resemble checkboxes, and
no option carries an `Other` free-text payload. [IMPLEMENTED IN SOURCE]

The numeric option values for `riskLevel` and `overallAssessment` above are carried
unchanged from the current `risk` and `overallRating` rows; only the keys change. They are the current
static-schema values. [VERIFIED via `lib/external/review-form-schema.js:68-82` and
`lib/external/review-form-schema.js:126-141`]

The current and target texts show that `q2`, `q4`, `q5`, `q6`, `q8`, and `q11`
are wording revisions of the same questions, so they keep their keys. `impact`
changes from a single impact rating to a categorical multiselect, while current
`q7` and `q9` are replaced by one polarity-changed, combined team-capacity question;
those answers would not retain the same meaning. [VERIFIED current text via
`lib/external/review-form-schema.js:42-61`,
`lib/external/review-form-schema.js:76-123`, and
`lib/external/review-form-schema.js:138-145`; target disposition is PLANNED]

Retire every current key except `affiliation` through the full-set publication —
`impact`, `risk`, `overallRating`, `q2`, `q4`, `q5`, `q6`, `q7`, `q8`, `q9`, and
`q11` (§1.1). Create all eleven numbered keys fresh: `priorWork`, `foreseenImpacts`,
`impactAreas`, `riskLevel`, `riskDetail`, `methodsAppropriate`, `teamCapacity`,
`questionsForPi`, `traditionalFunding`, `overallAssessment`, `additionalComments`.
`affiliation` alone keeps its existing immutable key, because it is the
reviewer-identity field, is unchanged by the new form, and is the one key still bound
to a parent column through `reviewParentColumnByKey`. [IMPLEMENTED IN SOURCE;
PRODUCTION PUBLICATION PENDING]

Two rating questions change key but not meaning: the `risk` row's options and hint
carry onto `riskLevel`, and the `overallRating` row's five options carry onto
`overallAssessment`, values unchanged. This is a re-key, not a re-scoring.
[IMPLEMENTED IN SOURCE; PRODUCTION PUBLICATION PENDING]

## 2. Storage and canonical answer contract

### 2.1 Chosen representation

Add nullable Dataverse Memo property `wmkf_answervalues` to
`wmkf_appreviewanswer`. Store one compact JSON array per multiselect answer:

```json
[{"value":1,"label":"Provide enabling tools to the community"},{"value":4,"label":"Revise textbooks"}]
```

For a multiselect row:

- `wmkf_questiontype = "multiselect"`;
- `wmkf_answervalue = null`;
- `wmkf_answervalues` is the canonical compact JSON array, including `[]` for an
  allowed empty selection;
- `wmkf_answertext` is the same canonical labels joined with `"; "`;
- `wmkf_answerhtml = null`.

All legacy picklist, rich-text, and string rows write
`wmkf_answervalues = null`. [IMPLEMENTED IN SOURCE; PRODUCTION SCHEMA EXPANSION
COMPLETED 2026-07-26]

Create the additive schema package at
`lib/dataverse/schema/wave15-review-answer-multiselect/`.
[DERIVED-FROM: sorted directory listing of `lib/dataverse/schema` on 2026-07-26;
independent of every other figure in this plan] The package must add a Memo property
with logical name `wmkf_answervalues` and publish it through the existing schema
application mechanism. Update the answer adapter field list, row body, DTO, and
Atlas entry in the same change. [IMPLEMENTED IN SOURCE; PRODUCTION SCHEMA EXPANSION
COMPLETED 2026-07-26]

### 2.2 Rejected representations

**Do not store one answer row per selected option.** The entity’s alternate key is
suggestion plus question key, so a second selected option for the same question
would collide. [VERIFIED via
`docs/atlas/dataverse-wmkf-appreviewanswer.md:21-23` and
`lib/dataverse/adapters/review-answer.js:173-178`]

**Do not add a Dataverse multi-select Choice property.** Review-question options are
runtime configuration serialized in `wmkf_reviewquestion.wmkf_options`; the admin
editor owns those option values and labels. Binding answers to solution metadata
would create a second option authority. [VERIFIED via
`docs/atlas/dataverse-wmkf-reviewquestion.md:27-35`,
`lib/external/review-question-fetcher.js:87-116`, and
`lib/admin/review-question-save.js:165-200`]

### 2.3 One authoritative producer

Add a pure server helper at `lib/external/review-multiselect.js`:

```js
canonicalizeMultiselectSelection(field, submittedValues)
  -> { values, pairs, answerText }
```

It is the **only** producer allowed to construct stored `{value,label}` pairs or the
derived joined text. Its contract is:

1. Accept an array of numeric integer values only. Objects, strings, labels, and
   `{value,label}` input are invalid.
2. Deduplicate by numeric value.
3. Reject every value absent from the live `field.options`.
4. Order the accepted values by the live option order, never request order.
5. Construct `pairs` from the live options’ numeric values and labels.
6. Derive `answerText` from those same ordered pairs.
7. Reject an empty result when the live field is required; preserve `[]` when it
   is optional.

The browser request therefore carries numeric values only. The server never accepts
or trusts a client-supplied label. Both `validateReviewSubmission` and the legacy
`validateReviewForm` path must call this helper; row emitters consume its result and
must not reconstruct labels. [IMPLEMENTED IN SOURCE]

### 2.4 Defensive reading

Add one parser in `lib/dataverse/adapters/review-answer.js`:

```js
parseStoredAnswerValues(raw)
  -> { answerValues, answerValuesUnreadable }
```

Valid stored input is an array of unique objects whose `value` is an integer and
whose `label` is a non-empty string. Preserve stored order and labels because the
snapshot is historical. On malformed JSON, a wrong top-level shape, duplicate
values, or an invalid pair, return `answerValues: null` and
`answerValuesUnreadable: true`; do not fail the entire answer read. The DTO must
display “Unreadable answer,” exclude the row from multiselect tallies and
synthesis evidence, and retain enough diagnostics for staff to identify the answer
row. Apply this parsing and unreadable marker only when
`wmkf_questiontype = "multiselect"`; non-multiselect rows ignore a stray
`wmkf_answervalues` value so categorical corruption cannot suppress a valid
rating or narrative. [IMPLEMENTED IN SOURCE]

Tallies group by stored `(value,label)` pair rather than by current question
options. This preserves historical labels if staff later rename an option.
Aggregate output sorts those pair identities by numeric value and then label so
reviewer arrival order cannot change comparison or export ordering.
[IMPLEMENTED IN SOURCE]

## 3. Complete executable type-gate inventory

At plan freeze, the pre-implementation review-question pipeline supported
`picklist`, `richtext`, and `string` through explicit allowlists and raw type
comparisons. [HISTORICAL baseline verified via
`lib/external/review-question-fetcher.js:29`,
`lib/admin/review-question-save.js:69`, and
`shared/components/admin/ReviewQuestionsSection.js:24-28`]

Every site below is in the implementation change; none may be handled implicitly.

### 3.1 Producers, validation, and row emission

- `lib/external/review-question-fetcher.js`
  - Extend `SUPPORTED_TYPES` with `multiselect`.
  - Parse and require option JSON for both `picklist` and `multiselect`.
  - Keep the fail-closed validation for unsupported types.
  [VERIFIED current behavior via `lib/external/review-question-fetcher.js:29` and
  `lib/external/review-question-fetcher.js:87-116`]
- `lib/external/build-review-submission.js`
  - In `validateReviewSubmission`, add the `multiselect` branch and call
    `canonicalizeMultiselectSelection`; the normalized answer carries its returned
    values, pairs, and text.
  - In `ratingKeysFor`, remain picklist-only; with the corrected
    `CORE_RATING_KEYS`, it validates only `riskLevel` and `overallAssessment`.
  - In the answer-question filter, admit `multiselect`.
  - In `buildReviewSubmission`’s row-emission branch, emit one row using the
    canonical object and set scalar/HTML properties as specified in §2.1.
  [VERIFIED current gates via `lib/external/build-review-submission.js:41-43`,
  `lib/external/build-review-submission.js:59-129`, and
  `lib/external/build-review-submission.js:182-210`]
- `lib/external/review-form-schema.js`
  - Change `CORE_RATING_KEYS` exactly as §1.1 states.
  - Keep `PICKLIST_FIELDS_BY_KEY` picklist-only.
  - In `validateReviewForm`, call the shared canonicalizer for `multiselect` and
    expose a normalized multiselect bucket to legacy snapshot writers.
  - Carry the `risk`/`overallRating` option domains unchanged onto `riskLevel`/`overallAssessment`.
  [VERIFIED current gates via `lib/external/review-form-schema.js:179-200` and
  `lib/external/review-form-schema.js:250-299`]
- `lib/external/review-answer-snapshot.js`
  - Change local `REVIEW_RATING_KEYS` to `riskLevel` and `overallAssessment`.
  - Keep `buildRatingSnapshotRows` picklist-only.
  - Add `buildMultiselectSnapshotRows` that consumes only canonicalized results.
  - Extend `buildAnswerRowBody` to accept `answerValues`; legacy rows pass null.
  [VERIFIED current gates via `lib/external/review-answer-snapshot.js:26-38` and
  `lib/external/review-answer-snapshot.js:95-143`]
- `lib/dataverse/adapters/review-answer.js`
  - Select, write, parse, and map `wmkf_answervalues`.
  - Change local `REVIEW_RATING_KEYS` and `ratings` DTO shape to only `riskLevel` and
    `overallAssessment`.
  - Expose `answerValues` and `answerValuesUnreadable`.
  [VERIFIED current shape via `lib/dataverse/adapters/review-answer.js:43-60`,
  `lib/dataverse/adapters/review-answer.js:97-130`, and
  `lib/dataverse/adapters/review-answer.js:191-199`]

### 3.2 Hydration, completeness, and renderer

- `shared/components/external/ReviewAuthoringForm.js`
  - `buildInitialValues`: for `multiselect`, accept only a draft array of numeric
    values, discard entries absent from live options, deduplicate, and reorder by
    live option order. Never hydrate labels or object pairs.
  - `isComplete`: a required multiselect is complete only when its normalized
    numeric array is non-empty.
  - `FieldRow`: render `multiselect` as a `<fieldset>` of checkboxes using option
    labels; toggling updates a numeric array in canonical option order. Preserve
    the existing radio renderer for `picklist`.
  - Draft persistence and submission continue to serialize the browser value map;
    multiselect entries in that map are numeric arrays.
  [VERIFIED current hydration, completeness, persistence, and renderer gates via
  `shared/components/external/ReviewAuthoringForm.js:35-94`,
  `shared/components/external/ReviewAuthoringForm.js:138-195`, and
  `shared/components/external/ReviewAuthoringForm.js:394-450`]

The checkbox fieldset must expose a legend containing the question text, individual
label associations, error text connected with `aria-describedby`, and keyboard
operation through native checkbox semantics. [IMPLEMENTED IN SOURCE]

### 3.3 Admin serialization and option editing

- `lib/admin/review-question-save.js`
  - Extend `SUPPORTED_TYPES`.
  - Set `PARENT_BOUND_KEYS` exactly as §1.1 states.
  - Apply option validation, duplicate-value rejection, non-empty labels, and JSON
    serialization to both `picklist` and `multiselect`.
  - Apply option comparisons in the change diff to both option-bearing types.
  [VERIFIED current gates via `lib/admin/review-question-save.js:40-69`,
  `lib/admin/review-question-save.js:128-200`, and
  `lib/admin/review-question-save.js:222-237`]
- `shared/components/admin/ReviewQuestionsSection.js`
  - Add `Multiselect (check all that apply)` to `TYPE_OPTIONS`.
  - In `toPayload`, serialize `options` for `picklist` and `multiselect`.
  - Apply the option editor and option-bearing length rules to both types.
  - A type change initializes or clears type-specific state deterministically;
    it must never retain invisible stale options.
  [VERIFIED current gates via
  `shared/components/admin/ReviewQuestionsSection.js:24-28`,
  `shared/components/admin/ReviewQuestionsSection.js:50-65`, and
  `shared/components/admin/ReviewQuestionsSection.js:291-306`]

### 3.4 Every writer allowlist and snapshot-key site

Each writer below must include `multiselect` in `snapshotKeys`, call the same
validated producer contract, and concatenate multiselect snapshot rows with the
existing rating/narrative rows. No writer may serialize `{value,label}` pairs from
request input.

- Portal submit:
  `lib/services/external-review/submit-service.js` `snapshotKeys`.
  [VERIFIED via `lib/services/external-review/submit-service.js:128-130`]
- Staff manual entry:
  `lib/services/review-manager/manual-review-entry-service.js` `snapshotKeys`.
  This is the specifically required manual-entry allowlist.
  [VERIFIED via
  `lib/services/review-manager/manual-review-entry-service.js:143-167`]
- Legacy staff review upload:
  `lib/services/review-upload.js` `snapshotKeys`.
  [VERIFIED via `lib/services/review-upload.js:267-279`]
- Staff mark-received-without-file:
  `lib/services/review-manager/mark-received-no-file-service.js` `snapshotKeys`.
  [VERIFIED via
  `lib/services/review-manager/mark-received-no-file-service.js:79-100`]

### 3.5 Consumers and intentional type distinctions

- `shared/utils/review-matrix.js`: keep numeric average/spread strictly
  `picklist`-only; add a separate `multiselect` branch that produces per-pair
  selection tallies and reviewer membership from parsed snapshots.
  [VERIFIED current numeric branch via `shared/utils/review-matrix.js:146-158`]
- `shared/components/workbench/ReviewsTab.js`: change the hard-coded rating key
  set and comparison ratings to `riskLevel` and `overallAssessment`; render multiselect
  answers as categorical chips/lists in cards and a separate categorical comparison
  block, not in the numeric rating grid.
  [VERIFIED current gates via `shared/components/workbench/ReviewsTab.js:53-58`,
  `shared/components/workbench/ReviewsTab.js:116-145`]
- `shared/utils/review-report.js`: retain picklist ratings and rich-text narrative
  sections, and add categorical multiselect sections sourced from parsed answer
  pairs. Courtesy copy uses the joined snapshot text.
  [VERIFIED current gates via `shared/utils/review-report.js:286-287` and
  `shared/utils/review-report.js:395-438`]
- `shared/utils/review-report-docx.js` and
  `shared/utils/review-report-pdf.js`: render the new categorical sections and the
  unreadable-answer marker; do not calculate multiselect averages. [IMPLEMENTED IN SOURCE]
- `lib/services/review-manager/reviewers-service.js`: update rating projections to
  return only `riskLevel` and `overallAssessment`; pass through parsed multiselect answers
  through the answer DTO rather than adding a scalar rating. [IMPLEMENTED IN SOURCE]
- `lib/services/review-manager/synthesize-reviews-service.js`: select and parse
  `wmkf_answervalues`; include readable multiselect pairs as categorical evidence;
  exclude unreadable rows; never place multiselect values in rating summaries.
  [VERIFIED current answer selection and digest via
  `lib/services/review-manager/synthesize-reviews-service.js:42-50`,
  `lib/services/review-manager/synthesize-reviews-service.js:85-95`, and
  `lib/services/review-manager/synthesize-reviews-service.js:114-135`]
- `lib/services/reviewer-thankyou-sweep.js`: no eligibility logic changes, but its
  courtesy copy must render the joined multiselect snapshot through the shared
  answer/report path.
  [VERIFIED current reader/copy path via
  `lib/services/reviewer-thankyou-sweep.js:60-72`]

### 3.6 Raw-comparison closeout

The implementation must sweep all raw `'picklist'` comparisons under `lib/` and
`shared/`. The pre-change inventory is:

| Path and site | Required disposition |
|---|---|
| `lib/services/review-upload.js:276` `snapshotKeys` | Admit `multiselect`. |
| `shared/components/external/ReviewAuthoringForm.js:44` `buildInitialValues` | Add numeric-array hydration. |
| `shared/components/external/ReviewAuthoringForm.js:87` `isComplete` | Add required-array rule. |
| `shared/components/external/ReviewAuthoringForm.js:416` `FieldRow` | Keep radio branch; add checkbox branch. |
| `shared/components/workbench/ReviewsTab.js:145` comparison ratings | Remain picklist-only; add a separate categorical block. |
| `lib/external/build-review-submission.js:42` `ratingKeysFor` | Remain picklist-only. |
| `lib/external/build-review-submission.js:83` `validateReviewSubmission` | Add canonical multiselect branch. |
| `lib/external/build-review-submission.js:183` answer-question filter | Admit `multiselect`. |
| `lib/external/build-review-submission.js:205` row emission | Add multiselect row branch. |
| `lib/external/review-form-schema.js:200` `PICKLIST_FIELDS_BY_KEY` | Remain picklist-only. |
| `lib/external/review-form-schema.js:289` `validateReviewForm` | Add canonical multiselect branch. |
| `lib/external/review-question-fetcher.js:87` option parsing | Apply to both option-bearing types. |
| `shared/components/admin/ReviewQuestionsSection.js:61` `toPayload` | Serialize options for both types. |
| `shared/components/admin/ReviewQuestionsSection.js:291` max-length gate | Keep max length off option-bearing types. |
| `shared/components/admin/ReviewQuestionsSection.js:306` option editor gate | Apply to both types. |
| `lib/external/review-answer-snapshot.js:129` `buildRatingSnapshotRows` | Remain picklist-only; add separate multiselect builder. |
| `lib/services/external-review/submit-service.js:129` `snapshotKeys` | Admit `multiselect`. |
| `lib/services/review-manager/mark-received-no-file-service.js:97` `snapshotKeys` | Admit `multiselect`. |
| `lib/services/review-manager/manual-review-entry-service.js:163` `snapshotKeys` | Admit `multiselect`. |
| `shared/utils/review-report.js:286` rating partition | Remain picklist-only; add categorical partition. |
| `lib/admin/review-question-save.js:165` option validation | Apply to both types. |
| `lib/admin/review-question-save.js:222` option serialization | Apply to both types. |
| `lib/admin/review-question-save.js:236` current-option diff | Apply to both types. |
| `lib/admin/review-question-save.js:237` submitted-option diff | Apply to both types. |
| `shared/utils/review-matrix.js:146` numeric aggregation | Remain picklist-only; add categorical aggregation. |

After implementation, rerun the same repository search. Every surviving
picklist-only comparison must match an intentional disposition in this table and
have a test. Any unclassified comparison is a release blocker. [IMPLEMENTED IN SOURCE;
POST-IMPLEMENTATION SEARCH RECONCILED]

## 4. Question-set publication and rollback mechanics

The current save service reads active rows, computes a full-set diff, and deactivates
active rows omitted from the submitted set. It does not read inactive rows into the
planner. [VERIFIED via
`lib/services/admin/review-questions-service.js:34-45`,
`lib/services/admin/review-questions-service.js:117-145`, and
`lib/admin/review-question-save.js:305-315`]

Consequently, `before_json` by itself is not an executable rollback for immutable
keys that were deactivated: blindly saving it could try to create a reused key
instead of reactivating its existing row. [VERIFIED via the active-only reader and
the alternate-key behavior above:
`lib/services/admin/review-questions-service.js:34-45` and
`lib/admin/review-question-save.js:305-315`]

Do **not** put a reusable `restoreQuestionSetFromAudit` service and
`scripts/restore-review-question-set.mjs` on the first-activation critical path.
The first cutover has one known before/after mapping, while a general restoration
service would add a second publication planner, audit lifecycle, CLI contract, and
test matrix before the multiselect can ship. Use a documented, reviewed manual
changeset procedure for the first activation; revisit automation only after a
second operational use demonstrates that the procedure is recurring. [PLANNED]

The manual rollback procedure must:

1. Load the completed cutover publication audit and parse its `before_json`.
2. Read active and inactive question rows, including immutable row IDs and ETags.
3. Produce a dry-run manifest that validates the prior set through the updated
   guards and shows every PATCH before execution.
4. Execute one Dataverse changeset that reactivates prior-only keys **by row ID**,
   restores retained rows by row ID, and deactivates new-only keys by row ID. It
   must never POST an already-existing immutable key.
5. Preserve the manifest, operator, source publication request ID, request/response
   evidence, and timestamps in the release record.
6. Call `invalidate()` in the executing process, and rely on the write-boundary
   authoritative resolve (§0.2) rather than on that invalidation reaching every
   instance.
7. Read back the active set across independently routed requests and require its
   normalized version to match the audited prior version.

Before first exposure, rehearse this procedure in production while access remains
limited to the controlled internal test records: restore the prior set after the
first target publication, verify it, then republish and verify the target set. The
dry-run manifest must show `impact` reactivated by its existing row ID and
`impactAreas` deactivated by its row ID, proving that rollback does not create a
duplicate immutable key. [PLANNED]

## 5. Versioned synthesis prompt

The synthesis service reads submitted review snapshots, constructs a structured
digest, and executes `review-synthesis.generate`; the live prompt body is versioned
outside the service. [VERIFIED via
`lib/services/review-manager/synthesize-reviews-service.js:170-215` and
`shared/config/prompts/review-synthesis.js:4-8`]

At plan freeze, the bundled prompt described numeric picklist ratings, including
the prior impact rating. [HISTORICAL baseline verified via
`shared/config/prompts/review-synthesis.js:43-53`]

Publish a new **backward-compatible** prompt version before production question-set
activation. It must:

- continue to interpret `riskLevel` and `overallAssessment` as unchanged numeric ratings;
- treat `impactAreas` as categorical evidence using snapshot labels;
- never average, rank, or infer magnitude from multiselect option values;
- tolerate the old `impact` picklist during expand and rollback;
- ignore rows marked unreadable by the server digest.

Before publication, record the current prompt row ID, version, body, system prompt,
variables, and a content hash in the cutover record. Publish through the existing
audited prompt publication service, then verify the new row is current and its
publication audit completed. [PLANNED]

Prompt rollback is always another audited publication: copy the recorded prior
body, system prompt, and variables into a new monotonic version. Never flip or edit
a historical prompt row directly. The current publisher creates a new version and
then retires the prior current row under ETag protection.
[VERIFIED via `lib/services/admin/prompts-publish-service.js:73-96` and
`lib/services/admin/prompts-publish-service.js:172-217`]

## 6. Read and presentation behavior

The answer entity remains the historical snapshot authority. Current question
labels may change later; reports, comparisons, courtesy copies, and synthesis use
the stored pair labels for submitted multiselect answers. [IMPLEMENTED IN SOURCE]

Expected presentation:

- Reviewer card: selected labels as a list or chips beneath the question text.
- Compare view: categorical selection frequency plus reviewer names; no average or
  spread.
- DOCX/PDF: a categorical section preserving question order and selected labels.
- Courtesy copy: the semicolon-joined snapshot text.
- Synthesis: categorical evidence with attribution; no numeric treatment.
- Corrupt snapshot: “Unreadable answer,” excluded from aggregation and synthesis,
  while the rest of the review still renders.

The numeric matrix currently averages every picklist value it receives. A sentinel
value such as `99` therefore changes the displayed average; this is why the existing
fixture rows cannot be left orphaned. [VERIFIED via
`shared/utils/review-matrix.js:146-158`]

## 7. Primary controlled-production rehearsal before exposure

Mode D is the rehearsal venue for this change. It requires a dedicated
owner-approved test request and throwaway reviewer records, server-side record and
recipient allowlists, a written write/cleanup inventory, capture mode unless real
delivery is the test objective, and post-run reconciliation. [VERIFIED via
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:203-215`]

Execute this sequence with external exposure held closed:

1. Confirm the write-boundary coherence fix of §0.2 is deployed (shipped
   `afed10ec`); no further cache work is a prerequisite.
2. Build and pass isolated automation on a release branch under the repository’s
   Tier-2 process. [IMPLEMENTED AND VERIFIED LOCALLY; RELEASE PROMOTION PENDING]
3. Complete the production expand and baseline capture in §9.1. [PLANNED]
4. Publish the new synthesis prompt and the exact target question set from §1.2,
   including the real required `impactAreas` options. [PLANNED]
5. On a dedicated internal test suggestion, complete an end-to-end review through
   the external authoring UI; save/reload a draft; submit; then exercise staff
   manual entry, legacy upload, and mark-received. External email stays disabled or
   captured by the sanctioned test mode. Verify canonical storage, DTO hydration,
   matrix, card, comparison, DOCX, PDF, courtesy copy, and synthesis generated by
   the new prompt. [PLANNED]
6. Execute the documented question rollback procedure in §4 and the audited prompt
   rollback in §5. Verify the exact prior question set and prior prompt, then
   republish the new prompt and target set and verify them again. [PLANNED]
7. Run a final controlled smoke against the republished target, then remove/reset
   all rehearsal records through sanctioned cleanup. Require no remaining test
   answer, draft, report/file, courtesy-email eligibility, or other unexpected
   side effect; any synthesis memo follows §8's explicit record-as-stale rule.
   Attach the evidence to the release record. [PLANNED]

This accepts the residual risk that production is the first environment where the
new schema, real configuration, prompt, and live integration seams are exercised
together. Dedicated records, server-side allowlists, captured email, an exposure
hold, immediate rollback, and reconciled cleanup limit—but do not eliminate—the
chance of durable test side effects or interference with production traffic.
[VERIFIED control requirements via
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:203-215`; residual risk is
ASSUMED]

No external reviewer is exposed until this exact production rehearsal, rollback,
republish, final smoke, and cleanup sequence is green. [PLANNED]

## 8. Exact audited cleanup path for the known test artifacts

No deletion is authorized by this plan. The owner has authorized the read-only
consumer probe below; its report is the prerequisite for a separate, explicit
approval naming the exact writes. Cutover is blocked until the cleanup completes.
[READ-ONLY PROBE COMPLETED 2026-07-26; CLEANUP BLOCKED]

The probe found a sent thank-you marker on
`6ad328b4-f044-f111-88b5-000d3a306d45`. Per step 2 below, processing stopped:
no deletion approval was requested, no suggestion/answer/draft/file/contact was
changed, and cutover remains blocked. The evidence bundle is
`outputs/review-form-multiselect/preactivation-evidence-2026-07-26.json`.
[VERIFIED]

The existing hard-removal service performs a preflight, writes a durable system
alert before deletion, removes answer rows and the suggestion in one Dataverse
changeset, removes the Postgres draft, attempts linked file cleanup, and finalizes
the audit with success or warnings. [VERIFIED via
`lib/services/reviewer-finder/remove-candidate-service.js:195-234`,
`lib/services/reviewer-finder/remove-candidate-service.js:246-426`, and
`pages/api/reviewer-finder/my-candidates.js:129-160`]

Use this **single audited procedure**, once for each exact suggestion ID:

1. Run a read-only preflight for
   `6ad328b4-f044-f111-88b5-000d3a306d45` and
   `3c4bb952-e061-f111-a826-000d3a306da2`. Capture one signed report containing:
   - **Request:** `_wmkf_request_value`, then request
     `akoya_requestid`, `akoya_requestnum`, `akoya_title`,
     `wmkf_reviewsynthesisjson`, and `modifiedon`.
   - **Person:** `_wmkf_potentialreviewer_value`, then person
     `wmkf_potentialreviewersid`, `wmkf_name`, `wmkf_emailaddress`, and
     `_wmkf_contact_value`.
   - **Lifecycle:** `wmkf_selected`, `wmkf_invited`, `wmkf_accepted`,
     `wmkf_declined`, `wmkf_responsetype`, `wmkf_reviewstatus`,
     `wmkf_reviewreceivedat`, `wmkf_completedat`, `wmkf_thankyousentat`,
     `wmkf_reviewuploadedbystaff`, `wmkf_reviewfilename`,
     `wmkf_reviewsharepointfolder`, `_wmkf_honorariumrequest_value`, and
     `wmkf_applicantdisposition`.
   - **Reports:** every answer snapshot’s `wmkf_appreviewanswerid`,
     `_wmkf_appreviewersuggestion_value`, `wmkf_questionkey`,
     `wmkf_questiontype`, `wmkf_questiontext`, `wmkf_answervalue`,
     `wmkf_answertext`, `wmkf_answerhtml`, and `wmkf_answervalues`; review-file
     pointers; and whether the record is included by the workbench DTO and report
     composers.
   - **Synthesis:** whether the suggestion passes the synthesis inclusion filter;
     the request’s `wmkf_reviewsynthesisjson` content/hash and `modifiedon`; every
     remaining suggestion included by `selectedOnly`, `wmkf_accepted`, and
     `wmkf_reviewreceivedat`; and whether the stored synthesis postdates the
     artifact review.
   - **Thank-you sweep:** `wmkf_reviewreceivedat`, `wmkf_thankyousentat`, the
     exclusion-filter result, `_wmkf_request_value`,
     `_wmkf_potentialreviewer_value`, reviewer `wmkf_emailaddress`, and program
     director `internalemailaddress` and `systemuserid`.
2. Require the report to classify each artifact as disposable and enumerate every
   consumer correction the hard removal will cause. If either artifact has a sent
   thank-you, honorarium dependency, retained report, or non-test owner, stop.
   Present that same report for expanded write authority;
   do not invent an alternate cleanup and do not proceed with cutover.
3. Obtain explicit owner approval for hard removal of both exact suggestion IDs,
   their answer rows, their Postgres drafts, and linked test review objects.
   Approval must also state `deleteContact:false`.
4. Under the existing superuser/app guard, call
   `DELETE /api/reviewer-finder/my-candidates` for each artifact with:

   ```json
   {
     "suggestionId": "<exact-id-above>",
     "mode": "hard",
     "deleteContact": false
   }
   ```

   The EICAR suggestion’s sentinel answer rows and the `Gallivan_test` suggestion’s
   draft are removed as children of the same audited suggestion-removal workflow.
5. Do not add a synthesis-cleanup service or make request-memo cleanup part of
   fixture removal. For each affected test request, preserve the preflight
   synthesis content/hash in the removal record and mark any non-empty memo as
   potentially stale after deletion. Leave it unchanged. If staff later needs a
   current synthesis and genuine submitted reviews remain, the existing
   `synthesizeReviews({ overwrite: true })` path regenerates from the remaining
   selected, accepted, received reviews and overwrites the memo. With no remaining
   submitted review, regeneration correctly refuses rather than requiring a
   bespoke clear operation. [VERIFIED via
   `lib/services/review-manager/synthesize-reviews-service.js:170-176` and
   `lib/services/review-manager/synthesize-reviews-service.js:192-215`]
6. Re-run the read-only probe and require: both suggestion lookups absent; no answer
   snapshots referencing either ID; no Postgres draft for either ID; no linked test
   review object; neither artifact eligible for a thank-you; any unchanged synthesis
   memo is explicitly recorded as potentially stale and regenerable; and both
   durable removal audits finalized without unresolved warnings. Attach before/after
   evidence and the owner approval to the cutover record. [PLANNED]

The synthesis inclusion filter requires selected, accepted suggestions with a
received-review timestamp, while the thank-you sweep evaluates a received review
with no sent timestamp and additional exclusion/sender conditions. These consumers
must therefore be probed explicitly rather than inferred from filenames.
[VERIFIED via
`lib/services/review-manager/synthesize-reviews-service.js:170-204` and
`lib/services/reviewer-thankyou-sweep.js:150-185`]

Leaving either artifact orphaned, deleting only the answer rows, deleting only the
draft, or bypassing the existing removal audit is prohibited. [PLANNED]

## 9. Production expand, activation, exposure, and rollback

### 9.1 Expand and prepare

1. Apply the additive `wmkf_answervalues` schema to production and verify metadata
   readback. **[COMPLETED 2026-07-26]** The production probe verified
   `LogicalName=wmkf_answervalues`, `SchemaName=wmkf_AnswerValues`,
   `AttributeType=Memo`, `MaxLength=150000`, `RequiredLevel=None`,
   `IsCustomAttribute=true`, and successful entity-set selection. No multiselect
   question was activated. [VERIFIED via
   `scripts/probe-review-answer-multiselect-field.mjs`]
2. Deploy the backward-compatible code: old question rows and old answer snapshots
   must behave exactly as before; new readers tolerate null `wmkf_answervalues`.
   **[COMPLETED 2026-07-26]** Commit `5282cee8` was fast-forwarded to `main`;
   Vercel production deployment `dpl_7sfTLrMafYPKp7mnYdrEVjs9HmW5` reached Ready,
   the sign-in surface returned 200, the external review context route rejected a
   malformed token fail-closed, and the read-only production question probe
   confirmed the prior 12-row set remained active.
3. Verify from independently routed production requests that each of the four
   write paths resolves the live `questionSetVersion` while the old question set
   is still active. Read paths may still serve a cached set for up to the TTL —
   that is the accepted residual in §0.2, not a defect. Four fresh-process,
   production-target service probes resolved `119da525418d1d43` and stopped
   before any write on 2026-07-26; independently routed production **HTTP**
   evidence remains outstanding. [SERVICE BOUNDARY VERIFIED; HTTP ROUTING PLANNED]
4. Execute the §8 consumer probe, obtain the separately required deletion
   approval, complete the single audited cleanup procedure, and attach its
   postconditions. The consumer probe completed 2026-07-26 and found the EICAR
   fixture's sent thank-you marker, so the mandated stop fired before approval
   or cleanup. [PROBE COMPLETED; CLEANUP BLOCKED]
5. Record the active and inactive question rows with IDs/ETags, normalized active
   version, and the completed question audit; record the current synthesis prompt
   identity/content/hash. Produce and review the §4 manual rollback dry-run manifest
   against the selected prior audit. The baseline rows, current prompt, and audit
   history were captured 2026-07-26. The stored template proves `impact` can be
   reactivated by its existing row ID but deliberately cannot prove the
   `impactAreas` row-ID deactivation until that row exists after publication;
   therefore the executable manifest/review remains pending. [BASELINE CAPTURED;
   EXECUTABLE MANIFEST PLANNED]

### 9.2 Primary rehearsal, rollback proof, republish, then expose

1. Publish the backward-compatible synthesis prompt from §5. Verify its current
   state and completed audit while the old question set is still active. [PLANNED]
2. Publish the exact target question set in §1.2 through the admin full-set save.
   Record the publication request ID needed by rollback. [PLANNED]
3. From independently routed requests, verify the same new
   `questionSetVersion`, exact key/type/order/options set, and a clean context,
   draft, and validation response. Any mixed version triggers immediate rollback.
   [PLANNED]
4. Run a controlled production smoke using a dedicated internal test suggestion,
   with external email disabled or captured by the sanctioned test mode. Exercise
   the real `impactAreas` configuration and new prompt end-to-end and satisfy every
   acceptance surface in §7. [PLANNED]
5. While external exposure remains closed, execute the §4 manual rollback
   changeset, require exact prior-version readback, and publish the recorded prior
   prompt as a new audited version. Then republish the new prompt and exact target
   question set and verify both again. [PLANNED]
6. Run the final controlled smoke against the republished configuration, then clean
   every rehearsal record through the sanctioned reset/removal path and reconcile
   the expected durable writes. [PLANNED]
7. Only after the primary smoke, rollback rehearsal, republish verification, final
   smoke, and cleanup evidence are green may external reviewers be exposed to the
   new form. [PLANNED]

### 9.3 Ordered rollback

If activation or the controlled smoke fails:

1. Stop external exposure and preserve the failed publication and prompt audit IDs.
2. Execute the reviewed §4 rollback manifest as one changeset, reactivating prior
   rows by immutable row ID and never POSTing an existing key; require exact
   prior-version readback across independently routed requests.
3. Publish a new prompt version containing the recorded prior prompt content and
   verify it is current.
4. Only after the old configuration is active may the last known-good application
   version be promoted; old code must never receive active `multiselect` rows.
5. Clean the controlled smoke record and reconcile its answer, draft, report,
   synthesis, and courtesy-email surfaces.

If only the new synthesis prompt fails after the form is otherwise healthy, publish
the recorded prior prompt as a new version and leave the compatible code and
question set in place. The nullable answer property remains after every rollback;
do not contract schema during an incident. [PLANNED]

## 10. Test contract

### 10.1 Canonical producer and corruption tests

Add focused tests proving:

- numeric request values become live-option `{value,label}` pairs;
- request order is ignored and live option order wins;
- duplicates are deduplicated;
- an unknown numeric value is rejected;
- a label string or `{value,label}` object is rejected as tampered-label input;
- required empty selection is rejected and optional empty selection becomes `[]`;
- corrupted stored JSON, a wrong shape, duplicate stored values, and invalid pairs
  produce the unreadable DTO marker without failing other answers;
- the row emitter writes `answerValue=null`, canonical JSON, and joined text;
- picklist/rich-text/string rows write null multiselect storage.

### 10.2 Every entry point

For portal submit, manual entry, legacy upload, and mark-received, prove:

- the same live question set and canonicalizer are used;
- multiselect rows are emitted once per question;
- `riskLevel` and `overallAssessment` are the only core rating snapshots;
- partial failure does not leave an answer-only commit outside the existing
  changeset boundary;
- draft cleanup remains post-success and does not change answer durability.

The portal builder currently emits answer rows into the submission changeset, and
the answer alternate key enforces one row per suggestion/question.
[VERIFIED via `lib/external/build-review-submission.js:182-210` and
`lib/dataverse/adapters/review-answer.js:173-199`]

### 10.3 UI, admin, and outputs

Add tests for:

- hydration from a numeric-array draft, including stale option removal;
- native checkbox interaction, required validation, reload, and submission;
- admin create/edit/reorder/serialize for multiselect options;
- rejection of duplicate option values and blank labels;
- parent-bound enforcement with exactly `affiliation`, `riskLevel`, and
  `overallAssessment`;
- numeric matrix averages excluding multiselect rows;
- categorical tally behavior across historical label changes;
- card, comparison, DOCX, PDF, courtesy copy, and synthesis rendering;
- corrupt multiselect storage exclusion from tallies and synthesis;
- old question-set and old-answer regressions during expand;
- write-boundary authority: a stale cached set must not let a superseded
  `setVersion` pass the `set_changed` guard;
- manual question restore manifest/execution and audited prompt rollback.

### 10.4 Gates

Run the repository’s relevant gate and self-test pairs sequentially, followed by
type checks, focused tests, the full test suite, and the production build. Gate
selection and ordering come from the live CI reference at implementation time.
[VERIFIED via `docs/CI_GATES_REFERENCE.md:1-25`]

At minimum, changed-surface validation includes instruction invariants, docs
frontmatter/catalog checks, state-Atlas checks, Dataverse schema safety, service
contracts, prompt governance, security checks for any touched route, lint, tests,
and build. [VERIFIED 2026-07-26 via paired gates/self-tests, type check, lint,
516 Jest suites / 6,128 tests, 7 focused Playwright scenarios, and Next.js build]

## 11. Durable-surface reconciliation

In the implementation commit, update:

- `docs/atlas/dataverse-wmkf-appreviewanswer.md` for
  `wmkf_answervalues`, canonical JSON, and corrupt-row behavior;
- `docs/atlas/dataverse-wmkf-reviewquestion.md` for `multiselect`;
- `docs/atlas/postgres-review-drafts.md` for numeric-array draft values;
- source headers and `docs/SERVICE_AND_UTILITY_CATALOG.md` where public service
  contracts change;
- prompt governance records for the published synthesis prompt;
- the active reviewer-form memory so it no longer says the target includes
  checkbox-plus-free-text `Other` or that test artifacts can be treated as absent.

The older completed-epic authoring plans are historical design records; annotate
their staleness only if the repository’s durable-doc rule requires it rather than
rewriting history. [IMPLEMENTED IN SOURCE/DURABLE DOCS]

The current active memory still describes a broader checkbox-plus-`Other` ask and
states that the test data makes keys freely redefinable. Draft 4 deliberately does
not rely on either claim. [VERIFIED via
`.claude-memory/project-review-form-checkbox-questions.md:1-22` and
`.claude-memory/project-review-form-checkbox-questions.md:59-78`]

## 12. Completion checklist

The release is complete only when all of the following are evidenced. Checked
source items are implemented on the feature branch; unchecked production items
remain release gates and must not be inferred from code completion:

- [x] The §0.2 write-boundary coherence fix is implemented and every write path
  resolves authoritatively.
- [x] `CORE_RATING_KEYS` and `PARENT_BOUND_KEYS` resolve exactly as §1.1 states.
- [x] `riskLevel` and `overallAssessment` carry the prior ratings' meanings, labels, and
  numeric domains under new keys.
- [x] The exact §1.2 mapping is encoded: retain only `affiliation`; retire the
  other eleven legacy keys and create all eleven numbered target keys.
- [x] The additive answer property has a reviewed wave-15 schema package.
- [x] The additive answer property is provisioned and read back.
- [x] The one authoritative canonicalizer owns validation, deduplication, ordering,
  label construction, JSON, and joined text.
- [x] Every type gate in §3 is implemented and classified.
- [ ] The real target multiselect configuration and versioned prompt have passed
  the primary controlled-production rehearsal and rollback rehearsal.
- [ ] Both named test artifacts have passed the consumer probe, received explicit
  deletion authority, and completed the one audited cleanup procedure. The
  2026-07-26 probe stopped because the EICAR fixture has a sent thank-you marker;
  no deletion authority was requested and no cleanup ran.
- [ ] The prompt is published before production question-set activation.
- [ ] Controlled production smoke and cleanup are green before external exposure.
- [ ] Question rollback is executable from the reviewed manual manifest and
  preserved release evidence; prompt rollback is audited; both are ordered and
  rehearsed.
- [x] Corrupt JSON, tampered labels, unknown values, and duplicates are tested.
- [x] Matrix, cards, comparisons, DOCX, PDF, courtesy copy, and synthesis have
  source-level focused coverage.
- [ ] Production presentation, synthesis, and unchanged thank-you behavior are
  verified in the controlled rehearsal.
- [x] Relevant gates, tests, and build are green for the feature branch.
- [x] Atlas, service catalog, source prompt contract, and active memory agree with
  the implemented-vs-production-pending boundary.

## 13. Explicit non-goals

- No checkbox-plus-free-text `Other` behavior.
- No row-per-option answer storage.
- No Dataverse multi-select Choice property.
- No schema contraction during rollout or rollback.
- No client-supplied labels.
- No orphaned fixture answers or drafts.
- No deletion without the separately recorded approval required by §8.
- No TTL waits, hybrid question sets, or additional cache layers to close the
  accepted read-path residual in §0.2.
