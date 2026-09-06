---
title: Reviewer Lifecycle Stage 3 expansion (3F–3K) and Stage 7 — close the generic write bypasses
kind: plan
domain: reviewer-workbench
status: draft
canonical: false
owner: product-engineering
last_verified: 2026-09-06
summary: Census of the 18 generic suggestion writers; six remaining moves (3F–3K, behavior-preserving); Stage 7 gate that only lets the recorded importer set shrink.
---

# Stage 3 expansion and Stage 7 — close arbitrary bypasses

**Architect:** Claude (S489, under the 2026-09-05 autonomy directive). **Builder:** Sonnet.
**Reviewer:** Opus. **Adversarial:** Codex, two rounds per slice (stopping rule). **Tier:** 1 per
slice, branch + PR. Historical baseline: `docs/audits/REVIEWER_LIFECYCLE_REFACTOR_REPORT_2026-09-04.md`
rows 6–12 and "Stage 7" (frozen; line cites there are stale — this plan cites HEAD).

## Census [VERIFIED via `scripts/inventory-reviewer-lifecycle-writers.js` on main `053326a5`, 1,296 files]

Generic suggestion writers are the adapter exports `updateLifecycle`, `patchFields` (alias of
`patchReviewReceipt`, `reviewer-suggestion.js:1373`), `patchReviewReceipt` (`:1361`) and
`bulkUpdateByRequest` (`:2320`, loops `updateLifecycle` without `ifMatch`). The inventory is a
lower bound: it tracks literal imports/aliases/namespace calls but not changeset descriptors,
forwarded callbacks or REST writers (its header says so). Raw `DynamicsService.updateRecord` on the
entity outside the adapter is already unconditionally blocked in `lib/`, `pages/`, `shared/`,
`modules/` by `check:dataverse-access-layer` (law mode, no allowlist) — Stage 7 does not need to
re-gate that; scripts are outside that gate and are recorded, not gated, here too.

| # | Call site (HEAD) | Writer | `ifMatch` | Classification | Disposition |
|---|---|---|---|---|---|
| 1 | `reviewer-engagement/close-review.js:172,198` | updateLifecycle | yes | named command (3A) | keep |
| 2 | `reviewer-engagement/terminal-transition.js:106` | updateLifecycle | yes | named command (3B) | keep |
| 3 | `reviewer-engagement/correct-status.js:77` | updateLifecycle | yes | named command (3C) | keep |
| 4 | `reviewer-engagement/correct-response.js:78` | updateLifecycle | yes | named command (3D) | keep |
| 5 | `send-emails-service.js:200` on main today; moves to `reviewer-engagement/record-email-outcome.js` when 3E merges | updateLifecycle | yes | post-send bookkeeping (3E) | keep |
| 6 | `reviewer-suggestion-sweep.js:150` on main today; the same call moves to `reviewer-engagement/expire-invitation.js` when 3E (PR pending) merges | patchFields | yes | invitation expiry (one site, two locations in time) | Stage 7: replace the alias call with adapter op `expireInvitationResponse(id, nowIso, {ifMatch})` (raw fields `wmkf_responsetype=no_response`, `wmkf_responsereceivedat`) |
| 7 | `review-manager/send-emails-service.js:1012` | updateLifecycle | **no** | inline post-send invitation stamp | 3F → `record-invitation.js` `recordDeliveredInvitation`; unconditional write preserved (decision D1) |
| 8 | `reviewer-finder/my-candidates-service.js:631` | updateLifecycle | yes | manual verified-link invite record | 3F → `record-invitation.js` `recordManualInvitation` |
| 9 | `reviewer-finder/generate-emails-service.js:501` | patchFields | **no** | legacy generation mark-as-sent (raw fields) | 3F → `record-invitation.js` `markInvitationGenerated`; preserved verbatim (decision D2) |
| 10 | `reviewer-reminder-sweep.js:415` (+ `mintAndStore` claim `:405`) | updateLifecycle | yes | pre-send review-due reminder claim | 3G → `claim-reminder.js`; respond-kind claim stays coupled to `mintAndStore` |
| 11 | `reviewer-due-extension.js:312` | updateLifecycle | yes | deadline override write | 3H → `change-review-deadline.js` |
| 12 | `review-manager/withdraw-sufficient-service.js:265` | updateLifecycle | yes | pending-invitation withdrawal | 3I → `withdraw-pending-invitation.js` |
| 13 | `external-review/respond-service.js:263` | updateLifecycle | `_etag \|\| undefined` | legacy declined-row deselection repair | 3J → adapter op `deselectLegacyDeclinedSuggestion(id, {ifMatch})`; optional version preserved (decision D3) |
| 14 | `reviewer-finder/my-candidates-service.js:549` → adapter `bulkUpdateByRequest:2320` | bulk updateLifecycle | **no** | proposal-wide cycle/program metadata | 3K → adapter op `setRequestMetadata(requestId, {grantCycleCode, programArea}, opts)` with a field whitelist; sequential no-`ifMatch` behavior preserved (decision D4) |
| 15 | `review-manager/mark-received-no-file-service.js:122` | patchReviewReceipt | yes | receipt sink (in-scope use of the receipt op) | keep (5B skip decision) |
| 16 | `review-upload.js:293` | patchReviewReceipt | yes | receipt sink | keep (5B) |
| 17 | `scripts/backfill-postgres-to-dataverse.js:243` | updateLifecycle | no | administrative backfill | recorded, not gated |
| 18 | `reviewer-suggestion.js:2320` internal `bulkUpdateByRequest` → `updateLifecycle` | internal | no | adapter-internal | folded into row 14 |

Disconfirming check [VERIFIED via command, 2026-09-06]: an independent `grep -rnE
"\b(updateLifecycle|patchFields|patchReviewReceipt|bulkUpdateByRequest)\(" lib pages shared
modules scripts` (adapter excluded) returns exactly the 17 application call sites in rows 1–16 plus
the backfill script (row 17); the only other hits are synthetic fixture strings inside
`scripts/check-trust-boundary-guid-self-test.js`. The one CommonJS `require` of the adapter
(`lib/services/maintenance-service.js:19`) calls none of the four writers.

Adapter-internal raw writes (`restore:2286`, `softDelete`, Stage 2a/withdrawal descriptors) are
named specialized operations (historical row 12) and stay.

## Scripts census [VERIFIED via `grep -rn wmkf_appreviewersuggestions scripts` + call-form inspection, 2026-09-06]

Raw entity writers in `scripts/` (not gated by Stage 7 as planned; see D5): raw `fetch` PATCH with a
bearer token — `backfill-j26-stuck-invites-no-response.js:156`, `fix-walsh-repoint-1003020.mjs:77`,
`fix-roster-email-recovery.mjs:116`; `DynamicsService.updateRecord` — `find-stage2a-candidates.js:96`,
`restore-request-reviewers-selected.mjs:98`, `pr4-e2e-setup.js:118`, `smoke-reviewer-binding.js:578`,
`pr4-e2e.js:132`, `reset-stage2a-state.js:24`, `reset-request-reviewers.mjs:202`; adapter generic
writer — `backfill-postgres-to-dataverse.js:243`. The historical Stage 7 rule ("never delete live
scripts or operational repair hooks merely to get a zero count") still applies; whether they may keep
writing outside the adapter is D5.

## Owner decisions carried, not taken (build behavior-preserving; record each)

| ID | Site | Current behavior | Tightening available | Status |
|---|---|---|---|---|
| D1 | send-emails `:1012` | post-send invitation stamp writes without `ifMatch` (email already shipped; failure → `inviteRecorded:false`) | conditional on the batch-start ETag → a concurrent edit would leave a sent invitation unrecorded more often | owner decision; preserve |
| D2 | generate-emails `:501` | draft generation stamps `wmkf_invited`/`wmkf_emailsentat` raw, unconditionally | none until the legacy mark-as-sent is separately approved (historical row 6) | owner decision; preserve |
| D3 | respond-service `:263` | `ifMatch: suggestion._etag \|\| undefined` (falls to the adapter fallback when missing) | require a concrete ETag (`isConcreteEtag`) | owner decision (historical row 10 "policy made explicit before tightening"); preserve |
| D4 | `bulkUpdateByRequest` (`reviewer-suggestion.js:2320–2325`) | sequential unconditional `updateLifecycle` per selected row with no try/catch: a middle-row failure throws out of the loop, so the picker route returns an error (not `success:true`) but earlier rows stay written and the caller learns neither which rows nor how to retry | (a) per-row results returned to the picker (additive response field), (b) atomic changeset, (c) per-row `ifMatch` | owner decision — Codex planning round rated this high; 3K is built behavior-preserving (a verbatim move into a whitelisted named op) and is NOT described as safer; the owner picks (a)/(b)/(c) or preserves |
| D5 | operational scripts with raw REST/entity writes on `wmkf_appreviewersuggestions` (table below) | ten scripts PATCH the entity directly via their own `fetch`/`DynamicsService.updateRecord`, outside the adapter, outside `check:dataverse-access-layer` (scripts are not in its scan set) and — for the three raw-`fetch` scripts — outside the target interlock (no `assertDataverseOperationAllowed` reference) | a script write policy: (a) route script writes through the adapter's named ops, (b) a scripts gate with an auditable recorded set, (c) archive one-off repair scripts already executed | owner decision — Stage 7 as planned closes APPLICATION bypasses only and must not be described as closing all bypasses |
| D0 | `softDelete` completion-aware | see SESSION_PROMPT Verified Open 0 | — | already recorded |

## Slices (each: move verbatim, wrapper/caller unchanged, direct tests, delegation pin, census row, two Codex rounds max)

- **3G `claim-reminder.js`** (`reviewer-reminder-sweep.js` ~`:395–425`): one function
  `claimReviewDueReminder({ id, claimPatch, claimIfMatch, actingUserSystemId })` for the
  `kind !== 'respond'` branch only; the respond-kind `mintAndStore` claim stays in the sweep (token
  mint + marker atomicity is the token-lifecycle module's contract). Tests: same-version claim, 412
  → no send (sweep maps to `claimFailed`), non-412 → `prepareFailed`, review-due token unchanged.
- **3H `change-review-deadline.js`** (`reviewer-due-extension.js` `:312` block): the conditional
  override write only; eligibility, exact-date validation, `prepareNotification` and the envelope
  stay. Tests: stale version → `classifySaveError` result, persisted deadline with failed
  notification unchanged.
- **3I `withdraw-pending-invitation.js`** (`withdraw-sufficient-service.js` `:265` block): the
  conditional pending→`withdrawn_sufficient` write; per-id result mapping (`changed_skipped` /
  `write_failed`) and the courtesy send stay. Tests: acceptance racing withdrawal (412 → no send).
- **3F `record-invitation.js`** (three functions, three files; after 3E merges because of
  `send-emails-service.js`): `recordDeliveredInvitation` (row 7, unconditional, D1),
  `recordManualInvitation` (row 8, guards + `ifMatch` + 412 → `stale_manual_link` mapping stays in
  the caller or moves — builder reports; preserve the `manualInviteError` codes), and
  `markInvitationGenerated` (row 9, raw `patchFields` call verbatim, D2). **Helper-extraction
  audit:** the three must not collapse — delivered evidence (post-send) ≠ manual verified-link
  record (pre-validated token, conditional) ≠ generation mark (no delivery). No shared "stamp
  invited" helper.
- **3J adapter op `deselectLegacyDeclinedSuggestion`** (respond-service `:263`): narrow op in the
  adapter writing `wmkf_selected=false` only, `ifMatch` forwarded as today (D3), called inside the
  existing `withDalContext('external-respond', …)`. Tests: already-declined+selected repair, changed
  version → `concurrent_modification` envelope, already deselected path untouched.
- **3K adapter op `setRequestMetadata`** replacing `bulkUpdateByRequest` for the picker
  (`my-candidates-service.js:549`): whitelist `grantCycleCode`/`programArea` (normalization via
  `normalizeSuggestionProgramArea` as today), empty updates rejected by the caller as today,
  sequential per-row write preserved (D4). `bulkUpdateByRequest` becomes a compatibility re-export
  until the census shows no importer, then Stage 7 removes it.
- **Parallelism:** 3G, 3H, 3I are disjoint files with `ifMatch` already present — run concurrently
  in the three worktrees once 3E merges. Then 3F. Then 3J and 3K sequentially (both edit the
  adapter). Stage 7 after all six land.

## Stage 7 — the gate

**Shape:** `scripts/check-reviewer-engagement-boundary.js` + `:self-test`, LAW mode, scanning
`lib/`, `pages/`, `shared/`, `modules/` (scripts recorded, not gated). Rule: an import (any form the
census helper recognizes — static/named/namespace/require/dynamic/export-from) of
`reviewer-suggestion.js` that binds `updateLifecycle`, `patchFields`, `patchReviewReceipt` or
`bulkUpdateByRequest` is allowed only from (a) `lib/services/reviewer-engagement/*` and (b) the
tracked **recorded importer set** in the script (rows 15–16 for `patchReviewReceipt`; nothing else
once 3F–3K land). The recorded set may only shrink: the self-test proves that adding one entry, or
a synthetic file importing `updateLifecycle` from `lib/services/foo.js`, turns the gate red, and
that removing a recorded entry whose importer still exists turns it red (so the list cannot rot
silently). Aliases: reuse `scripts/lib/ast-scan-core` binding resolution rather than regex.
**Then** remove the `patchFields` alias (after row 6's named op and 3F's `markInvitationGenerated`
— which keeps calling `patchReviewReceipt` under its own name until D2 is decided, so that entry is
recorded), and delete `bulkUpdateByRequest` if the census is empty.

**Not in Stage 7:** any tightening in D1–D4; deleting scripts; a universal patch command; schema
or backfill.

## Build and review record

- **3G build (Sonnet, 2026-09-06): `eed4f377`** on `claude/reviewer-lifecycle-stage3g`. The
  review-due `else` branch (main `reviewer-reminder-sweep.js:415–419`) moved verbatim to
  `reviewer-engagement/claim-reminder.js` `claimReviewDueReminder`; respond-kind `mintAndStore` claim
  and the sweep's catch untouched; `updateLifecycle` import dropped from the sweep. Direct tests (4),
  delegation pins (4, incl. respond-kind never calls it), census row. Mock seams: both existing
  suites mock the adapter path, no edits. Full suite 790 / 11,534; gates green. Mutations: inline
  keeping the import → 3/4 pins red; drop `ifMatch` → direct test red. Opus and Codex round 1 pending.
- **3H build (Sonnet, 2026-09-06): `4b0fbea2`** on `claude/reviewer-lifecycle-stage3h`. The
  override write (main `reviewer-due-extension.js:312`) moved verbatim to
  `reviewer-engagement/change-review-deadline.js` `changeReviewDeadline`; try/catch,
  `classifySaveError`, validation, `_etag` check, `prepareNotification` stay. Direct tests (4, incl.
  `null` pass-through), delegation pins (2), census row; no existing test edits. Full suite 790 /
  11,532; gates green. Mutations: inline keeping the import → 2/2 pins red; drop `ifMatch` → 2/4
  direct red. Opus and Codex round 1 pending.
- **3I build (Sonnet, 2026-09-06): `87edb12b`** on `claude/reviewer-lifecycle-stage3i` (new
  worktree `../WMKF_Apps-s4`). The withdrawal write (main `withdraw-sufficient-service.js:264–274`)
  moved verbatim to `reviewer-engagement/withdraw-pending-invitation.js` `withdrawPendingInvitation`;
  result mapping, counter, courtesy email and checks stay. Direct tests (4), delegation pins (4),
  census row; no existing test edits (one route suite mocks the whole service as a black box, others
  mock adapters). Full suite 790 / 11,534; gates green. Mutations: inline keeping the import → 4/4
  pins red; drop `ifMatch` → 1/4 red; write after send → 3/4 pins red. Opus and Codex round 1 pending.

## Docs (after each merge)

Readiness audit rows 3/7; service catalog; `reviewer-workbench-lifecycle.md` Stage 3 bullet;
`docs/CI_GATES_REFERENCE.md` for the new gate; `/start` gate list; API matrix only if a route
contract sentence names a moved writer.

## Planning review record

### Codex adversarial planning round (2026-09-06, working tree): needs-attention, three highs

1. **Row 6 "omitted"/misidentified — partly accepted.** The sweep's `patchFields` call was row 6 all
   along, but the row cited the post-3E location while 3E was still unmerged, so a reader of HEAD saw
   a non-existent file and a missing site. Rows 5 and 6 now name both locations in time. No site was
   missing: the independent grep already listed `reviewer-suggestion-sweep.js:150`.
2. **Scripts with raw REST writers — accepted as a decision, not as a gate.** Verified: three scripts
   PATCH through their own `fetch` with no interlock reference; seven more call
   `DynamicsService.updateRecord` directly. Recorded in the scripts census and D5; the plan's claim is
   narrowed to application bypasses. Extending the gate to scripts is the owner's call because it
   would block operational repair tooling.
3. **D4 partial success — accepted as framing, declined as a block.** Corrected the description (the
   loop throws; the route does not return `success:true` on partial failure; the defect is that the
   caller cannot tell which rows were written). 3K stays a behavior-preserving move and drops any
   "safer" wording; the tightening options are enumerated for the owner. Blocking 3K would leave the
   generic `bulkUpdateByRequest` in place, which is worse for Stage 7 than a whitelisted named op
   with the same write semantics.

No second planning round: build rounds keep their two-round budgets.


### Contract-reconcile Mode A (architect, 2026-09-06, main `053326a5`)

**Surface:** six behavior-preserving extractions of suggestion-row writers into
`lib/services/reviewer-engagement/` plus two narrow adapter ops, then a boundary gate. **Entry
points:** cron `reviewer-reminders` (3G), review-manager due-extension and withdraw-sufficient
routes (3H, 3I), send-emails / my-candidates / generate-emails routes (3F), external respond route
(3J), my-candidates bulk PATCH (3K). **Persistence:** `wmkf_appreviewersuggestion` via the adapter
only. **Consumers:** unchanged DTOs, SSE events and result envelopes; census test; new gate.

Findings:
1. VERIFIED — the 18-site census is complete for literal call forms. Evidence: inventory run (18
   targets) and the independent grep above agree; complement checks: `maintenance-service.js:19`
   CommonJS require calls no generic writer; `reviewer-reminder-sweep.js:61` `SUGGESTION_SET` is an
   exported constant with no other importer and no write; `individual-file-service.js:614`
   `pointerUrl` feeds only the interlock assertion (`assertDataverseOperationAllowed`), the write
   itself goes through `attachReviewDocumentPointer` since Stage 5. Residual risk: changeset
   descriptors (`core/changeset.js`) are built by named adapter ops (Stage 2a, withdrawal, token)
   and are historical row 12 specialized operations; a new descriptor writer would not be seen by
   the Stage 7 gate as designed — recorded limit, mitigated by `check:dataverse-access-layer` for
   raw transport.
2. VERIFIED — every slice preserves its caller's failure mapping because the mapping stays in the
   caller: 3G (`claimFailed`/`prepareFailed` at `reviewer-reminder-sweep.js:420–425`), 3H
   (`classifySaveError` at `reviewer-due-extension.js:316`), 3I (`changed_skipped`/`write_failed`
   at `withdraw-sufficient-service.js:270–273`), 3J (`concurrent_modification` envelope at
   `respond-service.js:269–272`), 3F rows 7/8 (`inviteRecorded:false` at `send-emails-service.js:1017`;
   `stale_manual_link` at `my-candidates-service.js:636–641`).
3. ASSUMED → to verify in each build: no hand-mocked suite replaces `reviewer-reminder-sweep`,
   `reviewer-due-extension` or `withdraw-sufficient-service` internals by module path (3E's table
   found none for its files; each builder re-runs the `jest.mock(` table).
4. Partial success: 3I and 3K are per-row loops whose partial outcomes are already surfaced (per-id
   `results`; `suggestionsUpdated` count only for 3K — D4 records that a middle-row failure is not
   reported per row today; preserved, not fixed).
5. Async/stale state: N/A beyond the existing `ifMatch` contracts, all preserved; D1–D3 record the
   three sites that are weaker than concrete-ETag and stay so.
6. Durable surface: no schema, route, Atlas or matrix change except the new gate (`CI_GATES_REFERENCE`,
   `/start` list) and catalog entries.
7. Symbol fan-out: no new enum/status value; `SEND_SKIP_REASON` untouched.

Recommendation Evidence: N/A (no new recommendation beyond the historical table; D1–D4 are
deferred to the owner).

**Verdict: READY WITH NAMED CHANGES** — (0) Codex planning-round items above applied; (a) 3G scope must be the review-due branch only (the
respond branch's claim is the token module's atomic write); (b) each builder reports the
`jest.mock(` table before moving; (c) the Stage 7 gate self-test must include the "recorded entry
whose importer is gone" red case so the list cannot rot. Codex planning round pending.
