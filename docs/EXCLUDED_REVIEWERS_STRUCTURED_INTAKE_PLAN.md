---
title: Excluded Reviewers Structured Intake Plan
domain: reviewer-origination
kind: plan
status: active
summary: "Structured name/affiliation/email exclusion rows in Dataverse; backend ships first, Connor's intake-form change binds to the schema later."
canonical: false
cataloged: 2026-08-04
last_verified: 2026-08-04
owner: product-engineering
related:
  - docs/atlas/dataverse-akoya-request.md
  - docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
  - docs/agent-wiki/topics/intake-portal.md
---

# Excluded Reviewers Structured Intake Plan

**Owners:** Justin (Dataverse schema + backend consumption, this repo) and
Connor (intake form UX + row writes, outside this repo). The two sides meet in
Dataverse: the schema defined here is the shared contract. The backend
infrastructure is deliberately buildable and testable **before** any form
change exists.

## 1. Background and problem

Applicants list reviewers they want excluded in one free-text field on the
request, `akoya_request.wmkf_excludedreviewers` (Memo). Today:

- **No code in this repo writes the field** — it arrives from the intake side
  [VERIFIED 2026-08-04 via repo-wide grep: readers only —
  `lib/services/reviewer-exclusion-parser.js`,
  `lib/services/workbench/applicant-reviewers-service.js`, display in
  `shared/components/reviewers/ReviewerFindPanel.js`, plus explorer prompt and
  probe scripts].
- To use the text as a search soft-block, the Find tab has Claude Haiku parse
  names out of it on **every mount** where the text is substantive — an
  uncached, deterministic LLM call
  [VERIFIED via `lib/services/reviewer-exclusion-parser.js:133-164`].
- Measured prevalence: **43 of 570** December-2026-window requests (~8%) have
  substantive text; 76 have any text; substantive entries run 13–920 chars,
  median 208 [VERIFIED 2026-08-04 via GET-only production survey
  (S398, owner-authorized one-off prod read); denominator = all
  `akoya_request` rows in the D26 meeting-date window, fetched independently
  of the numerator filter].
- Free-text names are the weak link: nicknames, initials, and spelling
  variants make matching against candidates conservative and fuzzy.

**Design principle for the fix:** collect the strongest key available — email;
the canonical reviewer pool is email-keyed [VERIFIED via
`lib/dataverse/adapters/potential-reviewer.js:245` `upsertByEmail`] — and
resolve name fuzziness at match time, not entry time. The applicant cannot
disambiguate identities for us; a wrong hard link is worse than fuzz.

## 2. What is deliberately preserved (S210 invariants)

These carry over unchanged from the S210 decision [VERIFIED via the decision
record quoted in `lib/services/workbench/applicant-reviewers-service.js:20-26`]
and are non-negotiable in both the schema and every consumer:

1. Exclusions are a **per-request soft-block only**. Nothing global is
   written; an applicant's exclusion never affects the person's eligibility on
   any other request.
2. No structured link from an exclusion entry to a
   `wmkf_potentialreviewers` record **at intake time**. Entries store what the
   applicant typed. Matching happens downstream at search time, where staff
   see (and can override) the result.
3. Soft-block failure mode: over- and under-matches surface to staff rather
   than silently removing or admitting candidates.

## 3. Schema proposal (the Dataverse contract with Connor)

### New child entity: `wmkf_appexcludedreviewer`

One row per person the applicant asks to exclude. 1:N from `akoya_request`.
Created via this repo's creation-only schema applier so it lands in the
`ResearchReviewAppSuite` solution [VERIFIED via
`scripts/apply-dataverse-schema.js:17-19`].

| Field | Type | Required | Notes |
|---|---|---|---|
| `wmkf_name` | Text (200) | Yes | As typed by the applicant. Primary name field of the entity. |
| `wmkf_affiliation` | Text (300) | No | Institution/lab as typed. Encouraged on the form. |
| `wmkf_email` | Text (200) | No | **The high-value key.** Form validates format only — never verifies. Optional so friction doesn't suppress it. |
| `wmkf_note` | Text (500) | No | Applicant's stated reason, if the form collects one. |
| `wmkf_requestid` | Lookup → `akoya_request` | Yes | Owning request. Cascade-delete with the request. |
| `wmkf_source` | Choice: `applicant` / `staff` | Yes, default `applicant` | Lets staff add/correct rows in CRM later without pretending the applicant wrote them. |

Naming follows the existing `wmkf_app*` junction convention
(`wmkf_appreviewersuggestion`, `wmkf_apprequestperson` — both carry Atlas
pages) and the human-legibility schema principle: plain names, one row = one
person, readable in Advanced Find without decoding.

### The legacy field stays, re-purposed as overflow

`wmkf_excludedreviewers` is **not** retired. It becomes the "other
exclusions" free-text field for what rows cannot express ("anyone from the
Smith lab", "no one at UCSF", former collaborators as a class). If the form
removed free text entirely, applicants would cram these into name fields and
the structured data would be worse. Existing requests keep their text and
keep working unchanged.

### Considered and rejected

- **JSON blob in a Memo on `akoya_request`** — not editable as a subgrid on
  Connor's form or in CRM, not human-legible in Advanced Find, and repeats the
  parse-at-read pattern we are removing.
- **Lookup to `wmkf_potentialreviewers` per row** — violates invariant #2;
  forces identity resolution onto the applicant.

## 4. Consumption contract (how the backend reads it)

Effective exclusion list for a request =
**structured rows ∪ parse(overflow text)**:

1. Read all `wmkf_appexcludedreviewer` rows for the request (new adapter).
2. Parse `wmkf_excludedreviewers` exactly as today — the existing
   deterministic noise filter (`isSubstantiveExclusionText`) already
   short-circuits non-substantive text
   [VERIFIED via `reviewer-exclusion-parser.js:134-136`], so requests whose
   content fully moved into rows cost **zero LLM calls** automatically. No
   migration of old text is required.
3. Matching against candidates, in strength order:
   - **email exact** (normalized casing) — decisive;
   - **normalized last name + affiliation** — strong;
   - first-name variance (Bob/Robert, initials) — weak evidence only, never
     sufficient alone.
   The existing exact-match vs fuzzy-author partition stays separate
   [ASSUMED — matching sites in `reviewer-search-logic.js` and the
   `/discover` server-side dedup to be re-verified at build time; prior
   session guidance (S224) says the exact and fuzzy passes must never merge].

Consumers to touch (all readers, verified in §1): the applicant-reviewers
service response (`excluded` array gains optional `email`/`affiliation`
per entry), the Find panel soft-block display, and the search-side filter.
The response shape change is additive.

## 5. Build phases

### Phase A — schema wave (no front end needed)

1. Wave spec `lib/dataverse/schema/wave18-excluded-reviewer-entity/` (entity +
   attributes + lookup + choice), following the wave17 spec shape
   [VERIFIED via `lib/dataverse/schema/wave17-reviewer-address-trust/`].
2. Read-only metadata preflight script
   (`scripts/preflight-excluded-reviewer-entity.mjs`, mirroring
   `preflight-reviewer-address-trust-field.mjs`): absent or exact-match is
   safe; divergent existing schema blocks.
3. Apply to **sandbox** first (`apply-dataverse-schema.js --wave=18-… --execute`),
   then prod with explicit `--target=prod --execute` after preflight.
4. Update `docs/atlas/dataverse-akoya-request.md` (+ new entity Atlas page)
   and run `check:atlas`.

### Phase B — backend consumption (no front end needed)

1. Adapter `lib/dataverse/adapters/excluded-reviewer.js`: `listByRequest`
   (read), `createEntry` (used by tests/backfill and any future staff-side
   add; DAL-context enforced like every entity write).
2. Service: `applicant-reviewers-service.js` unions rows + parsed text per §4;
   additive response fields.
3. Matching upgrade in the search-side exclusion filter (email exact first).
4. Tests: union semantics; rows-only request produces zero LLM calls;
   legacy-text-only request behaves exactly as today; email-match beats
   name-variant miss (the "R. Chen / Robert Chen" case).
5. Seed 1–2 sandbox rows by script to smoke end-to-end without any form.

### Phase C — Connor's form lands (his timeline)

1. Form writes rows (name required, affiliation encouraged, email optional
   format-validated) + keeps the overflow text area, labeled for non-person
   exclusions.
2. Joint smoke on one sandbox request: form rows → Find tab soft-block shows
   them; email-keyed exclusion suppresses the right candidate.
3. Only then: production form cutover, Connor's side.

Phases A and B are Tier 1 (additive schema + additive runtime behavior in the
production reviewer app): branch → sandbox → review → deliberate promotion,
per the campaign release strategy. Phase C is outside this repo.

## 6. Reconciliation meeting agenda (Justin × Connor)

1. Confirm entity/field names and types above (rename freely before the wave
   ships; renames after are expensive).
2. Who creates schema: this repo's wave applier does (solution-bound);
   Connor's form binds to existing schema — confirm he needs no schema-create
   permissions of his own.
3. Validation split: form does format-only email validation + required-name;
   backend trusts shape, never trusts content (names/emails remain untrusted
   applicant input — the parse path already wraps them via
   `wrapUntrustedContent` [VERIFIED via `reviewer-exclusion-parser.js:138-144`];
   structured rows must get the same treatment anywhere they enter a prompt).
4. Does CRM staff editing of rows (subgrid on the request form) ship at the
   same time, or later? (`wmkf_source=staff` exists either way.)
5. Timing: Phase A/B can be done before the form work starts; agree the
   sandbox smoke date.
6. Overflow-text field label/copy on the form, so applicants put people in
   rows and categories in text.

## 7. Non-goals

- No global or cross-request exclusion semantics (invariant #1).
- No identity resolution or reviewer-record links at intake (invariant #2).
- No hard blocks — soft-block display and search suppression only.
- No backfill/migration of existing free text into rows (legacy path remains
  correct; old requests are two searches a year away from irrelevant).
- No retirement of the Haiku parse (it stays for overflow text; it simply
  stops firing where rows carry the content).

## 8. Open questions

1. Should the form cap rows (e.g. 10)? Recommend a soft cap with the overflow
   text as the escape hatch.
2. Does Connor's intake surface write to Dataverse directly or through an
   intermediary (Power Pages / Flow)? Determines whether `wmkf_source`
   default can be trusted or must be enforced server-side.
3. Do we want a Find-tab affordance for staff to add an exclusion row
   (Phase B scope creep — default no; revisit after Phase C).
