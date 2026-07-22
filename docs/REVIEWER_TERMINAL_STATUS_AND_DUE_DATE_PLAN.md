---
title: Reviewer Terminal Status and Stamped Review Due Date
domain: engineering-process
kind: plan
status: active
summary: "Terminal post-accept reviewer statuses (withdrew / released) plus a due date stamped at send, so reviewer reliability is measurable."
canonical: false
cataloged: 2026-07-22
owner: product-engineering
related:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
---

# Reviewer Terminal Status and Stamped Review Due Date

Owner decisions, 2026-07-22 (S369). Durable intent and rationale:
`.claude-memory/project-reviewer-reliability-data.md`. Every material claim below
is labelled `[VERIFIED via <file:line>]` (read this session) or `[ASSUMED]`.

## Problem

A reviewer who accepts and then never delivers has **no terminal state**.
`[VERIFIED via lib/dataverse/adapters/reviewer-suggestion.js:48]` `REVIEW_STATUS_MAP`
is `accepted → materials_sent → under_review → review_received → complete`.
`[VERIFIED via lib/services/review-manager/withdraw-sufficient-service.js:54]`
`isStillPending()` requires `wmkf_accepted !== true`, so the existing
`withdrawn_sufficient` path structurally cannot express an accepted reviewer
bailing.

The PD's available workaround corrupts data.
`[VERIFIED via lib/dataverse/adapters/reviewer-suggestion.js:1244]`
`updateLifecycle()` stamps `wmkf_completedat` **and `wmkf_reviewreceivedat`** on
any transition to `complete` when those fields are empty.
`[VERIFIED via lib/dataverse/adapters/reviewer-suggestion.js:346]`
`aggregateReviewHistory()` computes each person's cross-request review count as
exactly `filter: wmkf_reviewreceivedat ne null`. So marking a dropout `complete`
writes a permanent false positive into that person's `priorReviewCount` for every
future cycle — inverting the signal, since the worst deliverers are the most
likely to be misrecorded as reliable.

Timeliness is separately unmeasurable:
`[VERIFIED via lib/services/review-manager/campaign-config-service.js:31-39]`
`reviewDueDate` → `wmkf_reviewduedate` sits in `WRITABLE_FIELDS` on `akoya_request`,
so extending a deadline retroactively rewrites every timeliness verdict on that
proposal.

## Scope

Two additive changes. **No teardown, no deletion, no honorarium mutation.**

1. Terminal post-accept statuses `withdrew` and `released`.
2. `wmkf_ReviewDueDateAtSend` stamped onto the engagement row at materials-send.

Out of scope: the payability disposition
(`.claude-memory/project-reviewer-closeout-payability.md`), the pre-accept reset
button, and any reliability metric or UI — the metric is a separate owner
discussion.

## Decision 1 — two values, not one

`withdrew` = the reviewer bailed after accepting (counts against reliability).
`released` = WMKF stood them down post-accept, e.g. enough reviews arrived
(reliability-neutral). Collapsing them would penalize reviewers for WMKF's own
scheduling, which is worse than no data. Mirrors the pre-accept
`withdrawn_sufficient` distinction.

## Decision 2 — stamp the due date at send

Stamp the request's `wmkf_reviewduedate` onto the engagement row when materials
are sent. Decided up front because the history is unrecoverable otherwise. Stamp
**only when empty**, so a re-send never rewrites the deadline the reviewer was
first held to — matching the idempotent-stamp convention already used in
`updateLifecycle`.

## Verified fan-out

Non-test consumers of `reviewStatus` were fully enumerated — 26 files, 15 runtime + 11 under `scripts/` [DERIVED-FROM: `grep -rln 'reviewStatus\|wmkf_reviewstatus' lib/ pages/ shared/ scripts/` minus tests, 2026-07-22; counted directly from that output, independent of the Stage 1 option-value TBD]. Findings that change the design:

| Site | Behavior | Consequence |
|---|---|---|
| `[VERIFIED via lib/external/review-engagement-state.js:40,48]` | **Numeric ordering**: `reviewStatus < REVIEW_STATUS_MATERIALS_SENT` and `>= REVIEW_STATUS_MATERIALS_SENT` gate the portal reversibility lock | New values sort ≥ materials_sent, so the portal refuses to flip a terminal row — desirable, but must be **asserted deliberately**, not inherited by accident |
| `[VERIFIED via lib/services/reviewer-reminder-sweep.js:192]` and `reviewer-manual-reminder.js:76` | Chase only `materials_sent` / `under_review` | Terminal rows leave reminder chasing automatically — no change, assert it |
| `[VERIFIED via lib/services/reviewer-rollup.js:69]` | `completed += 1` only on `COMPLETE` | Terminal rows are not counted as completed — no change, assert it |
| `[VERIFIED via lib/services/review-manager/send-emails-service.js:693-697]` | The `thankyou` branch writes `reviewStatus: 'complete'` **unconditionally** | A thank-you to a terminal row resurrects it and stamps the false positive. **Must guard.** |
| `[VERIFIED via lib/services/review-manager/send-emails-service.js:673-681]` | The `materials` branch already writes `materialsSentAt` on every send | The stamp site for `reviewDueDateAtSend` |
| `[VERIFIED via shared/components/reviewers/reviewer-modes.js:17,32,38]` | `STATUS_PIPELINE` / `MODE_STATUSES` / `MODE_WORK_REMAINING` | Add to the first two, **exclude from the third** |
| `[VERIFIED via lib/services/review-manager/reviewers-service.js:59]` | `REVIEW_STATUS_BY_VALUE` inverse map is **hand-maintained** (unlike `RESPONSE_TYPE_BY_VALUE:69`, derived from the adapter) | Must gain both values or the DTO emits an unmapped status |

### The invariant that will not catch a mistake

`reviewer-modes.js:12-16` documents a "no fallthrough" invariant: every status
must land in exactly one `MODE_STATUSES` bucket or the reviewer vanishes from all
sub-tabs. **That invariant is weakly enforced.**

`[VERIFIED via scripts/check-status-enum-parity.js:91-141]` the gate registers
four pairs and this is not one of them.
`[VERIFIED via tests/unit/reviewer-modes.test.js:23-25]` the only guard compares
`STATUS_PIPELINE` against a **hardcoded `API_STATUSES` literal**, whose comment
still points at `pages/api/review-manager/reviewers.js` although
`REVIEW_STATUS_BY_VALUE` now lives in `reviewers-service.js`.

Consequence: adding the statuses to the adapter and service but **not** to
`reviewer-modes.js` passes every gate and every test while the reviewer silently
disappears from the Track tab — the exact failure the invariant exists to prevent.
Registering this pair in `check:status-enum-parity` is therefore **in scope**.

## Implementation

### Stage 1 — schema (two DIFFERENT provisioning mechanisms)

**A schema wave CANNOT extend an existing picklist.**
`[VERIFIED via lib/dataverse/schema-apply.js:264-274]` `ensureAttribute()` returns
`{created: false}` the moment the attribute exists, so option-adds via a wave spec
are a **silent no-op**. `[VERIFIED via
lib/dataverse/schema/wave4-existing/wmkf_apprequestperson-roster-fields.json:5]`
the repo already documents this trap verbatim: "schema-apply.js is creation-only
… option-adds to an existing picklist are a silent no-op via a wave spec." The
wave6 precedent this plan originally cited *created* a new picklist attribute; it
did not extend one. Splitting accordingly:

**1a — new column via a wave (creation-only).** New wave dir
`lib/dataverse/schema/wave14-reviewer-terminal-status/` containing **only**
`wmkf_ReviewDueDateAtSend` (DateOnly) on `wmkf_appreviewersuggestion`. Apply with
`node scripts/apply-dataverse-schema.js --target=<env> --wave=14 --execute`.

**1b — picklist options via a standalone idempotent script.** Model on
`[VERIFIED via scripts/extend-responsetype-picklist-held.mjs]`, which extends a
picklist on this same entity and is the closest precedent. It must, in order:
probe the LIVE option set and print it; **refuse to no-op on a label collision**
(value present with a different label → exit 1); `InsertOptionValue` with the
solution header; **assert the returned `NewOptionValue` equals the requested
value** (a publisher option-value-prefix remap would silently invalidate
`REVIEW_STATUS_MAP`); `PublishAllXml`; then re-read and verify the option is
present, failing if not.

Do **not** hand-assert the option integers — the script probes for the next free
value. `[ASSUMED]` the contiguous block continues past `100000004`; the live probe
is what settles it.

**Ordering:** 1a and 1b must both succeed in an environment before any Stage 2
code that writes the new statuses is deployed to it, or status writes fail.

### Stage 2 — data layer

- `REVIEW_STATUS_MAP` += both values; the derived inverse follows automatically.
- Field maps, `FIELD_SELECT`, and the `entity-registry` SELECT +=
  `wmkf_reviewduedateatsend`.
- `updateLifecycle`: the completion-stamp branch stays strictly
  `=== REVIEW_STATUS_MAP.complete`. **Assert by test that a terminal transition
  stamps neither `wmkf_completedat` nor `wmkf_reviewreceivedat`.**
- `[VERIFIED via lib/services/reviewer-merge.js:28-50]` `ENGAGEMENT_SIGNAL_FIELDS`
  is a merge-**blocking** blacklist ("any populated ⇒ loser is not pre-engagement
  ⇒ block"), not a preserved-fields list. Adding `wmkf_reviewduedateatsend` is
  therefore **optional and redundant**: the stamp is only ever written alongside
  `materialsSentAt` at the same call site, and `wmkf_materialssentat` is already
  in the list, so such a row already blocks. Add it only for the
  "kept broad on purpose" defense-in-depth the file's design note describes.

### Stage 3 — services

- `reviewers-service.js`: `REVIEW_STATUS_BY_VALUE` += both; project
  `reviewDueDateAtSend` into the DTO.
- `send-emails-service.js` thankyou branch: **do not** bump a terminal row to
  `complete`.

#### 3a — the due date must be the date the reviewer was actually told

The naive "re-read `wmkf_reviewduedate` at send" is **wrong**, for the reasons
verified below:

- `[VERIFIED via lib/services/review-manager/render-emails-service.js:256-258]`
  the draft renders from `settings.reviewDueDate || cycle.review_deadline`, a
  caller-supplied value with a cycle fallback — not necessarily the request
  column. `[VERIFIED via lib/services/review-manager/send-emails-service.js:511-524]`
  send transmits `draft.subject` / `draft.body` verbatim, and staff can edit the
  rendered body first. So the emailed deadline and the request column can
  legitimately differ, and stamping the column would record a date the reviewer
  never saw.
- `[VERIFIED via lib/services/review-manager/send-emails-service.js:706-712]`
  the post-loop lifecycle write catches its own failure, logs a warning, and the
  stream continues — so the stamp can be silently absent after a real send.

**Resolve one server-authoritative effective due date** (the same precedence the
renderer uses) and thread that single value through render → send → persist, so
the stored date is provably the rendered one. Reject a send whose draft was
rendered against a different effective due date than the one now resolved
(stale-draft conflict) rather than silently stamping the newer value.

**Stamp inline per recipient, not in the post-loop batch.**
`[VERIFIED via lib/services/review-manager/send-emails-service.js:699-705]` the
`invitation` path already made exactly this move — its lifecycle stamp runs inline
immediately after each successful send precisely so "a mid-batch timeout can't
leave already-sent invites unstamped." Follow that precedent. Where the write still
fails, surface a per-recipient `sent_but_unrecorded` result (the
`withdraw-sufficient` per-row status vocabulary is the model) instead of a warning
the caller cannot act on, and provide a repair path.

Set-once semantics are enforced with the row's ETag, not a read-then-write.

### Stage 3b — terminal transitions need their own fail-closed service

**Do not send terminal statuses through the generic reviewers PATCH.**
`[VERIFIED via pages/api/review-manager/reviewers.js:118]` that endpoint forwards
any mapped `reviewStatus` unchanged. `[VERIFIED via
lib/dataverse/adapters/reviewer-suggestion.js:1231-1258]` `updateLifecycle()`
guards applicant-exclusion and special-cases `complete`, and carries no post-accept
lifecycle predicate: it does not require `wmkf_accepted`, reject a row with a
received or completed review, constrain the source state, or apply an ETag unless
the caller passes one. A direct request, or a race against the ETag-guarded
review-submission changeset, could therefore mark an unaccepted or already-submitted
engagement `withdrew` and corrupt the denominator this plan exists to create.

Add a dedicated endpoint + service modelled on
`[VERIFIED via lib/services/review-manager/withdraw-sufficient-service.js:54-130]`,
which already has the shape required — fresh per-row read, a state predicate, an
`ifMatch` conditional write that fails closed on concurrent change, and per-row
partial-success statuses. The terminal-transition predicate is the post-accept
mirror of `isStillPending()`:

- **require** `wmkf_accepted === true`;
- **reject** rows with `wmkf_reviewreceivedat` or `wmkf_completedat` set;
- **reject** rows already in a terminal status;
- **allow** in-flight post-accept source states
  (`accepted` / `materials_sent` / `under_review`) and no others;
- write with the ETag from that read; a precondition failure becomes
  `changed_skipped`.

Each rejection is an explicit per-row status, and the endpoint returns a conflict
response for whole-request cases — fail closed, never a silent skip.

### Stage 4 — UI

- `reviewer-modes.js`: add to `STATUS_PIPELINE` (label + color) and
  `MODE_STATUSES.track`; **exclude from `MODE_WORK_REMAINING.track`**.
- `[VERIFIED via shared/components/reviewers/ReviewerManagePanel.js:1038]`
  `StatusDropdown` currently offers every pipeline status from every state and
  posts through the generic PATCH. The terminal values must **not** be added to
  that generic list — they route to the Stage 3b endpoint instead, are offered only
  on rows the predicate would accept, are visually distinct, and require a
  confirmation step since they end an engagement. The UI gate is a convenience;
  the server predicate is the authority.

### Stage 5 — gates and docs

- Register `REVIEW_STATUS_MAP` ⇔ `STATUS_PIPELINE` ⇔ `REVIEW_STATUS_BY_VALUE` in
  `check:status-enum-parity`; fix the stale comment in `reviewer-modes.test.js`.
- Atlas: `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` gains the new column
  and picklist values (required by `check:atlas`).
- Update the agent-wiki hazard note once the status ships.

## Verification

- Unit: terminal transition stamps no completion timestamps; `MODE_WORK_REMAINING`
  excludes both; reminder sweep excludes both; thank-you does not resurrect a
  terminal row; the due date stamps once and is not overwritten on re-send.
- Unit, Stage 3b predicate — each rejection case asserted separately: pre-accept
  row, row with `wmkf_reviewreceivedat` set, row with `wmkf_completedat` set, row
  already terminal, and an out-of-range source state.
- **Race test:** a terminal transition concurrent with the ETag-guarded review
  submission must fail closed on the stale ETag, never overwrite a submitted
  review. This is the specific corruption the plan exists to prevent, so it gets
  an explicit test rather than an assumption.
- Partial-failure test: when the inline post-send write fails, the recipient is
  reported `sent_but_unrecorded` and the batch does not report clean success.
- Provisioning dry-run: the Stage 1b script no-ops cleanly on a second run, and
  exits non-zero on a label collision or an unexpected `NewOptionValue`.
- `npm test` plus the full `check:*` gate set.
- Preview: exercise UI → route → service → Dataverse; confirm the row shows the
  terminal status, carries no `wmkf_reviewreceivedat`, and leaves the
  work-remaining badge.
- Confirm `aggregateReviewHistory` does **not** count a withdrawn row.

## Risks

1. **Option values are permanent** and cannot be renumbered once rows exist. The
   Stage 1b script probes the live option set, refuses a label collision, and
   asserts the returned value matches the requested one — a publisher
   option-value-prefix remap would otherwise leave `REVIEW_STATUS_MAP` silently
   wrong.
2. **Provisioning is environment-gated.** Stage 1a and 1b both mutate Dataverse
   metadata. They run against Preview first and reach production only by a
   deliberate, separately approved step under the target/write interlock — never
   as part of a code merge, and never by an agent acting on its own initiative.
3. **Numeric-ordering coupling.** `review-engagement-state.js` compares statuses
   by magnitude, so any future status inserted *below* `materials_sent` would break
   the portal lock. Out of scope here; worth a source comment.
4. **Backfill is out of scope.** Rows already falsely marked `complete` are not
   corrected. Identifying them (`complete` with no `wmkf_reviewfilename` and no
   answer snapshot) is a separate owner decision — do not silently mutate
   historical rows.
5. **Tier 1–3 runtime work.** Branch and deliberate promotion per
   `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`; not direct-to-main.

## Revision 3 — owner resolution of the two policy residuals (2026-07-22)

The build surfaced two residuals the spec had not settled. Both are now decided
and implemented; this section supersedes the single-column and target-only-guard
wording above.

**Residual 1 — terminal reopenability. RESOLVED: terminal is irreversible.**
`patchReviewers` rejected a terminal *target* but never inspected the *source*,
and `updateLifecycle` had no source predicate, so `{reviewStatus:'complete'}` on
a withdrawn row reached the close-out branch and stamped
`wmkf_reviewreceivedat` — re-creating the exact `aggregateReviewHistory` false
positive this feature exists to eliminate. The batch PATCH path was worse: one
status applied to N rows with no per-row inspection. Fixed in `updateLifecycle`
(not the route) so every caller — single, batch, service, future — inherits it.
A terminal row now refuses any *status* change; non-status writes (notes) still
succeed. Correcting a mistaken terminal transition is deliberately a
data-repair operation, not a UI affordance.

**Residual 2 — deadline on re-send. RESOLVED: store both dates.**
A set-once stamp marks a reviewer late whenever WMKF extended the deadline and
re-sent materials — the same "never penalize a reviewer for WMKF's own
scheduling" principle that split `withdrew` from `released`. Wave 14 therefore
provisions **two** DateOnly columns:

- `wmkf_ReviewDueDateAtSend` — set once; the deadline first committed to.
- `wmkf_ReviewDueDateLastSent` — overwritten every send; the deadline last
  communicated.

Reliability scoring can then ask either question rather than being locked into
the first by a schema decision. Neither value is recoverable after the fact,
which is why both are captured now instead of deferred to the metric design
session.

Consequence for the repair route: its former "a different review due date is
already recorded" 409 is removed. Under one column that guarded the stamp; it
also refused the legitimate case the route exists for — a second send, at a
changed deadline, whose inline stamp failed, leaving the row permanently
unrepairable. The protection is preserved structurally instead: `atSend` is only
ever written when empty, so the client-supplied `effectiveReviewDueDate` can
never rewrite the first commitment; it can only advance `lastSent`.

## Review history

Revision 2 (2026-07-22) incorporates a Codex adversarial review of revision 1,
which returned **needs-attention** with three `[high]` findings, all upheld:

1. The wave-based picklist extension was a silent no-op — the repo already
   documents this trap. Stage 1 is now split into a creation-only wave plus a
   standalone `InsertOptionValue` script.
2. The due-date stamp could record a deadline the reviewer was never shown, and
   could be silently dropped after a successful send. Stage 3a now defines a single
   server-authoritative effective due date threaded through render → send →
   persist, stamped inline with an observable partial-failure result.
3. Terminal transitions had no server-side lifecycle guard. Stage 3b adds a
   dedicated fail-closed endpoint and service with an explicit source-state
   predicate and ETag-guarded write.
