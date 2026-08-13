---
title: "Manual Respond-By Nudge — Build Plan"
domain: reviewer-identity
kind: plan
status: active
summary: "Give PDs an on-demand nudge for unanswered reviewers while blocking removed/revoked token resurrection."
canonical: false
cataloged: 2026-08-13
owner: product-engineering
related:
  - lib/services/reviewer-manual-reminder.js
  - lib/services/reviewer-reminder-sweep.js
  - pages/api/review-manager/send-review-reminder.js
  - shared/components/reviewers/ReviewerInvitePanel.js
---

# Manual Respond-By Nudge — Build Plan

**Status:** PHASE A IMPLEMENTED on `codex/manual-respond-by-nudge`; Claude Opus
re-review found no remaining P0/P1/P2 issues after fixes. Awaiting promotion;
not deployed to production. Phase B remains open.
**Session:** S424, 2026-08-13.
**Build owner:** Codex leads implementation; Claude reviews.

**Review history.** Claude drafted; Codex adversarial review returned
`needs-attention` with two `[high]` findings, both confirmed against source:
§2's original defect claim was wrong (it asserted `softDelete` leaves
`wmkf_accepted`/`wmkf_reviewstatus` intact — it does not), and the original
scope missed the other `mintAndStore` callers that clear revocation. Codex then
rewrote §2 and added the mint-surface audit. Claude's review of that rewrite
verified every changed citation and found the evidence-artifact problem recorded
under "Evidence integrity" below, plus the phase split in §0.

## 0. Phase split, and evidence integrity

**Phase A — ship first (this plan's original intent).** The manual respond-by
nudge plus selected/revoked guards on the two manual reminder paths (§4a, §4b,
§4c, §4d). Small, self-contained, and the thing two PDs need now.

**Phase B — separate change, own review.** The mint-surface hardening for
`ensureToken`, `send-emails-service`, and `regenerateToken` (see the
mint-surface audit). These are **pre-existing** exposure that Phase A neither
creates nor widens. `send-emails-service`'s mint is the hot path for every
invitation batch `[VERIFIED via lib/services/review-manager/send-emails-service.js:661-680]`,
so guarding it under time pressure risks breaking ordinary sends — a worse
failure than the one being prevented. Phase B keeps its own verification rows in
§5 so they are not lost.

Splitting does NOT downgrade Phase B. The invariant "a removed or revoked
reviewer is never resurrected except through an explicit restore" is not closed
until Phase B lands.

**Evidence integrity.** `outputs/respond-reminder-gates.json` is cited below but
**was never written**: the probe's usage block advertised `--output <path>` while
its parser accepted only `--output=<path>`, so every documented invocation
printed findings and silently wrote nothing
`[VERIFIED via scripts/probe-respond-reminder-gates.js parseCli, fixed S424]`.
The production figures quoted in this plan came from probe stdout captured in
the S424 session transcript, not from a committed artifact. `outputs/` is
gitignored, so re-running the probe produces a local artifact only. Treat the
scale figures as `[ASSUMED]` until re-measured.
[RECHECKED after scripts/probe-respond-reminder-gates.js change: scripts/probe-respond-reminder-gates.js parseCli now accepts both `--flag value` and `--flag=value`, covered by tests/unit/probe-respond-reminder-gates.test.js; the gate ladder this plan cites (classify) and the token states (auditToken) are unchanged by that fix, so every §2 citation still holds.]

## 1. Why this, and why not the cron

A PD cannot currently nudge an invited reviewer who has not answered. The
respond-by reminder exists and is scheduled daily, but has never fired: its
per-request opt-in `wmkf_respondreminderenabled` is `null` on every request,
and no UI can set it.

`[VERIFIED via production probe, 2026-08-13]`
`scripts/probe-respond-reminder-gates.js --target=prod`: every scanned invited,
unanswered reviewer skips at that gate, and `respondReminderEnabled` is `null`
on every request carrying such a reviewer. The denominator is the probe's own
`scanned`, which re-runs `sweepRespondReminders`' filter verbatim.
Artifact: `outputs/respond-reminder-gates.json`.

**Owner constraint (S424):** half the PDs have completed their reviewer slates
and must NOT nudge their stragglers. The rest are actively recruiting and want
to chase overdue invitees. A per-reviewer, PD-initiated action satisfies both;
arming the cron does not, because it is per-request configuration applied by a
daily sweep.

So: build the manual nudge now, leave `respondReminderEnabled` untouched, and
defer the cron/auto-send decision. Nothing in this plan arms the sweep.

## 2. The blocking defect this must fix first

**Removing a candidate manufactures the exact state the disabled respond sweep
selects, and any later mint clears the revocation flag.**

| Step | Evidence |
|---|---|
| `softDelete` writes `wmkf_selected:false`, `wmkf_accepted:false`, `wmkf_declined:false`, `wmkf_responsetype:null`, `wmkf_reviewstatus:null`, and `wmkf_heldat:null`; when `alsoRevokeToken` is true it also writes `wmkf_externaltokenrevoked:true`. | `[VERIFIED via lib/dataverse/adapters/reviewer-suggestion.js:1951-1959]` |
| The shipped manual review-due sender is **not** vulnerable to this removed-row shape: it requires `wmkf_accepted === true`, then requires `wmkf_reviewstatus` to be materials-sent or under-review before sending. | `[VERIFIED via lib/services/reviewer-manual-reminder.js:74-79]` |
| The respond sweep selects rows where accepted is false/null, declined is false/null, and response type is null. | `[VERIFIED via lib/services/reviewer-reminder-sweep.js:106-113]` |
| The respond sweep does not filter on `wmkf_selected`. | `[VERIFIED via command: rg wmkf_selected lib/services/reviewer-reminder-sweep.js -> no hits]` |
| The respond sweep's token gate checks expiry, not revocation. | `[VERIFIED via lib/services/reviewer-reminder-sweep.js:146-149]` |
| Reminder sending mints a fresh token before email send, and minting clears the revoked flag. | `[VERIFIED via lib/services/reviewer-reminder-sweep.js:283-294; lib/external/token-lifecycle.js:53-67; lib/dataverse/adapters/reviewer-suggestion.js:208-215]` |

Net effect by path: `[VERIFIED via lib/services/reviewer-manual-reminder.js:74-79]`
the shipped manual review-due sender will refuse a removed row because removal
sets `wmkf_accepted:false` and `wmkf_reviewstatus:null`, while the sender
requires accepted plus materials-sent/under-review. `[VERIFIED via
lib/dataverse/adapters/reviewer-suggestion.js:1951-1959;
lib/services/reviewer-reminder-sweep.js:106-113]` the disabled respond sweep is
the vulnerable path because removal lands on exactly accepted=false,
declined=false, `wmkf_responsetype:null`, which is the shape the sweep selects.
Removal does not merely fail to be excluded from that filter; it manufactures
the matching shape.

**Scale.** `[VERIFIED via production probe artifact named in this plan,
2026-08-13: outputs/respond-reminder-gates.json]` a substantial minority of the
scanned population carried `wmkf_externaltokenrevoked === true`, and the
`--assume-enabled` projection placed most of those inside the set a cron run
would have emailed. `[ASSUMED: local checkout does not currently contain
outputs/respond-reminder-gates.json; rg found only scripts/probe-respond-reminder-gates.js
and tests/unit/probe-respond-reminder-gates.test.js]` the exact current figures
must be read from the artifact when available. `[ASSUMED inference, not a
measurement]` the removed-row write shape plausibly explains the revoked-token
share in that output because removal creates the respond-sweep predicate shape
and may also revoke the token.

`[ASSUMED]` that the revoked rows in the production artifact are specifically
REMOVED candidates rather than staff-cutoff revocations. The fix does not depend
on the answer — both revocation sources must refuse manual nudges (§4a), and
the disabled cron must remain treated as unsafe until it has its own selected
and revocation guards.

**Reachability today** is narrow but real. The Invite tab's ACTIVE list is
selected-only (`[VERIFIED via my-candidates-service.js:146]`,
`selectedOnly: true`), and the complement check confirms no other feed:
`rg 'findByRequest\(' lib/services pages` enumerates every call site, and the
sole supplier of `ReviewerInvitePanel`'s `candidates` prop is that call
(`[VERIFIED via ReviewersTab.js:494]`). So the UI does not today offer the
button for a removed row.

**But the same component also renders `removedCandidates`**
(`[VERIFIED via ReviewersTab.js:495]`), which by definition holds unselected,
token-revoked rows. §4d must scope the action to the active list only — adding
it to a shared row renderer without qualification would hand a PD a one-click
way to resurrect a removed reviewer, which is precisely the defect being fixed.

The service is the authority regardless — its own docblock says eligibility is
"re-derived from a fresh read (never trust client-claimed state)" — so the gap
is a server-side defect, not a UI one.

The shipped review-due sender is **not** vulnerable to the removed-row shape —
that claim was retracted after review. It still gains the revocation guard in
Phase A, for the reason in §7.3: any allowed send mints, and minting clears
revocation, so a row revoked by staff cutoff while still selected must be
refused rather than silently reopened.

## 3. What is in and out

### In
1. `wmkf_selected === true` and `wmkf_externaltokenrevoked !== true` eligibility
   checks on both manual paths, with a distinct refusal reason.
2. `sendManualRespondReminder` — a respond-by nudge for a single reviewer.
3. `kind` discriminator on the existing route.
4. Per-row "Send reminder" action on the Invite Reviewers ACTIVE list.
5. Tests, including the removed-candidate refusal.
(Items 1-5 are **Phase A**.)

### Phase B (separate change, own review — see §0)
6. Mint-surface guards for every `mintAndStore` caller whose current path could
   otherwise clear a revoked token through `setExternalToken`.

### Out (explicitly deferred)
- Arming `respondReminderEnabled` / exposing campaign-settings toggles.
- Per-reason `skipped` counters in the cron sweep.
- Adding `wmkf_selected` / revocation checks to the **cron** sweep. The cron is
  disabled everywhere, so it cannot fire; fixing it is a separate change made
  when the toggle work happens. **This plan must not leave a reader believing
  the cron is safe** — it is unfixed, and gated only by the null flag.
- Sticky per-user reminder defaults.

### Mint-surface audit

`[VERIFIED via lib/external/token-lifecycle.js:53-67;
lib/dataverse/adapters/reviewer-suggestion.js:208-215]` every
`mintAndStore` call writes through `setExternalToken`, and `setExternalToken`
always persists `wmkf_externaltokenrevoked:false`. Clearing revocation is safe
only when the caller has an explicit restore/reissue contract.

| Caller | Current behavior | Required contract |
|---|---|---|
| `ensureToken` | `[VERIFIED via lib/external/token-lifecycle.js:105-159; lib/dataverse/adapters/reviewer-suggestion.js:201-205]` it reads hash, revoked, expiry, accepted, due override, request, and applicant disposition; it mints when the row is revoked because `hasHash && !revoked && !expired` is the only active-token early return. | `[ASSUMED contract]` clearing revocation is intentional only for an explicit active-candidate restore/repair path. Require `wmkf_selected === true`, `wmkf_externaltokenrevoked !== true`, or an explicit `allowRevokedRestore` precondition owned by the restore flow; otherwise return a refused reason and do not mint. |
| `send-emails-service` | `[VERIFIED via lib/services/review-manager/send-emails-service.js:661-680]` send-time external-link authority mints for each draft after request-id validation, and the cited region does not check `wmkf_selected` or `wmkf_externaltokenrevoked`. | `[ASSUMED contract]` clearing revocation is intentional only for an actively selected recipient being sent an invitation/review email. Require the draft suggestion read used for send-time authority to prove selected and not revoked before minting; a revoked-row fixture must fail before `mintAndStore`. |
| `regenerateToken` | `[VERIFIED via lib/services/review-manager/regenerate-token-service.js:61-93]` it gates only on `APPLICANT_DISPOSITION_EXCLUDED` before minting. `[VERIFIED via lib/dataverse/adapters/reviewer-suggestion.js:1160-1163]` its select omits `wmkf_selected` and `wmkf_externaltokenrevoked`. | `[ASSUMED contract]` clearing revocation is not intentional for a removed or cutoff row. Add `wmkf_selected` and `wmkf_externaltokenrevoked` to the regeneration select, then require selected and not revoked unless the route receives and enforces an explicit restore precondition. |
| `reviewer-reminder-sweep` | `[VERIFIED via lib/services/reviewer-reminder-sweep.js:99-113; lib/services/reviewer-reminder-sweep.js:146-160; lib/services/reviewer-reminder-sweep.js:283-294]` respond sweep selection omits selected/revoked, checks expiry only, and `sendOneReminder` mints for both respond and review-due sends. | `[ASSUMED contract]` clearing revocation is intentional for an eligible live reminder only. Manual paths must refuse removed/revoked before they reach `sendOneReminder`; the cron remains disabled and unsafe until its own sweep filters include selected and not-revoked. |

## 4. Design

### 4a. Shared eligibility, both manual paths

Add to `lib/services/reviewer-manual-reminder.js`:

```
if (row.wmkf_selected !== true) return { ok: false, reason: 'removed' };
if (row.wmkf_externaltokenrevoked === true) return { ok: false, reason: 'revoked' };
```

`SUGGESTION_SELECT` gains `wmkf_selected`, `wmkf_externaltokenrevoked`, and for
the respond path `wmkf_invited`, `wmkf_emailsentat`, `wmkf_responsetype`,
`wmkf_declined`. Manual send intentionally does not require the current token
expiry because it mints a fresh link after the lifecycle authorization.

**Fail closed on revocation, deliberately.** Revocation has two sources —
candidate removal and staff cutoff/leak response, which
`[VERIFIED via lib/external/token-lifecycle.js:170-172]` calls "a separate
axis". Both mean "this person's access was withdrawn," so a nudge refuses rather
than silently reopening. A PD who wants them back restores the candidate first.
This is why the pending `[ASSUMED]` in §2 does not gate the build.

`removed` and `revoked` are distinct reasons, not generic `ineligible`.
`[ASSUMED contract]` `removed` means `wmkf_selected !== true`; `revoked` means
`wmkf_externaltokenrevoked === true` while the row is still selected. The UI can
render both as non-retryable without an explicit restore action, but staff-cutoff
or leak-response revocation must not be mislabeled as ordinary candidate
removal.

### 4b. `sendManualRespondReminder`

Mirrors `sendManualReviewDueReminder` — same `sendOneReminder`, so manual and
cron sends stay byte-identical in what they send and how they claim.

- `kind: 'respond'` → stamps `wmkf_respondremindersentat`, renders the
  respond-by templates, mints with `accepted: false` (expiry = review-due plus
  the short non-responder grace,
  `[VERIFIED via lib/external/reviewer-token-ttl.js:36]`).
- Eligibility: belongs to this request · selected · not revoked · `wmkf_invited
  === true` · `wmkf_emailsentat` present · `wmkf_responsetype` null ·
  `wmkf_declined !== true` · not applicant-excluded · PD resolvable · reviewer
  has an email.
- **No deadline gate.** The cron's `not_yet_due` check is what makes it a
  schedule. A PD clicking the button has already decided. Matches the shipped
  review-due manual, which also has no date gate.
- **Re-sends allowed**, as with review-due: the marker is stamped but is not a
  filter here. Concurrency stays safe — after a fresh lifecycle authorization,
  `sendOneReminder` persists marker + token in one If-Match PATCH before
  sending, so a 412 aborts without leaving a phantom reminder marker.

Owner-accepted side effect: minting extends the reviewer's window. Raised and
accepted 2026-08-13 — this is the point when chasing an overdue invitee.

### 4c. Route

Extend `pages/api/review-manager/send-review-reminder.js` with
`kind: 'respond' | 'reviewdue'`, defaulting to `reviewdue` so the existing
caller is unchanged. Reject any other value (allowlist, not denylist).

No new route means no new `API_ROUTE_SECURITY_MATRIX.md` row, but the existing
row must be **updated**: it currently describes only the review-due marker. Add
the respond marker and the new refusal reason. `check:api-routes` must pass.

### 4d. UI

`shared/components/reviewers/ReviewerInvitePanel.js` — per-row action shown when
`c.invited && !c.responseType && !c.declined && !c.accepted`.

- **Active rows only.** The action must NOT render in the `removedCandidates`
  list (§2). Gate on the active-list render path, not on candidate shape alone,
  so a future refactor unifying the two renderers cannot silently expose it.
- Confirm dialog before sending (a real email cannot be unsent — matches
  `InviteEmailModal`'s send confirm).
- Surface "last nudged" — requires adding `respondReminderSentAt` to the
  my-candidates DTO (the column is written at
  `[VERIFIED via my-candidates-service.js:633]` but is not currently emitted).
  Without it a PD cannot see they already nudged, and re-sends are allowed.
- Map every typed outcome to staff-facing copy: lifecycle refusal (`removed`,
  `revoked`, `not_found`), concurrency (`conflict`), transient authorization
  (`read_failed`), and pre-email persistence/preparation failure
  (`prepare_failed`). The Invite panel may refresh after its blocking alert for
  stale lifecycle rows; the Reviews tab keeps its row mounted so inline error
  copy is not erased by the selected-only roster reload.

## 5. Verification

| Invariant | Verification |
|---|---|
| A removed/revoked reviewer is never nudged, on **either** path | Unit: fixture with `selected=false`+`revoked=true` that passes every OTHER check → `removed`, and `sendOneReminder` NOT called |
| The token is not un-revoked as a side effect | Assert no mint/patch occurs on the refusal path |
| Respond nudge stamps the respond marker, not the review-due one | Assert patch fields per `kind` |
| Manual re-send still allowed | Second call with the marker set succeeds |
| A claim conflict aborts without sending | Existing sweep harness pattern |
| Cron behavior unchanged | `sweepRespondReminders` tests untouched and green |
| Wrong `kind` is rejected | Route test asserts a validation failure on an unknown value |
| The action never renders on a removed row | Component test rendering `removedCandidates` asserts no send control |
| **[Phase B]** `ensureToken` does not clear revocation accidentally | Unit: revoked row with selected=false and otherwise mintable token state returns refused/no-mint; restore-path test must pass an explicit restore precondition before minting |
| **[Phase B]** Send-time email mint does not clear revocation accidentally | Unit: draft recipient with revoked row and valid request/token context fails before `mintAndStore`; active selected non-revoked row still mints |
| **[Phase B]** Token regeneration does not clear revocation accidentally | Route/service unit: revoked row with applicant disposition not excluded and valid request refuses before `mintAndStore`; active selected non-revoked row still regenerates |
| Reminder mint does not clear revocation accidentally | Unit: manual respond and review-due revoked-row fixtures pass every other gate, return `revoked`, and never call `sendOneReminder`/`mintAndStore`; cron test documents current disabled unsafe state until sweep guards are added |

Every negative test must construct the state that WOULD trip the guard — a
`removed` fixture failing an earlier check proves nothing. Each fixture is
asserted to pass all other gates first.

Gates: `check:types`, `check:api-routes` (+ self-test), `check:route-lifecycle-auth`,
`check:trust-boundary-guid`, `check:atlas`, full `tests/unit`.

## 6. Risks

1. **The cron remains unfixed.** Out of scope by choice; safe only because the
   flag is null everywhere. Anyone arming it before that fix reintroduces the
   removed-candidate send across the whole scanned population
   `[ASSUMED via production probe artifact named in this plan:
   outputs/respond-reminder-gates.json scanned, 2026-08-13; independent of TBD
   count]`. Record in the wiki hazard page.
2. **`respondReminderSentAt` in the DTO** is a projection change — check for
   other consumers before adding.
3. **Re-sends are unbounded.** A PD can nudge repeatedly; only the confirm
   dialog and the visible "last nudged" stamp restrain it. Accepted as matching
   the shipped review-due behavior.
4. **`kind` defaulting** must not let a malformed body silently send the wrong
   template. Allowlist the two values.

## 7. Decision contracts

1. `[ASSUMED contract]` `removed` and `revoked` both map to HTTP 409 conflict. They are
   state conflicts with the requested send, not malformed input. The response
   body must preserve the exact reason so the UI can show restore-specific copy.
2. `[ASSUMED contract]` the manual respond nudge may re-mint an expired token for a
   selected, not-revoked, invited, unanswered reviewer. Re-minting is the point
   of the owner-accepted manual chase flow, and the expiry extension remains an
   accepted side effect.
3. `[ASSUMED contract]` there is no permissive exception for the manual review-due path:
   selected and not-revoked are required before it can reach `sendOneReminder`.
   `[VERIFIED via lib/services/reviewer-manual-reminder.js:74-79]` the shipped
   review-due path is already protected from the removed-row shape by accepted
   and review-status gates, but `[VERIFIED via lib/services/reviewer-reminder-sweep.js:283-294;
   lib/dataverse/adapters/reviewer-suggestion.js:208-215]` any allowed send
   still mints and would clear revocation, so explicit revocation refusal is
   required.
4. `[ASSUMED contract]` `removed` and `revoked` are distinct contract reasons.
   `removed` is for `wmkf_selected !== true`; `revoked` is for
   `wmkf_externaltokenrevoked === true` on a selected row. This preserves the
   operational difference between candidate removal and staff-cutoff/leak
   response while treating both as no-send states unless a separate restore
   action explicitly re-authorizes access.

## 8. Phase A implementation report (2026-08-13)

### Evidence matrix

| Claim | Producer / entry point | Persistence / authority | Consumer | Strongest evidence | Status |
|---|---|---|---|---|---|
| Manual respond nudge is available for an active unanswered invite | `ReviewerInvitePanel` → `POST /api/review-manager/send-review-reminder` with `kind:'respond'` | Fresh suggestion lifecycle reads; respond template defaults | Dynamics email send | Component, route, and service tests | **VERIFIED on branch** |
| Omitted `kind` preserves the existing review-due action; unknown values fail closed | Existing Reviews-tab caller omits `kind`; route allowlist | N/A | `sendManualReviewDueReminder` or HTTP 400 | Route discriminator tests | **VERIFIED on branch** |
| Removed/revoked rows cannot be resurrected by either manual reminder path | Both manual services preflight, then authorize again immediately before the write | Marker + token fields share one PATCH bound to the fresh row ETag; a refusal writes neither, and a concurrent change yields 412 before email send | Typed `removed`, `revoked`, or `conflict` response | Positive-control lifecycle-transition tests on both paths, read-failure tests, atomic-write 412 test, and adversarial `mintAndStore` merge-order test | **VERIFIED on branch** |
| Respond marker is visible as “last nudged” | `sendOneReminder(kind:'respond')` | `wmkf_respondremindersentat` | my-candidates DTO → active Invite-panel row | Service, DTO, and component tests | **VERIFIED on branch** |
| Old async responses cannot affect a newly selected request | Request-keyed inner Invite panel | N/A | Alert, refresh, and spinner state | A → B → A component test | **VERIFIED on branch** |
| Automatic respond sweep is safe to arm | Cron route | Existing campaign toggle and sweep filters | Scheduled email | No Phase A change to cron selection/authorization | **PLANNED — Phase B / cron hardening required** |
| Other token-mint callers refuse removed/revoked rows | `ensureToken`, invitation send, token regeneration | `wmkf_appreviewersuggestion` | Reviewer portal links | Mint-surface audit in §0/§3 | **PLANNED — Phase B** |

### Review and sweep result

- First adversarial pass found a removal/token-mint race and an A → B → A stale
  UI-state race. Both were fixed and regression-tested.
- Second pass found only a path-specific transition test gap. Respond-accepted
  and review-submitted transitions now prove both lifecycle callbacks.
- Claude Opus review found that the intermediate authorization design could leave
  a reminder marker when no email was sent, and that the Reviews-tab consumer
  rendered new refusal codes raw. Manual marker + token persistence is now one
  fresh-ETag-bound write, and both UI consumers map every typed outcome.
- Opus re-review found no remaining P0/P1/P2 issue and identified five P3
  cleanup gaps. The stale lifecycle wiki was corrected; pre-email failures now
  remain distinct from post-persistence send failures; Reviews-tab refusal copy
  remains mounted; transient reads are no longer mislabeled `not_found`; and
  tests pin token-field precedence plus both reminder paths.
- Durable restatements checked: this plan, `API_ROUTE_SECURITY_MATRIX.md`, the
  reviewer lifecycle wiki hazard, source, DTO consumers, and tests. The stale
  “No code written yet” status was structurally replaced above.
- **Sweep verdict:** `RECONCILED` for Phase A branch state. Remaining live
  stale statements: 0. Remaining planned work: promotion, Phase B
  mint-surface hardening, and cron guards before enabling
  `respondReminderEnabled`.
