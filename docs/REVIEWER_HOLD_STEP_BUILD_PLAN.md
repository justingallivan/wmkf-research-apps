# Reviewer "Hold Step" Build Plan

> **Status:** PLANNED — not yet built. Authored S257; reviewed S257 via `/contract-reconcile`
> (Mode A) + **two** adversarial Codex passes — all findings folded in (pass-1 #1–#6 and
> pass-2 #1–#3 tagged inline). Pass-2 confirmed all six pass-1 fixes RESOLVED and added three
> MED findings (idempotency mechanism, allowlist, `held` round-trip), now addressed. Build-ready
> pending the `[OPEN]` items in §7. Re-run `/contract-reconcile` Mode B during implementation.
> Design rationale + decisions: memory `project-reviewer-hold-step-decouple`. Prior sibling
> surface: `docs/REVIEWER_STAGE_2A_BUILD_PLAN.md`.

State claims below are labelled `[VERIFIED via <source>]` (read this session) or
`[ASSUMED]` / `[OPEN]`. No claim here is built state.

---

## 1. Goal

Park a **confirmed, parked slate of interested reviewers** BEFORE Phase II proposals
arrive, deferring COI/AI policy acks + honorarium payment info + proposal delivery to a
later **finalize**. Flow becomes:

```
find → validate → invite → HOLD (agree in principle) → calendar hold → park
                                    │
                  (proposals released after staff QA)
                                    ▼
                              FINALIZE (= today's accept, unchanged)
```

A held reviewer agrees in principle now, sits tight, gets a calendar hold + a "we'll send
proposals around {date}" note. When staff release a proposal, the same reviewer is shown
the existing full accept form (COI/AI acks + payment) — that's finalize.

## 2. Why a build, not a run

[VERIFIED via `pages/api/external/review/[token]/respond.js`] Today's Stage-2a **accept** on
a fresh response hard-requires exactly what we want to defer:
- both policy acks (`reviewer-coi` + `reviewer-ai-use`) → 400 `policy_ack_required` (lines 258–264);
- a complete payment contact (mailing addr + phone) unless opt-out → 422 `payment_contact_required` (lines 273–280);
- runs `ensureHonorariumOnboarding` (lines 335–362).

[VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:777`] `applyStage2aResponse`
handles only `accept` | `decline`. There is **no confirm-without-commitment path**. The hold
step is the missing state.

**Automation-safety bonus** [VERIFIED]: hold never sets `wmkf_accepted=true` and never calls
`ensureHonorariumOnboarding`, so the Connor-gated honorarium/Bill.com prod automation
(`project-reviewer-accept-prod-automation`) cannot fire from a hold this cycle. The cycle-level
guarantee — that *no* accept fires the automation while proposals are unreleased — is enforced
by the **readiness write-layer gate** in chunk 3 (accept refused `409` when not ready), not just
by hiding the accept form in the view; without that gate a crafted `POST {action:'accept'}`
during the buffer would still finalize and fire honorarium.

## 3. Design (from the S257 trace)

- **Hold = new `wmkf_responsetype` value `held = 100000004` + a new `wmkf_heldat` datetime.**
  - [VERIFIED via adapter:88] the **code** `RESPONSE_TYPE_MAP` = accepted …000 / declined …001 / no_response …002 / withdrawn_sufficient …003, so **100000004** is the next value in the map. [ASSUMED, confirm at build time] that 100000004 is also free in the **live** optionset — the clone of `extend-responsetype-picklist.mjs` probes the live picklist and no-ops if taken, so the script self-confirms; do not hand-assert the live value.
  - NOT `wmkf_reviewstatus` (that's the staff pipeline). NOT `wmkf_accepted` (reserved for finalize; honorarium + Review-Manager key off it).
  - `wmkf_heldat` is a **distinct** timestamp, not a reuse of `wmkf_responsereceivedat` — finalize overwrites `responsereceivedat`, so a dedicated column preserves "when they held" for audit. [VERIFIED `wmkf_heldat` had **zero source-implementation refs** at plan time (it now appears only in this plan + the handoff).]
- **Finalize = the existing accept path, unchanged.** `held → accepted` is just
  `applyStage2aResponse('accept')`; the state machine already supports "no-prior-response → accepted," and held carries no `wmkf_accepted`/`wmkf_declined` that would block it.
- **Readiness gate** decides which view a reviewer sees: a single predicate
  `isProposalReadyForReviewers(request)`. Not-ready ⇒ lightweight hold ask / hold confirmation; ready ⇒ the full accept form (finalize).

### Spike findings folded in (S257 `.ics` spike)

- **Email transport is Dynamics email activities, NOT Microsoft Graph.** [VERIFIED]
  `send-emails.js:338` → `DynamicsService.createAndSendEmail` → `createEmailActivity` +
  `addEmailAttachment` (POST `activitymimeattachments`) + `SendEmail`. `graph-service.js` is
  SharePoint/OneDrive files only (no `sendMail`). The handoff's "Graph email path" was wrong;
  correct it wherever it recurs.
- **`.ics` attaches with zero new transport infra.** [VERIFIED `dynamics-service.js:1125`]
  `addEmailAttachment` is content-type agnostic (base64-encodes any buffer, sets
  `mimetype: contentType`). An `.ics` is `{ filename, contentType: 'text/calendar', content: Buffer }`.
- **The `.ics` must be a DISTINCT, server-generated attachment lane** — NOT a general
  "always-allowed attachments" flag (Codex #4). [VERIFIED `send-emails.js:335`]
  `recipientMayReceiveAttachments` gates `sharedAttachments` (caller URLs + cycle materials) on
  `wmkf_accepted === true`; a held reviewer is **not** accepted, so an `.ics` routed through that
  array would be stripped. Fix: a separate `calendarAttachments` array built **only from trusted
  request fields** (the `.ics` the server generates), concatenated **after** the
  `recipientMayReceiveAttachments` gate strips `sharedAttachments` — so the calendar file is never
  conflated with the proposal-materials lane and proposal content still cannot leak pre-acceptance.
  Hold template types must additionally **refuse** shared/material attachments outright.
- **Use `METHOD:PUBLISH` ("save the date"), not a meeting REQUEST.** The Dynamics `SendEmail`
  activity gives no `multipart/alternative; method=REQUEST` control, so true RSVP/auto-add
  isn't available — but the design needs no RSVP (acceptance happens in the portal). Ship a
  PUBLISH `.ics` attachment **plus the date in the email body text** as the universal fallback.
- **Resolution of the open lever:** build the `.ics` **now** (chunk 5). The handoff's "ship a
  save-the-date email body as a fast-follow" is no longer a fallback — the attach works today;
  the body text just rides alongside.

---

## 4. Chunks (build order) + acceptance criteria

Each chunk is independently committable. A chunk's red gate (where it has one) blocks the next.

### Chunk 1 — Schema: `held` picklist value + `wmkf_heldat` column ✅ DONE (S257)
> **S257 build status:** COMPLETE. Both scripts run against live Dataverse —
> `wmkf_responsetype` option `100000004: Held` and `wmkf_heldat` (DateTime) both confirmed live
> (CreateAttribute 204 + PublishAllXml 204 + probe verify). Write/read maps + both select lists
> (`FIELD_SELECT`, `SUGGESTION_SELECT`) updated. The `heldAt` *write* (stamping on hold) is Chunk 3;
> the staff-side count consumers are Chunk 8. NOTE: the first picklist run printed a false
> `✗ verify failed` — a stale org-wide metadata read; fixed by adding `PublishAllXml` before verify
> in both scripts.
- **Do:** (a) ✅ `scripts/extend-responsetype-picklist-held.mjs` (clone of the withdrawn_sufficient
  script, idempotent, probes live optionset); (b) ✅ `scripts/add-reviewer-suggestion-heldat-column.mjs`
  (DateTime column-create, idempotent — no prior column-create script existed, so this is a new
  probe-first pattern); (c) ✅ export `RESPONSE_TYPE_MAP.held = 100000004` (write map) **AND**
  `100000004: 'held'` in the read map `RESPONSE_TYPE_BY_VALUE` (`reviewers.js:59`, Codex 2nd-pass #3).
- **⚠ SEQUENCING (audit #7 finding, observed):** the schema scripts had to run **before** the code
  that `$select`s `wmkf_heldat` (selecting a non-existent column 400s every reviewer-suggestion read).
  Done in that order this session: scripts run live first, then both select lists updated. ✅
- **Pre-existing gap noted (not fixed — out of scope):** `RESPONSE_TYPE_BY_VALUE` is also missing
  `100000003: 'withdrawn_sufficient'` — a withdrawn_sufficient row already returns `undefined` here.
  Separate from this build; flagged for a future fix.
- ✅ **Read `wmkf_heldat` in both select lists (Codex #3 — there are TWO).** Done:
  - adapter `FIELD_SELECT` (`reviewer-suggestion.js`) — Review-Manager read path.
  - `SUGGESTION_SELECT` (`lib/external/verify-suggestion-token.js`) — the portal's read path
    ([VERIFIED both `/context` and `/respond` consume the token-verifier's row, not the adapter's).
  - Still TODO in Chunk 4: thread `wmkf_heldat` into the `/context` response/engagementState so the
    HoldView/audit can render "held on {date}".
- **Write-path decision (Codex #5) — DECIDED: option (ii).** `wmkf_heldat` is written ONLY by the
  hold response path (`applyStage2aResponse`/sibling in Chunk 3), NOT via `updateLifecycle` (which
  has no `heldAt` mapping and stays that way), mirroring how `wmkf_responsereceivedat` is stamped
  inside `applyStage2aResponse`. Repeat-hold idempotency (no overwrite) is the Chunk-3 route
  short-circuit.
- **Acceptance:** picklist probe shows 5 options incl. 100000004; a `getRecord` AND a
  `verifySuggestionToken` round-trip both return `wmkf_heldat`; `RESPONSE_TYPE_MAP.held` resolves.
  Script is idempotent (re-run = no-op).
- **Note:** Dataverse schema, NOT a Postgres `.sql` migration — `check:migrations-manifest`
  and `check:atlas` are unaffected, but update the relevant `docs/atlas/` reviewer page if it
  enumerates `wmkf_responsetype` values.

### Chunk 2 — `isProposalReadyForReviewers` predicate + readiness-gated view dispatch ✅ DONE (S257)
> **S257 build status:** COMPLETE. New module `lib/external/proposal-readiness.js` exports
> `isProposalReadyForReviewers(request)`. `computeEngagementState(s, isReady = true)` now exported
> from `context.js` with the hold dispatch; call site computes `ready` once and passes it. Returns
> `isReady`, `held`, and `heldAt` (the latter partially closes the chunk-1 "/context threading" TODO).
> 20 unit tests (`tests/unit/compute-engagement-state.test.js`); eslint clean; 560 reviewer/external
> tests green.
> **⚠ GO-LIVE ORDERING (Mode-B finding):** flipping readiness to "not ready" routes fresh reviewers
> to `hold-invite`/`held` views that the Dispatcher does NOT yet render (chunk 4) → UnknownState
> screen. So `isProposalReadyForReviewers` ships returning **`true`** (treat as ready ⇒ bypass hold,
> zero behavior change; no `held` rows exist until chunk 3). The go-live step is to flip it to the
> real release signal (false until staff release) **after** chunks 3/4/6 ship. This is the single
> localization point.
- **Do:** add `isProposalReadyForReviewers(request)` (new helper, single source of truth for
  the readiness signal — `grep` confirmed zero existing refs). Consumed by **two layers**:
  the view dispatch (this chunk) AND the write boundary (chunk 3, `respond.js`). Threaded into
  `computeEngagementState` as a precomputed `isReady` bool (keeps the dispatch pure + testable).
  [VERIFIED single caller was `context.js:66`, so the signature change was safe.] Dispatch:
  - no prior response & **not** ready → `hold-invite` (lightweight ask)
  - `responsetype === held` & **not** ready → `held` (confirmation + calendar)
  - no prior response **or** `held` & **ready** → `stage2a` (the existing full accept form = finalize)
  - all existing branches (accepted-pre-materials, declined, stage2b, submitted, withdrawn-sufficient) unchanged + verified under both readiness values.
- **Acceptance:** ✅ unit tests over `computeEngagementState` for the four new combinations +
  regression that every existing view still resolves under both `isReady` values. The predicate is
  the **only** place the readiness signal is read, in **both** the view layer (here) and the write
  layer (chunk 3).
- **[OPEN — Justin/Connor, NOT a blocker]:** the real post-QA "release to reviewers" signal.
  [VERIFIED] `wmkf_phaseiisubmittedat` (written by
  `shared/forms/phase-ii-research-2026-06/map-to-dynamics.js`) marks RECEIPT / start of the QA
  window — a **precondition**, not readiness. Until the signal is confirmed, the predicate may
  read an explicit staff "release" flag (likely the PERMANENT trigger). The predicate localizes
  the unknown to one function.

### Chunk 3 — `respond.js action:'hold'` + readiness write-layer gate ✅ DONE (S257)
> **S257 build status:** COMPLETE. `respond.js` gains `action:'hold'`; `applyStage2aResponse`
> gains the `hold` branch (writes `wmkf_responsetype=held` + `wmkf_heldat`/`wmkf_responsereceivedat`,
> clears decline state, never accepted/acks/payment/honorarium). New 409s: `review_received_locked`
> (all actions), `already_released` (hold after release), `already_accepted` (hold on accepted),
> `not_ready` (fresh accept before release). Readiness gate exempts `isAcceptRepeat`; repeat-hold
> short-circuits 200 idempotent before the adapter (no `wmkf_heldat` re-stamp). With the predicate
> still returning `true`, hold POSTs 409 `already_released` and accept is ungated — so chunk 3 is also
> zero-behavior-change until go-live. +17 integration tests; full suite 2424 green; lint 0 errors.
> Codex review (SHIP WITH NAMED CHANGES) → applied: reordered the hold branch so the `accepted`
> row-state guard precedes the `ready` guard (an accepted+ready hold now reports `already_accepted`,
> not `already_released`); added the remaining transition-matrix test cells.
- **Do:** add a third action. It writes `wmkf_responsetype=held`, `wmkf_heldat=now`, optional
  `contactEdits`; it does **NOT** require acks, does **NOT** require a payment contact, does
  **NOT** call `ensureHonorariumOnboarding`, does **NOT** set `wmkf_accepted`. Reuse the same
  token verify + rate-limit + optimistic-lock + state-machine guards. Extend
  `applyStage2aResponse` (or add a sibling) to accept `action:'hold'` — and **update its
  guard message** `action must be 'accept' or 'decline'` (`reviewer-suggestion.js:779-781`)
  to include `hold`.
- **Transition matrix (define explicitly; encode in the `respond.js` guard).** Today's guards
  (`respond.js:189-250`) only model accept↔decline flips + the materials-sent (`409`) and
  withdrawn-sufficient (`409`) locks; `held` must slot in mirroring the existing pre-materials
  reversibility:
  | From | `hold` | `accept` (finalize) | `decline` |
  |---|---|---|---|
  | fresh (no response) | ✓ → held | ✓ (existing fresh-accept) | ✓ (existing) |
  | held | ✓ idempotent, no re-stamp | ✓ → accepted (fresh-accept path; `wmkf_heldat` preserved for audit) | ✓ → declined |
  | declined | ✓ flip → held | ✓ (existing flip) | idempotent (existing) |
  | accepted | ✗ `409` (no downgrade from finalized) | idempotent (existing re-accept) | ✓ (existing flip) |
  | **`wmkf_reviewreceivedat` set (submitted)** | ✗ `409` | ✗ `409` | ✗ `409` |
  | materials_sent+ / withdrawn-sufficient | ✗ `409` (existing locks apply to `hold` too) | ✗ `409` | ✗ `409` |
  - **Submitted-state edge (Codex #2 — pre-existing gap, fix it here).** [VERIFIED] `wmkf_reviewreceivedat`
    is stamped by `lib/services/review-upload.js:209` and `pages/api/review-manager/mark-received-no-file.js:58`
    **without** necessarily setting `wmkf_reviewstatus ≥ materials_sent`; `context.js:269` already treats
    any `wmkf_reviewreceivedat` as the `submitted` view, but today's `respond.js` locks only check
    `withdrawn_sufficient` + `reviewstatus ≥ materials_sent` (`respond.js:195-204`), so a review-received row
    is still flippable. Add `wmkf_reviewreceivedat` to the `respond.js` lock (`409`) for **all three**
    actions — a submitted review must not be re-held/re-accepted/re-declined.
- **Readiness write-layer gate (the server is the contract, not the view).**
  The readiness predicate from chunk 2 also guards `respond.js` so hold-only is enforced at the
  boundary, not just hidden in the UI: when **not** ready, a **fresh** `accept` (finalize) is
  refused (`409 not_ready` / `proposal_not_released`) and `hold` is the only forward move; when
  **ready**, `accept` proceeds and a fresh `hold` is refused (the reviewer should finalize). This
  closes the hole where a crafted `POST {action:'accept'}` during the buffer would fire honorarium
  and defeat the cycle's automation-safety intent. [VERIFIED today `respond.js` has no readiness concept.]
- **The gate MUST exempt the repeat-accept retry (Codex #1 — HIGH).** [VERIFIED `respond.js:250`]
  `isAcceptRepeat = accepted && !declined` deliberately skips acks/payment/stamp and **re-runs**
  `ensureHonorariumOnboarding` (its whole reason to exist is to retry a first-attempt honorarium
  failure). Already-accepted rows exist **now** while readiness is false (reviewers who accepted
  under the pre-hold flow), so a blanket "not ready ⇒ accept refused" would `409` their legitimate
  honorarium retry. **Gate only fresh-finalize and held→finalize accepts (`!isAcceptRepeat`); let
  `isAcceptRepeat` through regardless of readiness.**
- **Repeat-hold idempotency must be MECHANICAL, not hand-waved (Codex 2nd-pass #1 — MED).**
  [VERIFIED `reviewer-suggestion.js:784`] `applyStage2aResponse` unconditionally writes
  `now = new Date().toISOString()`, so a second hold POST would overwrite `wmkf_heldat`. Mirror the
  existing **decline-idempotency short-circuit** (`respond.js:209` — `if (declined && !accepted)
  return 200 idempotent` *without* calling the adapter): in the hold branch, if
  `wmkf_responsetype === 100000004` already (and not accepted/declined), return `200 {idempotent:true}`
  **before** the adapter write, so `wmkf_heldat` is preserved. (Belt-and-suspenders option: the
  adapter skips `wmkf_heldat` when already set — but the route short-circuit is the primary mechanism.)
- **Acceptance:** POST `{action:'hold'}` (not ready) → 200, row shows `responsetype=held`,
  `heldat` set, `accepted` false, **no honorarium contact created**. Idempotent repeat hold =
  no re-stamp. `held → accept` when ready → finalize works (existing accept path, `wmkf_heldat`
  retained). `accept` when **not** ready → `409`. Every transition-matrix cell has a test
  (incl. the `✗ 409` cells). Materials-sent lock still 409s for all three actions.
- **Gate:** register no new route (same file); run `check:api-routes && check:api-routes:self-test`
  (route already covered). Update the two `applyStage2aResponse` callers' tests
  (`tests/unit/respond-required-address.test.js`, `tests/integration/external-review-routes.test.js`)
  for the new action + guard message. [VERIFIED these are the only non-adapter callers via `grep`.]

### Chunk 4 — `HoldView` portal component + dispatcher wiring ✅ DONE (S257)
> **S257 build status:** COMPLETE. New `shared/components/external/HoldView.js` (ask + confirmed
> sub-states, `confirmed` prop). Dispatcher (`pages/external/review/[token].js`) wires `hold-invite`
> → ask and `held` → confirmed; decline from either routes through the existing `decline-form`
> override (already in the popstate VALID set). `wmkf_heldat` surfaces via `engagementState.heldAt`
> (closes the chunk-1/2 "/context threading" TODO). Materials/acks are NOT shown pre-hold. +6 RTL
> tests (`tests/unit/hold-view.test.js`); full suite 2430 green; `npm run build` clean. Still
> unreachable in prod until the readiness predicate flips (hold-invite/held only render when not
> ready); the `.ics`/calendar copy in the confirmed state is text-only until chunk 5.
- **Do:** new `shared/components/external/HoldView.js`. Two sub-states keyed off
  `engagementState`: **ask** ("Will you review? [Hold my spot] / [Decline]" → POST hold /
  decline) and **confirmed** ("You're confirmed — proposals arrive ~{date}; calendar hold
  attached"). Wire `hold-invite` and `held` cases into the `Dispatcher` switch in
  `pages/external/review/[token].js` [VERIFIED switch at line 136]. Decline from hold reuses the
  existing `decline-form` override.
- **Acceptance:** not-ready fresh token renders the ask; after hold, renders confirmed; ready
  token renders Stage2aView (finalize) for both fresh and held. Browser-back behaves like the
  existing override pattern.

### Chunk 5 — `.ics` generation + distinct attachment threading
- **Do:** small `.ics` builder (VCALENDAR/VEVENT, `METHOD:PUBLISH`) from the review window /
  `wmkf_meetingdate`. Thread it through a **separate `calendarAttachments` array** built only
  from trusted server-side request fields, concatenated **after** `recipientMayReceiveAttachments`
  gates `sharedAttachments` (Codex #4) — so it is never part of the proposal-materials lane. Hold
  template types must refuse shared/material attachments outright. Email body also states the date
  in text.
- **Flip `sendAllowsAttachments` from denylist to allowlist (Codex 2nd-pass #2 — MED).**
  [VERIFIED `lib/utils/reviewer-invite.js:31-32`] it is currently `return templateType !== 'invitation'`
  — a **denylist**, so any NEW hold/finalize-trigger template defaults to *allowing* shared/material
  attachment fetching. That silently defeats "hold templates refuse materials." Convert it to an
  **allowlist** of material-bearing template types (today effectively `materials`/`followup`/`thankyou`),
  so hold-ask, hold-confirmation, and the finalize-trigger types fetch **no** shared attachments by
  default. Add a unit test asserting each hold/finalize template denies shared attachments while the
  server-only `calendarAttachments` lane still rides. (This is defense-in-depth alongside
  `recipientMayReceiveAttachments`, which gates on `wmkf_accepted` and would already strip materials
  from a held recipient.)
- **Degrade, don't fail:** an `.ics` build error must log + send the email anyway (body-text
  date is the fallback) — it must NOT move the recipient to `failed`. [VERIFIED `send-emails.js:414`
  routes any send throw to `failed`; the `.ics` build must therefore sit OUTSIDE that throw path or
  be wrapped so a calendar glitch never blocks a hold confirmation.]
- **Acceptance:** hold-confirmation email carries a valid `.ics` (opens in Outlook/Apple
  Mail/Gmail as an add-to-calendar event) for a held (non-accepted) recipient — i.e. the
  materials gate does NOT strip it; AND a pre-acceptance recipient still gets **no proposal
  materials** (the existing invariant is untouched); AND a forced `.ics`-build failure still
  sends the email (date in body) with the recipient in `sent`, not `failed`. Unit test the
  `.ics` string shape + the gate-bypass routing + the degradation path.

### Chunk 6 — Email copy: hold invitation + "proposals ready" finalize trigger
- **Do:** (a) invitation/hold-ask copy (lightweight, "hold your spot"); (b) a "proposals are
  ready — please finalize" email sent when readiness flips, linking back to the same portal
  (now showing finalize). Likely new `templateType`(s) in the Review Manager send path
  [VERIFIED `send-emails.js` switches on `templateType`]; ensure the hold templates carry the
  `.ics` (chunk 5) and **no proposal attachments**.
- **Acceptance:** hold-ask email sends with `.ics`, no materials; finalize-trigger email sends
  on readiness; lifecycle stamping for the new types does not touch `wmkf_reviewstatus`
  (mirrors the invitation branch at `send-emails.js:463`).

### Chunk 7 — Tests, incl. automation-safety
- **Do:** suite covering: hold action (no acks/payment/honorarium); the full chunk-3
  **transition matrix** incl. the `✗ 409` cells (accepted→hold, the **submitted /
  `wmkf_reviewreceivedat`** row for all three actions, locked states); the **readiness
  write-layer gate** — fresh accept refused `409` when not ready, **repeat-accept (`isAcceptRepeat`)
  passes even when not ready** (Codex #1), fresh hold refused when ready; readiness-gated **view
  dispatch** (the four chunk-2 combinations); **repeat-hold preserves `wmkf_heldat`** (second hold
  POST returns `idempotent` and does NOT overwrite the timestamp — Codex 2nd-pass #1); the
  **`sendAllowsAttachments` allowlist** (hold/finalize templates deny shared attachments — #2);
  the **`held` round-trip** (read-map + finder filter, held not miscounted as pending — #3); `.ics`
  shape + gate-bypass + degradation; and an explicit **automation-safety** test asserting a hold
  fires **no** honorarium onboarding and sets no `wmkf_accepted`. Also update the two existing
  `applyStage2aResponse` caller tests for the new action + guard message (see chunk 3).
- **Acceptance:** `npx jest --testPathPatterns "reviewer|external|respond"` green; full
  `npm test && npm run lint && npm run build` green.

### Chunk 8 — Staff-side `held` visibility & round-trip (Codex 2nd-pass #3)
The cycle goal is that **staff gain confidence they hold a committed slate** — so held reviewers
must be *visible* in the workbench, not silently misclassified.
- **Do:** (a) read-map already extended in Chunk 1 (`RESPONSE_TYPE_BY_VALUE`); (b) **map the
  finder's data source** — [VERIFIED `pages/api/reviewer-finder/my-candidates.js:222`] emits
  `responseType: s.wmkf_responsetype || null` as a **raw number** (100000004 for held), but the UI
  (`reviewer-finder.js:3047`) compares **strings** (`=== 'accepted'`). So held (and arguably every
  status on this path) never matches a string bucket. Map the numeric → string here (reuse
  `RESPONSE_TYPE_BY_VALUE`) and add a `held` bucket to the finder filter + any status count/badge;
  (c) **guard the `pending` bucket** — [VERIFIED `reviewer-finder.js:3047`] today `pending` =
  `emailSentAt && !responseType && !accepted && !declined`; a `held` row (responseType `held`,
  `accepted=false`) must NOT fall into `pending`, and a held row whose responseType failed to
  round-trip (undefined) would wrongly count as pending — fixed by the read-map + the string mapping
  above + an explicit `held` exclusion.
- **Count consumers found by audit #7 + the chunk-1/2 Codex review (S257):** the `RESPONSE_TYPE_MAP`
  symbol grep surfaced two aggregators; the later code review caught a third (`my-candidates.js`, above)
  that the map-symbol grep had MISSED because it reads the raw field, not the map — lesson: grep the
  persisted FIELD (`wmkf_responsetype`), not just the mapping-helper variable. All bucket a held row
  as "invited only," undercounting the committed slate:
  - **`pages/api/workbench/dashboard.js:253-255`** (staff workbench) — held lands in `invited`, not
    `accepted`; `getPhase` (`:300`) keeps the proposal at `awaiting` despite a confirmed slate. Add a
    `held` count + decide whether held counts toward the "enough confirmed" phase signal.
  - **`pages/api/reviewer-finder/my-proposals.js:226-227`** (PI-facing) — same invited-only undercount.
  - [VERIFIED SAFE, no change] `lib/services/reviewer-suggestion-sweep.js:52` filters
    `wmkf_responsetype eq null`; a held row is non-null so the no_response timeout **correctly skips
    held reviewers** (they've agreed in principle, shouldn't be timed out).
- **Acceptance:** a held suggestion renders in the workbench under a `held` status (not `pending`,
  not blank); status counts include held; the default Review-Manager "accepted" scope still
  excludes held (held `wmkf_accepted=false`, [VERIFIED `reviewers.js:119` filters `wmkf_accepted === true`]).
- **[OPEN — light]:** confirm with Justin how prominently the workbench should surface the held
  slate (own column vs. filter only) — UI polish, not a blocker.

---

## 5. Key files

| File | Role in this build |
|------|--------------------|
| `scripts/extend-responsetype-picklist.mjs` | template for the idempotent `held=100000004` add (chunk 1) |
| `scripts/extend-responsetype-picklist-held.mjs` | ✅ S257 — the `held` picklist add (run against live Dataverse) (1) |
| `scripts/add-reviewer-suggestion-heldat-column.mjs` | ✅ S257 — the `wmkf_heldat` column-create (run before select-list edits) (1) |
| `lib/dataverse/adapters/reviewer-suggestion.js` | `RESPONSE_TYPE_MAP`, `FIELD_SELECT`, `applyStage2aResponse`, `updateLifecycle` — add `held` + decide `heldAt` write path (1,3) |
| `lib/external/verify-suggestion-token.js` | `SUGGESTION_SELECT` — the portal's actual read path; add `wmkf_heldat` (1, Codex #3) |
| `pages/api/external/review/[token]/respond.js` | add `action:'hold'` + transition matrix + readiness write-layer gate (3) |
| `lib/external/proposal-readiness.js` | ✅ S257 — `isProposalReadyForReviewers` predicate (go-live gate); both layers read it (2,3) |
| `pages/api/external/review/[token]/context.js` | ✅ S257 — `computeEngagementState(s, isReady)` exported + hold dispatch; call site computes readiness (2) |
| `pages/external/review/[token].js` | Dispatcher switch — add `hold-invite`/`held` (4) |
| `shared/components/external/HoldView.js` | new component (4) |
| `lib/services/dynamics-service.js` | `addEmailAttachment` — content-type agnostic, no change needed; reference for `.ics` (5) |
| `pages/api/review-manager/send-emails.js` | hold/finalize templateTypes + `.ics` distinct-attachment threading (5,6) |
| `lib/utils/reviewer-invite.js` | `sendAllowsAttachments` denylist→allowlist; `recipientMayReceiveAttachments` (ref) (5) |
| `pages/api/review-manager/reviewers.js` | `RESPONSE_TYPE_BY_VALUE` read-map — add `held` (1,8) |
| `pages/reviewer-finder.js` | `candidateMatchesEmailFilter` — add `held` bucket, guard `pending` (8) |
| `pages/api/workbench/dashboard.js` | count aggregator — add `held` count; phase signal (audit #7) (8) |
| `pages/api/reviewer-finder/my-proposals.js` | PI-facing count aggregator — add `held` count (audit #7) (8) |
| `pages/api/reviewer-finder/my-candidates.js` | emits raw numeric `responseType` — map to string + `held` bucket (Codex ch1/2 review) (8) |
| `lib/services/reviewer-suggestion-sweep.js` | no_response timeout — VERIFIED skips held (no change) (1) |
| `shared/forms/phase-ii-research-2026-06/map-to-dynamics.js` | writes `wmkf_phaseiisubmittedat` (readiness precondition, ref for chunk 2) |

## 6. Testing

```bash
npx jest --testPathPatterns "reviewer|external|respond"   # reviewer + external-portal suites
npm test && npm run lint && npm run build                 # full suite
```

## 7. Open items (carry forward, none block the build)

1. **[OPEN — Justin/Connor]** the post-QA "release to reviewers" signal feeding
   `isProposalReadyForReviewers`. Localized to one predicate (chunk 2).
2. **[OPEN — Justin, light]** how prominently the workbench should surface the held slate
   (own column vs. filter only). UI polish, not a blocker (chunk 8).
3. **Atlas/docs** reviewer page enumerating `wmkf_responsetype` values must gain `held` (chunk 1).
