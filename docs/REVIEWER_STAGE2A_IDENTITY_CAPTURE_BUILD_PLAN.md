---
title: "Reviewer Board-Writeup Identity Capture — Build Plan (PERSON-SCOPE)"
domain: reviewer-workbench
kind: plan
status: active
summary: "(engagement-scope v1, then person-scope v2). Supersedes the engagement-scope v1 (storage changed from per-request to person-level per owner..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/services/capture-self-reported-orcid.js
  - pages/api/reviewer-finder/my-candidates.js
  - shared/components/external/Stage2aView.js
  - "pages/api/external/review/[token]/respond.js"
---

# Reviewer Board-Writeup Identity Capture — Build Plan (PERSON-SCOPE)

Status: **DESIGN LOCKED — implementing S308.** Two Codex design passes complete
(engagement-scope v1, then person-scope v2). Supersedes the engagement-scope v1
(storage changed from per-request to person-level per owner decision below).

**Canonical field names (LOCKED — schema-apply is creation-only, cannot rename in prod):**
`wmkf_AcademicRank`, `wmkf_PrimaryDepartment`, `wmkf_MainInstitution`.

**Two Codex-v2 findings folded in:**
- The non-fatal person write has NO suggestion-row fallback (unlike ORCID), so a silent
  failure loses REQUIRED data → on capture failure, fire `NotificationService.notify`
  (the existing required-path failure pattern), AND ship the workbench edit in the SAME
  commit so staff can repair without a redeploy.
- 3 NEW fields confirmed (no direct COI reader of `wmkf_primaryaffiliation`, but
  overwriting would degrade card display + identity scoring — not worth it).

**Deploy-ordering gate:** the code `$select`s the new columns; selecting a not-yet-created
column hard-400s the query. So the prod schema apply MUST land before this code deploys —
the commit is held from push until Justin/Connor confirm provisioning.

## Goal

Capture three clean, reviewer-confirmed board-writeup identity values for each
reviewer, **required at Stage 2a acceptance**, AND surface + edit them when staff
click a reviewer in the workbench. Stored at **person level** (canonical, current).

### Owner spec (requesting colleague, verbatim intent)

> "Have THEM enter their current ACADEMIC rank (some may be Member, Investigator,
> or Group Leader, but I don't care to know if they're Chair, Vice Provost, Dean,
> Director etc.), PRIMARY department only (some are affiliated with multiple
> departments), and the MAIN Institution (rather than a Center or Institute that
> is part of a larger org) to keep things simple."

### Decisions locked with the owner (S308)

- **Storage = PERSON-LEVEL** (`wmkf_potentialreviewers`), ONE canonical current value
  per reviewer — NOT a per-request engagement snapshot. Rationale: owner wants the
  data surfaced + editable when clicking a reviewer in the workbench, feeding a future
  reviewer-database browse and a writeup-generator tab. **No versioned history** on the
  person is needed — the writeup is the moment-in-time work product that freezes the
  values as of generation.
- **Academic rank = free text** with a guiding placeholder (NOT a dropdown).
- **All three required at accept**, no skip / "not applicable" path.
- **Prefill** department + main institution from existing person enrichment data; rank blank.
- **Capture at accept = reviewer self-report → person write**, mirroring the ORCID
  self-report pattern (high-trust, overwrites a prior enrichment guess). [VERIFIED precedent via `lib/services/capture-self-reported-orcid.js:1-90`]
- **Staff edit** in the workbench reviewer-edit modal (`CandidateEditModal`), via the
  same person PATCH the modal already uses for name/affiliation. [VERIFIED path via `pages/api/reviewer-finder/my-candidates.js:551-583` → `potentialReviewerAdapter.update`]
- **Provisioning:** Claude preps schema-as-code + dry-run; Justin/Connor run prod apply.

## Field shape (new columns on `wmkf_potentialreviewers`)

| New column (schemaName) | logical name | Type | Max | Meaning | Prefill source |
|---|---|---|---|---|---|
| `wmkf_AcademicRank` | `wmkf_academicrank` | String | 200 | Reviewer-confirmed current academic rank (Professor / Assoc / Asst Prof / Member / Investigator / Group Leader…). NOT an administrative title. | none (blank) |
| `wmkf_ReviewerPrimaryDepartment` | `wmkf_reviewerprimarydepartment` | String | 255 | PRIMARY department only. | person `wmkf_department` (enrichment) |
| `wmkf_MainInstitution` | `wmkf_maininstitution` | String | 255 | MAIN institution (parent org, not a Center/Institute within it). | person `wmkf_primaryaffiliation` (enrichment) |

**Why new fields, not reuse:** the person already has enrichment-sourced
`wmkf_department` and `wmkf_primaryaffiliation`, but those are auto-populated guesses;
the colleague wants clean reviewer/staff-CONFIRMED values. Keeping them distinct (a)
preserves the enrichment values as prefill, (b) avoids changing the meaning of
`wmkf_primaryaffiliation`, which COI/affiliation-matching and the reviewer-card display
read [ASSUMED blast radius — confirm in Codex pass]. Academic rank has no clean person
field at all (`wmkf_title` is generic/administrative and syncs to contact `jobtitle`).

RequiredLevel stays **None** in Dataverse — the person row is created by enrichment
paths without these fields; Dataverse-required would break those writes. "Required" is
enforced in the accept UI + route only. [VERIFIED creation-without-fields concern via Codex v1 review: `reviewer-suggestion.js:415/449`, `schema-apply.js` creation-only]

## Cross-layer contract (caller → persistence → consumer)

### A. Capture at Stage 2a accept (reviewer self-report → person)

1. **UI `shared/components/external/Stage2aView.js` + `ContactConfirmCard`** — three new
   REQUIRED inputs (Academic rank w/ placeholder; Primary department; Main institution w/
   help text "the parent organization, not a center or institute within it"). Client-side
   required block in `handleAccept` mirroring the address-required block [VERIFIED `Stage2aView.js:147-162`]; flag empty fields inline; reason-code handling [VERIFIED `:200-228`].
2. **Accept payload** — send the three as a NEW dedicated payload object
   `boardIdentity: { academicRank, department, institution }`, NOT inside `contactEdits`
   (contactEdits is allowlisted to engagement contact fields via `CONTACT_EDIT_MAX` at
   [VERIFIED `respond.js:65`] and persists to the engagement row; these go to the PERSON).
3. **Route `pages/api/external/review/[token]/respond.js`** — inside the fresh-accept
   block (`!isAcceptRepeat`, [VERIFIED `respond.js:479`]) and BEFORE commit:
   - **Required validation**: trimmed `boardIdentity` values all non-empty, else 400
     reason `board_identity_required` + `fields` array. Use `String(...).trim()` (existing
     precedent [VERIFIED `respond.js:124`]).
   - After the engagement accept commits, **capture to the person** via a new service
     `captureSelfReportedReviewerIdentity({ potentialReviewerId, academicRank, department,
     institution })` modeled on `captureSelfReportedReviewerOrcid` — NON-FATAL (the accept
     already committed; validation already guaranteed the values were provided). [VERIFIED pattern `capture-self-reported-orcid.js`; call-site precedent `respond.js` `captureReviewerSelfReportedOrcid`]
4. **Person adapter `lib/dataverse/adapters/potential-reviewer.js`** — extend `update()`
   destructure + payload + clamp map [VERIFIED `:265-300`] with `academicRank`,
   `primaryDepartment`, `mainInstitution` → the 3 logical columns; add the 3 columns to the
   person SELECT [VERIFIED `:14-27`]. The new capture service writes through this adapter.

### B. Prefill (so three required fields aren't friction)

5. **`lib/external/verify-suggestion-token.js`** — add `wmkf_department` + the 3 new
   columns to `REVIEWER_SELECT` [VERIFIED via Codex v1: `verify-suggestion-token.js:78/82`]
   so the reviewer record carries them.
6. **`pages/api/external/review/[token]/context.js buildStage2aPrefill`** [VERIFIED `:293-320`] —
   add `academicRank: reviewer?.wmkf_academicrank || ''`,
   `department: firstNonEmpty(reviewer?.wmkf_reviewerprimarydepartment, reviewer?.wmkf_department)`,
   `institution: firstNonEmpty(reviewer?.wmkf_maininstitution, reviewer?.wmkf_primaryaffiliation, reviewer?.wmkf_organizationname)`.
   (On a re-accept the reviewer's prior confirmed value wins; first time, the enrichment value seeds it.)

### C. Staff surface + edit in the workbench

7. **`pages/api/reviewer-finder/my-candidates.js`** — add the 3 columns to the person
   SELECT (`fetchPotentialReviewers` / `fetchResearchersByPerson` [VERIFIED `:332-386`]);
   emit `academicRank` / `primaryDepartment` / `mainInstitution` on the candidate DTO
   [VERIFIED DTO build `:199-246`]; in `handlePatch` person-edit section [VERIFIED `:551-583`]
   route the 3 into `potentialReviewerAdapter.update`.
8. **`shared/components/reviewers/CandidateEditModal.js`** — add the 3 editable fields
   (clicking a reviewer in Invite/Track surfaces them); send in the PATCH body.
9. **(Optional this build)** surface read-only on `ReviewerInvitePanel` / Track Reviewers
   cards. The Excel export we shipped this session could add columns as a fast-follow.

### D. Docs / gates

10. **Atlas** `docs/atlas/dataverse-wmkf-potentialreviewers.md` — document the 3 new person
    fields (required for `check:atlas`).
11. **Agent wiki** — `reviewer-identity.md` (person identity) + `reviewer-workbench-lifecycle.md`
    (capture + edit surface): the capture-timing model and the 3 fields.
12. **API security matrix** — no new route; note the `respond.js` + `my-candidates` payload additions.

## Open questions for the 2nd Codex design review

1. **Department/institution: new fields vs. overwrite the enrichment fields?** The ORCID
   precedent OVERWRITES the enrichment guess (`wmkf_orcid`) on self-report and marks it
   confirmed-sticky. Should `department`/`institution` likewise overwrite `wmkf_department` /
   `wmkf_primaryaffiliation` (fewer columns, matches precedent) — or stay as 3 new fields
   (this plan) to avoid the COI/affiliation-display blast radius on `wmkf_primaryaffiliation`?
   Trace who reads `wmkf_primaryaffiliation` and whether institution-only would break them.
2. **Capture write fatality.** Plan makes the person-write NON-FATAL post-commit (mirrors
   ORCID). For *required* board data, is non-fatal acceptable (staff can fix in workbench),
   or should it be part of the committed accept transaction?
3. **Payload channel.** New `boardIdentity` object vs. extending `CONTACT_EDIT_MAX`. Confirm
   the dedicated object is the right call given the person (not engagement) destination.
4. **Provenance/identity-status interaction.** The ORCID capture writes a sticky `confirmed`
   identity decision. Do rank/dept/institution need any provenance marker, or is a plain
   person-field write sufficient (no resolver involvement)?
5. **Trust-boundary.** The workbench PATCH must keep using the server-derived
   `personId` (from the suggestion), never a client id — same GUID-validation as today.
   Confirm the new fields don't open a new client→selector path.

## Provisioning order (must-not-reorder)

1. Merge schema-as-code (this build) — no runtime effect alone.
2. Dry-run `node scripts/apply-dataverse-schema.js --wave=10-reviewer-board-identity` (no `--execute`).
3. Justin/Connor run prod apply: `--target=prod --wave=10-reviewer-board-identity --execute`.
   [VERIFIED `--wave=` string-suffix support + default wave=1 via Codex v1: `apply-dataverse-schema.js:36/41`]
4. THEN deploy the code that selects/writes the new columns (selecting a not-yet-created
   column returns 400). [VERIFIED via Codex v1: `schema-apply.js` creation-only; deploy-order hazard]

## Tests

- Person adapter `update()`: the 3 keys map to the right columns + clamp + no-op-diff.
- New capture service: writes the 3 to the person; non-fatal on adapter throw; skips on no person.
- `respond.js`: accept BLOCKS (400 `board_identity_required`) when any of the three is blank/whitespace on a fresh accept; SUCCEEDS when all present; repeat-accept path untouched.
- `my-candidates` PATCH: the 3 fields persist via `potentialReviewerAdapter.update`; DTO emits them.
- `Stage2aView` / `CandidateEditModal`: required block + inline errors; populated submit posts the 3.
