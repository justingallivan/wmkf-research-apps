---
title: Reviewer Lifecycle Stage 3 expansion (3F–3K) and Stage 7 — close the generic write bypasses
kind: plan
domain: reviewer-workbench
status: historical
canonical: false
owner: product-engineering
last_verified: 2026-09-06
summary: Shipped 2026-09-06 (PRs #162–#168). Slices 3F–3K, LAW boundary gate, bulkUpdateByRequest removed. D0/D3 taken, D1 preserved, D4(a) chosen, D2/D5 open.
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
| 5 | `reviewer-engagement/record-email-outcome.js` (3E, PR #161 → `01072571`; was `send-emails-service.js:200`) | updateLifecycle | yes | post-send bookkeeping (3E) | keep |
| 6 | `reviewer-engagement/expire-invitation.js` (3E, PR #161; was `reviewer-suggestion-sweep.js:150`) | patchFields | yes | invitation expiry (one site, two locations in time) | Stage 7: replace the alias call with adapter op `expireInvitationResponse(id, nowIso, {ifMatch})` (raw fields `wmkf_responsetype=no_response`, `wmkf_responsereceivedat`) |
| 7 | `reviewer-engagement/record-invitation.js` `recordDeliveredInvitation` (3F, PR #165; was `send-emails-service.js` inline stamp) | updateLifecycle | **no** | post-send invitation stamp | done; unconditional write preserved (decision D1) |
| 8 | `reviewer-engagement/record-invitation.js` `recordManualInvitation` (3F; was `my-candidates-service.js:631`) | updateLifecycle | yes | manual verified-link invite record | done |
| 9 | ~~`reviewer-engagement/record-invitation.js` `markInvitationGenerated` (3F; was `generate-emails-service.js:501`)~~ **RETIRED 2026-09-06 (D2, S490):** the generate-emails route, its service, the `email-reviewer.js` prompt and the `patchFields` alias were deleted; real sends stamp `invited` via `recordDeliveredInvitation` | — | — | legacy generation mark | gone |
| 10 | `reviewer-engagement/claim-reminder.js` (3G, PR #162; was `reviewer-reminder-sweep.js:415`) | updateLifecycle | yes | review-due reminder claim | done; respond-kind claim stays coupled to `mintAndStore` in the sweep |
| 11 | `reviewer-engagement/change-review-deadline.js` (3H, PR #163; was `reviewer-due-extension.js:312`) | updateLifecycle | yes | deadline override write | done |
| 12 | `reviewer-engagement/withdraw-pending-invitation.js` (3I, PR #164; was `withdraw-sufficient-service.js:265`) | updateLifecycle | yes | pending-invitation withdrawal | done |
| 13 | adapter op `deselectLegacyDeclinedSuggestion` (3J, PR #166) called from `external-review/respond-service.js` | updateLifecycle (inside the op) | **required** (`requireIfMatch`; D3 taken 2026-09-06, S490) | legacy declined-row deselection repair | done; concrete ETag required since D3 |
| 14 | ~~adapter op `setRequestMetadata` (3K, PR #167) called from `reviewer-finder/my-candidates-service.js`~~ **REMOVED 2026-09-06 (D4, S490):** op, whitelist, the service's proposal-wide branch, the route's `proposalId` authorization branch and the trust-boundary sink entry deleted; a `proposalId`-only PATCH is a plain 400 | — | — | proposal-wide cycle/program metadata | gone |
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
| D1 | send-emails `:1012` | post-send invitation stamp writes without `ifMatch` (email already shipped; failure → `inviteRecorded:false`) | conditional on the batch-start ETag → a concurrent edit would leave a sent invitation unrecorded more often | **DECIDED 2026-09-06: preserve.** The recorded fact ("this email left") is true regardless of concurrent edits; a 412 here protects nothing and only converts a recorded send into an unrecorded warning. |
| D2 | ~~generate-emails `:501`~~ | **DECIDED 2026-09-06 (S490): retire the route.** Usage check [VERIFIED via `git grep`/`git log -S` of the tracked tree]: the only client ever, `EmailGeneratorModal`, was deleted 2026-06-21 (`9114adeb`, "verified zero live and zero dynamic imports"); no page, component, script, or archived surface referenced the route since; `api_usage_log` is LLM-keyed and the route never wrote it, and the Vercel CLI exposes no historical request log, so runtime zero-hit is unverified (dashboard glance recommended before merge). Deleted: `pages/api/reviewer-finder/generate-emails.js`, `lib/services/reviewer-finder/generate-emails-service.js`, `shared/config/prompts/email-reviewer.js` (its sole caller), `markInvitationGenerated`, the `patchFields` alias, four test files, A7 gate surface `reviewer-finder-emails`, the security-matrix row. Follow-up recorded: `wmkf_summarybloburl` is now write-only (save-candidates) and the summary blob's `access:'public'` justification is gone — not changed in this PR. | — | none in-app |
| D3 | respond-service `:263` | ~~`ifMatch: suggestion._etag \|\| undefined` (falls to the adapter fallback when missing)~~ **TAKEN 2026-09-06 (S490):** `deselectLegacyDeclinedSuggestion` now calls `requireIfMatch` before delegating, so a missing/wildcard version throws `missing_version` with zero Dataverse calls; `respond-service.js` maps `missing_version` to the existing 412 `concurrent_modification` envelope (previously it would have fallen through as a 500 `server_error`). Note the site is the legacy-decline **repair** branch (`wmkf_selected=false` only), not the acceptance write. Tests: five refused shapes + mutation pin in `reviewer-suggestion-deselect-legacy-declined.test.js`; envelope mapping in `external-review-services.test.js`. | require a concrete ETag (`isConcreteEtag`) | **DECIDED: taken.** Staff/reviewer-visible only if Dataverse ever returns a row without an ETag (not observed). |
| D4 | ~~`bulkUpdateByRequest` → `setRequestMetadata`~~ | **DECIDED 2026-09-06 (S490): remove the branch** (the owner first chose (a), then reversed after the pre-build finding). Evidence [VERIFIED via `git grep` + `git log -S`]: the only client ever was the standalone Reviewer Finder page's per-proposal Program Area / Grant Cycle dropdowns (`pages/reviewer-finder.js` `handleUpdateProposalProgram`/`handleUpdateProposalCycle`), deleted 2026-06-16 (`94bbbce4`); the Workbench never rebuilt them, `ReviewerSearchSection` sets both at save time via `save-candidates`, and every other my-candidates caller sends `suggestionId`. Removing the branch deletes the unguarded per-row loop outright. **Capability drop (explicit):** there is now no post-save correction path for `wmkf_grantcyclecode`/`wmkf_programarea` on a suggestion row; CRM or re-save is the fallback. | — | none (no UI reached it) |
| D5 | operational scripts with raw REST/entity writes on `wmkf_appreviewersuggestions` (table below) | ten scripts PATCH the entity directly via their own `fetch`/`DynamicsService.updateRecord`, outside the adapter, outside `check:dataverse-access-layer` (scripts are not in its scan set) and — for the three raw-`fetch` scripts — outside the target interlock (no `assertDataverseOperationAllowed` reference) | a script write policy: (a) route script writes through the adapter's named ops, (b) a scripts gate with an auditable recorded set, (c) archive one-off repair scripts already executed | owner decision — Stage 7 as planned closes APPLICATION bypasses only and must not be described as closing all bypasses |
| D0 | `softDelete` completion-aware | ~~gated on `wmkf_reviewstatus` only~~ **TAKEN 2026-09-06 (S490):** guard read selects `wmkf_reviewstatus,wmkf_completedat` and gates with `isClosedEngagementRow`, so a completion-stamped row with a non-closed status is refused (error text keeps the `closed review status` phrase the four existing assertions match, and now prints both fields). Tests: the discriminating fixture the Stage 2 Opus review recorded as missing (accepted status + `wmkf_completedat` set → refused, no PATCH), the select pin, and the inverse (never-completed row still removed, ETag-bound) in `reviewer-suggestion-disposition.test.js`; mutation to status-only turns exactly that fixture red. | select `wmkf_completedat`, gate with `isClosedEngagementRow` | **DECIDED: taken.** Remove now refuses completion-stamped rows; legacy/hand-edited data only (in-app closeouts set both fields). Error still surfaces through the DELETE route as the same 500 the status-only refusal did. |

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
once 3F–3K land). Stale recorded entries (file gone, or no longer binding the writer) fail the gate, and the exact
map is pinned by a tracked test so growth is a deliberate, reviewed edit; the self-test proves a
synthetic outside importer and a stale entry both turn the gate red. (Earlier wording claimed the
map "may only shrink" and that adding an entry turns the gate red — Codex showed that was not
mechanized; corrected 2026-09-06.) Aliases: reuse `scripts/lib/ast-scan-core` binding resolution rather than regex.
**Then** remove the `patchFields` alias — **done 2026-09-06 with D2 (S490)** (after row 6's named op and 3F's `markInvitationGenerated`
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
  direct red.
- **3H Codex adversarial round 1 (`4b0fbea2`): approve** — exact override (incl. `null`), ETag and
  actor forwarded; notification prepared first, write before dispatch, 412/error classification
  preserved.
- **3H Opus review (`4b0fbea2`): PASS WITH ADVISORIES, zero required.** Call argument-for-argument
  identical; `null` is a live input (clear-override path at `reviewer-due-extension.js:283–291`);
  order prepare → write → dispatch and the saved/not-notified envelope untouched; single adapter
  import; mutations in a scratch copy: inline keeping the import → pin 2 red; drop `ifMatch` → 1 red;
  write after dispatch → 2 red; direct suite executes the module; census non-vacuous; 790 / 11,532
  and both boundary gates green. Advisories: branch behind main (rebased by the architect onto
  `a7ed788d`, census conflict resolved keeping all rows; 4 suites / 36 green → `3ea5fe18`, then
  `4d52e779` after 3G merged; PR #163 merged `81fdac43`, 2026-09-06);
  "no existing test edits" should read "census extended"; "conditional" wording nit. The plan's
  "persisted deadline with failed notification" case is covered by the retained
  `reviewer-due-extension.test.js:311`, which now runs the real module.
- **3G Codex adversarial round 1 (`eed4f377`): approve** — field mapping, ETag forwarding,
  claim-before-send, 412 handling, respond-kind separation, pin and census all match.
- **3G Opus review (`eed4f377`): PASS WITH ADVISORIES, none required.** Byte-identical hunk; respond
  branch and catch untouched; claim precedes the send; single adapter import; mutations on a scratch
  copy: inline keeping the import → 3 pins red with census green; dropped actor → pin red; swapped
  field names → direct AND retained sweep suite red (both execute the real module); census
  reproduced; 790 / 11,534 and both boundary gates green. Advisories: "both-paths identity" is N/A
  (the sweep is a caller, not a wrapper); the plan's "review-due token unchanged" case is covered by
  the retained sweep suite, not a new test; docs land post-merge. Rebased by the architect onto
  `c25f9e5a` (census-table conflict with 3E resolved by keeping all rows; 6 suites / 72 green) →
  `88985583`, PR #162 — merged `ec74c0d4` (2026-09-06, seven checks green).
- **3I build (Sonnet, 2026-09-06): `87edb12b`** on `claude/reviewer-lifecycle-stage3i` (new
  worktree `../WMKF_Apps-s4`). The withdrawal write (main `withdraw-sufficient-service.js:264–274`)
  moved verbatim to `reviewer-engagement/withdraw-pending-invitation.js` `withdrawPendingInvitation`;
  result mapping, counter, courtesy email and checks stay. Direct tests (4), delegation pins (4),
  census row; no existing test edits (one route suite mocks the whole service as a black box, others
  mock adapters). Full suite 790 / 11,534; gates green. Mutations: inline keeping the import → 4/4
  pins red; drop `ifMatch` → 1/4 red; write after send → 3/4 pins red.
- **3I Codex adversarial round 1 (`87edb12b`): needs-attention, one documentation medium** — no
  catalog entry or wiki note yet for `withdraw-pending-invitation.js`. Accepted; per the Stage 3
  plan's "Docs (after each merge)" these land in the architect's post-merge docs pass, as for
  3A–3E (same disposition as the 3C round-1 catalog finding). No runtime defect confirmed.
- **3I Opus review (`87edb12b`): PASS WITH ADVISORIES, zero required.** Payload byte-identical; the
  try/catch stayed in the caller (the builder's wording, not the code, was wrong); write before send;
  single adapter import; mutations in throwaway worktrees: inline keeping the import → 4/4 pins red;
  drop `ifMatch` → 1 red; write after send → 3 red; payload mutation → 2/4 direct red; census
  reproduced over 1,123 files; 790 / 11,534 and both boundary gates green; mock-seam table verified by
  the reviewer. Advisories: legacy header "Holds ALL business logic" (narrowed by the architect in
  `7c8b8575`); a legacy-path census row would match three files incl. a self-test template string —
  not added; catalog entries land post-merge. Rebased onto `c833bf2a` (census conflict resolved
  keeping all rows; 4 suites / 34 green), PR #164 — rebased twice more as 3G/3H merged, merged `d47b07be` (2026-09-06).

- **3F build (Sonnet, 2026-09-06): `2c5600e8`** on `claude/reviewer-lifecycle-stage3f` (rebased past
  3G/3H/3I; census conflict kept all rows). `record-invitation.js` exports three unshared
  passthroughs: `recordDeliveredInvitation` (send-emails ~`:932–944`, no `ifMatch`, D1 preserved),
  `recordManualInvitation` (my-candidates ~`:629–635`; guards, 412 → `stale_manual_link` and response
  stay in the caller), `markInvitationGenerated` (generate-emails ~`:501–505`, raw `patchFields`, no
  options, D2 preserved). No caller import removed (all still use `findById`). Direct tests (7, incl.
  no-`ifMatch` own-property assertion and a three-export surface test), three delegation-pin suites,
  census row with three importers; 21 existing suites (674 tests) unchanged. Full suite 798 / 11,603;
  types, lint, boundary/access-layer/trust-boundary gates + self-tests, build, `git diff --check`
  green. Mutations: inline each write keeping the import → its pin red (2/4, 3/4, 2/2); add
  `ifMatch:'*'` to the delivered stamp → direct red; route the generation mark through
  `updateLifecycle` → direct red.
- **3F Codex adversarial round 1 (`2c5600e8`): approve** — payloads, options, ordering,
  `inviteRecorded` handling, the fingerprint gate and the `recordDeliveredEmail` site unchanged; census
  lists the three importers; D1/D2 neither tightened nor loosened.
- **3F Opus review (`2c5600e8`): PASS WITH ADVISORIES, one required.** All three bodies verbatim
  (main never passed `ifMatch` on the delivered stamp; main passed exactly two args to `patchFields`);
  no shared helper; callers' `inviteRecorded`, guards, 412 mapping, loop/count/progress, the 6D gate
  and the 3E site untouched; pins mutation-verified (inline keeping the import → 2 red each; call
  hoisted above the stale-link guard → 2 red); census reproduced; 798 / 11,603 and three gates +
  self-tests green. **Required R1:** `send-emails-service.js:11-12` still claimed the invitation stamp
  stays inline. Advisories folded into the correction: D1/D2 wording must read as open decisions;
  duplicated caller rationale → pointer; generate-emails pin should assert one batch timestamp and a
  never-calls case; my-candidates pin should include a stale-link guard case.
- **3F correction `befc9fb3`** (rebased on `8ff86aad`): headers fixed in send-emails and
  my-candidates; D1/D2 reworded as open decisions with one copy of the rationale; generate-emails pin
  asserts one batch timestamp plus a `markAsSent:false` never-calls case; my-candidates pin gains the
  token-hash-mismatch case. 26 scoped suites / 727; full suite 802 / 11,621; gates green. PR #165
  merged `68198b2f` (2026-09-06, seven checks green).

- **3J build (Sonnet, 2026-09-06): `ef83bb9a`** on `claude/reviewer-lifecycle-stage3j`. Adapter op
  `deselectLegacyDeclinedSuggestion(suggestionId, { ifMatch, ...opts })` next to the Stage 5 ops,
  body `updateLifecycle(id, { selected:false }, { ifMatch, ...opts })` (inherits mapping, EXCLUDED
  guard and ETag fallback; D3 documented as pending). `respond-service.js` legacy repair calls it with
  the same `ifMatch` expression inside the same `withDalContext`; catch/envelope untouched;
  `updateLifecycle` import dropped from the service. Hand-mocked adapter in
  `external-review-services.test.js` gained a `jest.fn` forwarding shim (Stage 5 pattern) so the
  pre-existing assertion is byte-unchanged, plus delegation, 412 and already-deselected pins; new op
  suite compares `updateRecord` args between op and `updateLifecycle` (concrete ETag, undefined
  ifMatch, actor) plus 412 propagation. No census row applies (no `reviewer-engagement/` import).
  Full suite 799 / 11,608; types, lint, boundary/access-layer/dynamics-context gates + self-tests,
  build, `git diff --check` green. Mutations: service calls `updateLifecycle` directly keeping the
  import → 3 pins red; payload `selected:true` → 3/4 op tests red; add `requireIfMatch` → the
  undefined-ifMatch equality case red.
- **3J Codex adversarial round 1 (`ef83bb9a`): approve** — transport-identical (payload, ETag
  handling, exclusion/closed guards inherited); same ETag expression inside the external-respond
  DAL context; delegation pin would catch a direct `updateLifecycle` call; D3 unchanged.
- **3J Opus review (`ef83bb9a`): PASS WITH ADVISORIES, none required.** For `{ selected:false }` the
  inherited path is mapping + guard read + excluded refusal; correction guards and the concrete-ETag
  validation are inert (`wmkf_selected` is not an invitation-response field) and `statusChanging` is
  false, so `effectiveIfMatch = ifMatch || undefined` byte-for-byte as before; no `requireIfMatch`.
  Shim wrapped in `jest.fn` with pins per the Stage 5 precedent; the pre-existing assertion stays
  load-bearing for id/ifMatch; delegation pin catches a direct call; op suite runs the real adapter
  and an added `requireIfMatch` would fail its undefined-ifMatch case. 799 / 11,608 and three gates +
  self-tests green. Advisories folded into a correction: op-suite comparisons need
  `toHaveBeenCalledTimes(1)` guards (vacuous-capable), a `getRecord` guard-read assertion or
  excluded-row case, and a docblock nit ("closed-status checks" inert here).
- **3J correction `d226564d`** (rebased on `799aedfc`; PR #166): call-count guards on every op-suite
  comparison, `not.toHaveProperty('ifMatch')` on the undefined case, a new excluded-row refusal test
  (5 op tests), docblock reworded. Full suite 803 / 11,629; gates green. PR #166 merged `3b8dca2b`
  (2026-09-06, seven checks green).

- **3K build (Sonnet, 2026-09-06): `54de3d3b`** on `claude/reviewer-lifecycle-stage3k` (rebased
  past 3J, no adapter conflict). `setRequestMetadata(requestId, updates, { actingUserSystemId })`
  placed after `bulkUpdateByRequest`: whitelist `grantCycleCode`/`programArea` (other keys or `{}`
  throw), then `return bulkUpdateByRequest(...)` unchanged — sequential `updateLifecycle` per selected
  row, no `ifMatch`, no try/catch (D4 preserved, documented as open). `my-candidates-service.js:553`
  calls it; GUID check, rejected fields, empty-updates 400 and response verbatim [architect trace:
  `:530-551`]. `check-trust-boundary-guid.js` SINKS gains `['setRequestMetadata', 0]`. Forwarding
  shims in the unit and route suites (assertions byte-unchanged), plain `jest.fn` in one delegation
  suite. New: op suite (transport identity incl. normalization, 4 whitelist rejections, D4 test with
  3 rows / 2nd rejects / `updateRecord` ×2, actor forwarding), independent-mock delegation pin,
  `reviewer-suggestion-bulk-update-importers.test.js` (scan `lib/pages/scripts` for
  `\bbulkUpdateByRequest\(` → adapter only; the gate script's table entry has no `(` so it does not
  match). Full suite 806 / 11,641; all gates green. Mutations: service calls `bulkUpdateByRequest`
  directly → independent pin red (the shimmed suites alone would not catch it); whitelist removed →
  4/4 red; try/catch added → D4 test red.
- **3K Codex adversarial round 1 (`54de3d3b`): needs-attention, one medium, accepted narrowly.**
  The removal-census test scans only `lib/pages/scripts` and matches only `bulkUpdateByRequest(`, so
  a caller in `shared/`/`modules/`, a spaced or optional call, or an aliased import evades it.
  Correction: scan every production root (`lib`, `pages`, `shared`, `modules`, `scripts`) and match
  any `\bbulkUpdateByRequest\b` reference (not just the call form), with the expected set becoming
  the adapter plus the trust-boundary gate script's sink-table entry; the AST binding-resolved census
  is Stage 7's gate, not this interim test — stated in the test header. Runtime delegation and D4
  judged behavior-preserving.
- **3K Opus review (`54de3d3b`): PASS WITH ADVISORIES, zero required.** All architect traces
  confirmed; `programArea` normalization and `grantCycleCode` mapping inherited through delegation;
  `effectiveIfMatch` cannot engage for these keys so options are `{ actingUserSystemId }` exactly;
  D4 docblock disclaims "safer" and frames the decision as open; trust-boundary gate green (189
  routes) with the self-test exercising the sink table generically, not the new name; shims are
  load-bearing for return-value flow while arg flow is pinned exclusively by the independent-mock
  delegation test (two independent assertions go red on a direct call); the census test would go red
  on a new caller and scans `.mjs`. 9 + 8 + 6 suites (611 tests) and both boundary gates green.
  Advisories folded into the correction: scan `shared/`/`modules/` too (same as Codex); two stale
  caller comments; a normalization-discriminating fixture. Noted, no action: `{ grantCycleCode:
  undefined }` yields a count with zero writes (pre-existing `bulkUpdateByRequest` behavior,
  unreachable from the caller); the whitelist throws a plain `Error` like its sibling.
- **3K correction `c07902cc`** (rebased on `4c4f2c39`; PR #167): importers census scans all five
  production roots for the bare identifier with a recorded three-file set (adapter; my-candidates
  comment-only mentions; gate script table/docblock) and an interim-census header; spaced call under
  `shared/` proved red; stale caller comments renamed; transport-identity test uses
  `'Medical Research Program'` → `'Medical Research'` and asserts the normalized payload. 806 / 11,641;
  gates green.
- **3K Codex adversarial round 2 (final, `c07902cc`): needs-attention, one medium — accepted, resolved
  by Stage 7 rather than a third round.** Round-1 widening confirmed present. Because
  `my-candidates-service.js` is in the expected set for comment-only mentions, a new executable
  `bulkUpdateByRequest` call in that file would not change the file set. True, and the reason the test
  header calls itself interim: Stage 7B deletes `bulkUpdateByRequest` and rewrites this test as a
  zero-reference pin (no expected set to hide behind), and Stage 7A's AST binding-resolved gate is the
  deletion authority Codex asks for. 3K itself does not delete anything, so it merges on this basis;
  cap reached. PR #167 merged `19955148` (2026-09-06, seven checks green).

- **Stage 7 build launched (2026-09-06)** on `claude/reviewer-lifecycle-stage7`, branched from the
  3K branch (PR #167 awaiting CI) to avoid waiting; rebases onto main once 3K merges. Three commits:
  7A the gate (`check:reviewer-engagement-boundary` + self-test, workflow steps, CI reference rows,
  `/start` list; LAW mode over `lib/pages/shared/modules`; recorded importers = the two receipt
  sinks for `patchReviewReceipt`; stale recorded entries fail; non-literal sources fail closed); 7B
  delete `bulkUpdateByRequest` (body inlined into `setRequestMetadata`, D4 unchanged; importers test
  becomes a zero-reference pin; trust-boundary sink entry removed); 7C adapter op
  `expireInvitationResponse(id, nowIso, { ifMatch })` with `requireIfMatch` (codification — the sweep
  already passes a concrete ETag) called by `expire-invitation.js`; the `patchFields` alias stays for
  `markInvitationGenerated` pending D2.
- **Stage 7 build (Sonnet, 2026-09-06): `638ea8a1` (7A), `a8b9980e` (7B), `ac3dcaac` (7C)** on
  `claude/reviewer-lifecycle-stage7`, rebased onto main after 3K merged. Gate on HEAD [architect
  trace: law run exit 0; `--report` lists 14 bindings — 12 under `reviewer-engagement/`, 2 recorded
  receipt sinks — zero un-exempted, zero stale]; builder judgment: the non-literal-source fail-closed
  rule is narrower than the route-service-boundary exemplar (fails only on writer-keyed destructure,
  writer-named member access, or identity re-export) because a blanket rule false-positived on
  unrelated lazy-backend requires. 7B inlined the sequence verbatim (whitelist → empty → requestId →
  findByRequest → sequential `updateLifecycle` → count; D4 unchanged), removed the trust-boundary
  sink row, moved one `adapters-caller-id` test to `setRequestMetadata`, and made the importers test a
  zero-reference pin with a carve-out for the two gate scripts (which keep the name in
  `GENERIC_WRITERS`). 7C op with `requireIfMatch`; `expire-invitation.test.js` mock renamed and call
  shape `(id, nowIso, opts)`, outcome assertions unchanged; the sweep delegation pin needed no edit;
  new op suite. Full suite 806 / 11,651; new gate + self-test and four sibling gate pairs green; types,
  lint, doc-currency, build, `git diff --check` green. Mutations: thank-you sweep importing
  `updateLifecycle` → gate names it; bogus recorded entry → "stale recorded importer"; re-added
  `bulkUpdateByRequest` export → pin red; dropped `requireIfMatch` → 7 op tests red.
- **Stage 7 Codex adversarial round 1 (`ac3dcaac`): needs-attention, two highs, both accepted.**
  (1) Binding resolution misses local alias chains, computed member access and `export *` barrels
  (`check-reviewer-engagement-boundary.js:291-500`) — correction: alias fixpoint via `ast-scan-core`,
  transitive barrel sources, computed members on an adapter binding fail closed, fixtures for each.
  (2) `RECORDED_IMPORTERS` can grow in the same PR that adds a violation, so "may only shrink" was
  not mechanized (this plan's own claim "adding one entry turns the gate red" was wrong) — correction:
  a tracked pin test asserting the exact two-entry map (the census-test mechanism used throughout
  this campaign); header and CI-reference wording changed to "stale entries fail; growth requires a
  deliberate edit to the pin test". Codex confirmed D1–D5 untouched and 7C transport-equivalent.
  Sandbox could not create fixtures, so the self-test was not run by Codex.
- **Stage 7 Opus review (`ac3dcaac`): PASS WITH ADVISORIES, one required.** Every trace reproduced:
  14 bindings, zero violations, zero stale; self-test covers every plan-requested class (7 PASS
  groups); recorded-entry stale rule correct in all three directions (a recorded file binding a
  different writer is both a violation and stale); 7B carve-out is an exact-path Set and the
  zero-reference pin goes red on a re-added export; `adapters-caller-id` lost no assertion; 7C is
  codification (the sweep's guard regex is byte-identical to `isConcreteEtag`), transport identical,
  outcome assertions unchanged line by line; docs rows/steps/scripts consistent; 42 suites / 993 tests
  and four gate pairs green; six mutations all bite. **Required R1:** the docblock's fail-closed
  claim is false for an alias chain (`const b = a; b.updateLifecycle`) in both the unresolved and the
  literal path — port the exemplar's alias fixpoint. Advisories: destructure from an adapter local is
  green (A1); `module.exports = require(adapter)`, spread re-publish and `export *` barrels are green
  (A2 = Codex 1b); CI-reference row overclaims the hop (A3); only one of three fail-closed shapes is
  fixtured (A4); dead `unresolved` array (A5); stale test pointer (A6); harmless error-text change
  in 7B (A7). All folded into the correction round with the Codex highs.
- **Stage 7 correction `bd2e8e72`** (rebased on `5cda2e37`): binding resolution rewritten as a
  monotonic fixpoint (alias chains, extracted methods, destructure off a local, transitive barrels
  incl. `export *` / whole and spread CJS re-publish, computed members fail closed); the non-literal
  fail-closed check runs its own alias closure; self-test gains an alias-barrel group and six
  unresolved shapes (8 groups PASS); dead `unresolved` array removed; stale test pointer fixed;
  `tests/unit/reviewer-engagement-boundary-recorded-set.test.js` pins the two-entry map and a real
  non-stale addition turns it red; docblock and CI-reference wording corrected. Live census unchanged:
  14 exempt bindings, 0 violations. Full suite 807 / 11,652; all gate pairs green. Architect re-ran
  the gate, self-test and four suites (45 tests) on the branch. PR #168 opened.
- **Stage 7 Codex adversarial round 2 (final, `bd2e8e72`): needs-attention — three highs, one low.**
  Round-1 items confirmed present and the live census confirmed (14 / 0 / 0). Remaining bypass shapes:
  class-held adapters (`this.adapter.updateLifecycle`), renamed CJS member re-exports
  (`module.exports = { mutate: adapter.updateLifecycle }`), direct dynamic-import member calls
  (`(await import(adapter)).updateLifecycle(...)`); low: `/start` gate line still said "may only
  shrink". **Architect decision under the two-round cap:** these are mechanical AST cases in a LAW
  gate whose purpose is soundness, so a final builder correction closes them (detect, or fail closed
  on unsupported adapter-bearing shapes) with red fixtures; the architect verifies the gate pair and
  suites directly instead of a third Codex round. Recorded as the cap's stopping point.
- **Stage 7 final correction `4e471c94`** (rebased on `47452cb8`): class-field and constructor
  `this.<field>` adapter bindings flow through the fixpoint; renamed CJS/ESM member re-exports
  (`module.exports = { mutate: adapter.updateLifecycle }`, `exports.mutate = …`, `export const mutate
  = …`) resolve through the wrapper (fixing a latent bug where `export const` was swallowed by the
  no-source `export {}` branch); direct `(await import(adapter)).writer` recognized, non-literal
  source or computed key fails closed; `/start` wording fixed. The builder's first catch-all
  false-positived on five real files (`adapter.CONSTANT_MAP[key]`, `adapter.findById(id).catch`) and
  was narrowed to writer-named outer properties rather than exempting anything. Self-test now nine
  groups (new `class-barrel-dynamic-import`; `unresolved` has eight fail-closed shapes). Live census
  14 / 0 / 0. Full suite 807 / 11,652; all gate pairs green. **Architect verification:** gate + self-test
  (9 PASS) re-run on the branch, and a scratch `--root` tree with the three Codex shapes (class
  field, renamed wrapper + consumer, direct dynamic import) reported all of them as violations. PR
  #168 merged `790ba3a1` (2026-09-06, eight checks green); the gate runs green on main.
- **Post-merge Opus review of `4e471c94` (2026-09-06, S489 close).** Dispatched because the final
  correction landed on architect verification after the Codex cap. Verdict: DEFECT + 4 advisories,
  none affecting the real tree (14 / 0 / 0, 0 false positives across the 75 live `suggestionAdapter.`
  usages, 0.6s). (D1, fail-open) `captureIdentifierRhs` created alias edges only for bare
  Identifiers, so `const a = this.adapter; a.updateLifecycle()` and `helper(this.adapter).writer()`
  escaped the class-field handling the docblock claimed; (A1, CI false-positive risk)
  `(await import(<non-literal>)).anything` hard-failed the gate regardless of property, contradicting
  the documented lazy-backend limit; (A2) inline `require('<adapter>').findById` was a violation while
  its `import()` twin was green; (A3) the `this.<field>` key is file-scoped, not class-scoped
  (over-approximation, closed); (docs) CI reference rows still described neither the second
  correction round's classes nor the now-false "only" sentence. Self-test integrity, renamed-export
  alias soundness, `specifiers.length` guard and perf were confirmed. **Fix (same night, architect):**
  alias edge from `bindableKeyOf(rhs)`; `collectIdentifierReferences` emits `this.<field>` keys;
  non-literal dynamic-import source fails closed only for writer-named/non-literal properties;
  catch-all's literal-adapter-source arm requires a non-literal outer property; A3 documented as a
  limit; CI reference rows rewritten. Fixtures: reds `red-class-field-alias-local`,
  `red-class-field-helper-arg`; greens `green-inline-require-read`, `green-lazy-dynamic-import-default`.
  The pre-fix gate fails the new self-test at (1'') and hard-fails a scratch tree holding only the
  lazy dynamic import. PR #169 merged `4d777aad` (2026-09-06, all checks green).

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
