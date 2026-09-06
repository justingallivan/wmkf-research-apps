---
title: Reviewer Lifecycle Stage 2 — narrow shared engagement policy
kind: plan
domain: reviewer-workbench
status: active
canonical: false
owner: product-engineering
last_verified: 2026-09-05
summary: One browser-safe policy module for the duplicated correction-source and closed-engagement status sets; callers keep their error identities; no new values.
---

# Stage 2 — narrow shared engagement policy

**Architect:** Claude (S489, under the owner's 2026-09-05 autonomy grant). **Builder:** Sonnet.
**Reviewer:** Opus. **Adversarial:** Codex, at most two rounds, both on the build. **Tier:** 1
(internal refactor, stable contracts) — branch `claude/reviewer-lifecycle-stage2` from `main`, PR.
**Source of scope:** `docs/audits/REVIEWER_LIFECYCLE_REFACTOR_REPORT_2026-09-04.md` §Stage 2 and
the readiness audit row "2 — narrow shared policy".

## What is duplicated [VERIFIED via source on main `235661f3`]

Two callers classify a raw suggestion row's `wmkf_reviewstatus` (Dataverse option integer) the same
way before allowing an invitation-response correction:

| Caller | Sets | Guard | Error identity |
|---|---|---|---|
| `lib/services/reviewer-finder/my-candidates-service.js:51–62` `CORRECTION_SOURCE_STATUSES` = {null, accepted, materials_sent, under_review, review_received}; `CLOSED_CORRECTION_STATUSES` = {complete, withdrew, released} | `:697–702`: `completedat || CLOSED → correction_closed`; `!SOURCE → correction_state_unavailable` | `correctionError(message, code, 409)` → `MyCandidatesError` with `{ error, code }` body (`:80–82`) |
| `lib/dataverse/adapters/reviewer-suggestion.js:75–96` `CLOSED_REVIEW_STATUS_VALUE_SET` = {complete, ...TERMINAL_REVIEW_STATUS_VALUES}; `INVITATION_RESPONSE_SOURCE_STATUSES` = {null, accepted, materials_sent, under_review, review_received} | `updateLifecycle` `:1890–1898`, only when the payload touches an `INVITATION_RESPONSE_FIELDS` member | `adapterError(message, { status: 409, code })` |

`TERMINAL_REVIEW_STATUS_VALUES` = {withdrew, released} (`shared/config/reviewerStatus.js:9–12`)
and `REVIEW_STATUS_MAP` (`shared/config/reviewerLifecycle.js:19–27`) are the only sources, so the
two closed sets are value-equal today; the readiness audit's 30-case `vm` comparison confirmed it.
The same `REVIEW_STATUS_MAP` members appear in `send-emails-service.js` (4), `review-upload.js`,
`terminal-transition-service.js` and `mark-received-no-file-service.js`, but those are different
questions (materials eligibility, receipt eligibility, terminal transition) — **out of scope**; the
refactor report forbids a universal "done" predicate.

## Change

New browser-safe module `shared/utils/reviewer-engagement-policy.js` (imports only from
`shared/config/`):

```js
export const INVITATION_CORRECTION_SOURCE_STATUSES = new Set([null, accepted, materials_sent, under_review, review_received]);
export const CLOSED_ENGAGEMENT_STATUSES = new Set([complete, ...Object.values(TERMINAL_REVIEW_STATUS_VALUES)]);
export function isClosedEngagementRow(row)            // row.wmkf_completedat truthy OR CLOSED has row.wmkf_reviewstatus
export function isInvitationCorrectionSourceRow(row)  // SOURCE has row.wmkf_reviewstatus (null/undefined → treated as null → true)
```

Raw-row input only. No DTO variant is added (no DTO caller exists for this predicate; adding one
would violate "keep distinct input functions"). `undefined` status normalises to `null` exactly as
`Set.has(undefined)` would NOT — the builder must write the normalisation explicitly and test it,
because today `CORRECTION_SOURCE_STATUSES.has(undefined)` is `false` in the service. **Preserve
that:** the predicate must return `false` for `undefined` unless a table-driven test proves both
callers never see `undefined` (they read a fresh row with an explicit select, so the field is
present or `null`). Decision: mirror current behavior — `undefined` → `false` — and document it.

Callers:
- `my-candidates-service.js`: replace the two local sets with the module's predicates; keep
  `correctionError(...)` calls, messages and codes byte-identical.
- `reviewer-suggestion.js` `updateLifecycle`: replace the two local sets with the predicates; keep
  `adapterError` calls, messages, codes and the `INVITATION_RESPONSE_FIELDS` trigger unchanged.
  `TERMINAL_REVIEW_STATUS_VALUE_SET` stays if anything else in the adapter uses it (grep).

No other file changes. No new map values. No server imports into the shared module.

## Tests

- New `tests/unit/reviewer-engagement-policy.test.js`: table over every `REVIEW_STATUS_MAP` value,
  `null`, `undefined`, an unknown integer, a string status, and `wmkf_completedat` set/unset; assert
  both predicates; assert the module imports nothing from `lib/`.
- Existing pins stay byte-identical and green: `tests/unit/my-candidates-service.test.js` (4 guard
  assertions), `tests/unit/reviewer-suggestion-disposition.test.js` (3),
  `tests/integration/my-candidates-route.test.js` (2), `tests/integration/reviewer-engagement-races.test.js` (7).
- Mutation checks the builder reports: (a) drop `review_received` from the source set → the
  service and adapter suites both go red (name which tests); (b) make `isClosedEngagementRow`
  ignore `wmkf_completedat` → red; (c) change `undefined` handling to `true` → policy test red.
- Slice exit: retained reviewer selection (13 suites from the 6C plan) + full suite, `check:types`,
  lint, build, `git diff --check`, `check:dataverse-access-layer`.

## Build and review record

- **Build (Sonnet, 2026-09-05): `85aec404`** on `claude/reviewer-lifecycle-stage2`. Four files.
  Builder-found deviation from this plan's citation: the adapter had **four** read sites of the old
  sets, not two. The two `updateLifecycle` invitation-response guards use the row predicates; the
  "refuse to leave a closed status" guard later in `updateLifecycle` and `softDelete`'s terminal
  guard historically checked only `wmkf_reviewstatus` (never `wmkf_completedat`), so they consume
  the closed set status-only to stay byte-identical. Six-suite selection 590 tests; full suite
  774 / 11,372; types, lint 0 errors, build, `check:dataverse-access-layer`, `git diff --check`
  green. Mutations (a)/(b)/(c) each red across 4–5 suites.
- **Codex adversarial round 1 (`85aec404`): needs-attention.** (1) **High — `softDelete` ignores
  `wmkf_completedat`, so a completion-stamped row with a non-terminal status can be removed and
  its engagement fields cleared. Declined for Stage 2, recorded as a follow-up:** that is the
  pre-existing behavior at `reviewer-suggestion.js` `softDelete` (main), and the refactor report
  scopes Stage 2 to consolidating duplicated policy without behavior change. Tightening `softDelete`
  is a real hardening candidate (select `wmkf_completedat`, gate with `isClosedEngagementRow`) with
  a staff-visible effect (Remove refuses such rows) — owner decision, tracked in `SESSION_PROMPT.md`.
  (2) **Medium — exported mutable Sets and a two-flavor API. Accepted:** make the Sets
  module-private; export `isClosedEngagementStatus(status)` (status-only, for the two historical
  status-only sites) alongside the two row predicates; the adapter's status-only sites call that
  predicate instead of `.has()`. Add a test that the module exports no `Set` instance.

## Review checkpoints

Opus: confirm the predicates are the only behavior source now (grep for the old set names →
zero), error identities unchanged, complement handling (`undefined`, unknown integer, string)
explicitly tested. Codex round 1 on the build; round 2 only for a confirmed defect.

## Docs (after merge)

Readiness audit row 2 → complete; refactor-report Stage 2 exit noted in a short receipt
`docs/audits/REVIEWER_LIFECYCLE_STAGE2_RECEIPT_<date>.md`; service catalog entry for the new module
if `docs/SERVICE_AND_UTILITY_CATALOG.md` lists `shared/utils` modules (check).
