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

### Stage 1 — schema (provisioning, reviewed commit)

New wave dir `lib/dataverse/schema/wave14-reviewer-terminal-status/`, following
the wave6 picklist precedent
`[VERIFIED via lib/dataverse/schema/wave6/*.json]` (`kind:
"extensions-on-existing"`, idempotent `ensureAttribute`):

- Extend the `wmkf_ReviewStatus` picklist with two new values, `Withdrew` and
  `Released`. `[ASSUMED]` the next free option values follow the existing
  contiguous block — confirm against the live option set before applying (Risk 1).
- Add `wmkf_ReviewDueDateAtSend` (DateOnly) to `wmkf_appreviewersuggestion`.

Apply with `node scripts/apply-dataverse-schema.js --target=<env> --wave=14
--execute`. Preview first; production only after the code is verified.

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
- `send-emails-service.js` materials branch: stamp `reviewDueDateAtSend` from the
  request's `wmkf_reviewduedate` when empty.
- `send-emails-service.js` thankyou branch: **do not** bump a terminal row to
  `complete`.
- `[VERIFIED via pages/api/review-manager/reviewers.js:118]` the PATCH passes
  `reviewStatus` straight through, and `mapPicklist` throws on unknown values, so
  both values are accepted once Stage 2 lands. Confirm no allowlist elsewhere
  rejects them.

### Stage 4 — UI

- `reviewer-modes.js`: add to `STATUS_PIPELINE` (label + color) and
  `MODE_STATUSES.track`; **exclude from `MODE_WORK_REMAINING.track`**.
- `[VERIFIED via shared/components/reviewers/ReviewerManagePanel.js:1038]`
  `StatusDropdown` offers both. Terminal choices should be visually distinct and
  confirmed, since they end an engagement.

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
- `npm test` plus the full `check:*` gate set.
- Preview: exercise UI → route → service → Dataverse; confirm the row shows the
  terminal status, carries no `wmkf_reviewreceivedat`, and leaves the
  work-remaining badge.
- Confirm `aggregateReviewHistory` does **not** count a withdrawn row.

## Risks

1. **Option values are permanent** and cannot be renumbered once rows exist.
   `[ASSUMED]` the values proposed in Stage 1 are unused — verify against the
   deployed picklist before applying.
2. **Numeric-ordering coupling.** `review-engagement-state.js` compares statuses
   by magnitude, so any future status inserted *below* `materials_sent` would break
   the portal lock. Out of scope here; worth a source comment.
3. **Backfill is out of scope.** Rows already falsely marked `complete` are not
   corrected. Identifying them (`complete` with no `wmkf_reviewfilename` and no
   answer snapshot) is a separate owner decision — do not silently mutate
   historical rows.
4. **Tier 1–3 runtime work.** Branch and deliberate promotion per
   `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`; not direct-to-main.
