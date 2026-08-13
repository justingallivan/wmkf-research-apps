---
title: "Manual Respond-By Nudge — Build Plan"
domain: reviewer-identity
kind: plan
status: active
summary: "Give a PD an on-demand nudge for an invited reviewer who has not answered, and close the removed-candidate hole the shipped nudge shares."
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

**Status:** DRAFT, awaiting Codex review. No code written.
**Session:** S424, 2026-08-13.

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

**Removing a candidate from a proposal revokes their magic link, but neither
reminder path notices.**

| Step | Evidence |
|---|---|
| Removal writes `wmkf_selected=false` + `wmkf_externaltokenrevoked=true` in one PATCH | `[VERIFIED via lib/services/reviewer-finder/my-candidates-service.js:867-880]` |
| Neither sweep filters on `wmkf_selected` | `[VERIFIED via rg wmkf_selected lib/services/reviewer-reminder-sweep.js → no hits]` |
| The sweep's token gate checks expiry, not revocation | `[VERIFIED via lib/services/reviewer-reminder-sweep.js:150-152]` |
| The shipped manual sender checks neither | `[VERIFIED via lib/services/reviewer-manual-reminder.js:74-89]` |
| Sending mints a fresh token first | `[VERIFIED via lib/services/reviewer-reminder-sweep.js:286]` |
| Minting **clears the revoked flag** | `[VERIFIED via lib/dataverse/adapters/reviewer-suggestion.js:215-221]` |

Net effect: nudging a removed reviewer emails them **and restores the portal
access that removal revoked**. `softDelete` leaves `wmkf_accepted` and
`wmkf_reviewstatus` untouched, so a removed reviewer still satisfies every
check the shipped review-due nudge makes.

**Scale.** `[VERIFIED via production probe, 2026-08-13]` a substantial minority
of the scanned population carries `wmkf_externaltokenrevoked === true`, and the
`--assume-enabled` projection placed most of those inside the set a cron run
would have emailed. Numerator and denominator come from the same `scanned`
population. The overlap is derived by intersecting per-request `revoked` and
`wouldSendIfEnabled` figures, so it is a floor for whole-request agreement, not
a row-level join. Exact figures live in `outputs/respond-reminder-gates.json`
and move with the data.

`[ASSUMED]` that these revoked rows are specifically REMOVED candidates rather
than staff-cutoff revocations. The revoke pattern is uniform per request, which
fits removal, but `wmkf_selected` was added to the probe to measure this
directly and that reading is still pending. **The fix does not depend on the
answer** — both revocation sources must refuse a nudge (§4a).

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

This is fixed **before** the new nudge is added, and the fix covers the shipped
path as well as the new one.

## 3. What is in and out

### In
1. `wmkf_selected === true` and `wmkf_externaltokenrevoked !== true` eligibility
   checks on both manual paths, with a distinct refusal reason.
2. `sendManualRespondReminder` — a respond-by nudge for a single reviewer.
3. `kind` discriminator on the existing route.
4. Per-row "Send reminder" action on the Invite Reviewers ACTIVE list.
5. Tests, including the removed-candidate refusal.

### Out (explicitly deferred)
- Arming `respondReminderEnabled` / exposing campaign-settings toggles.
- Per-reason `skipped` counters in the cron sweep.
- Adding `wmkf_selected` / revocation checks to the **cron** sweep. The cron is
  disabled everywhere, so it cannot fire; fixing it is a separate change made
  when the toggle work happens. **This plan must not leave a reader believing
  the cron is safe** — it is unfixed, and gated only by the null flag.
- Sticky per-user reminder defaults.

## 4. Design

### 4a. Shared eligibility, both manual paths

Add to `lib/services/reviewer-manual-reminder.js`:

```
if (row.wmkf_selected !== true) return { ok: false, reason: 'removed' };
if (row.wmkf_externaltokenrevoked === true) return { ok: false, reason: 'removed' };
```

`SUGGESTION_SELECT` gains `wmkf_selected`, `wmkf_externaltokenrevoked`, and for
the respond path `wmkf_invited`, `wmkf_emailsentat`, `wmkf_responsetype`,
`wmkf_declined`, `wmkf_externaltokenexpires`.

**Fail closed on revocation, deliberately.** Revocation has two sources —
candidate removal and staff cutoff/leak response, which
`[VERIFIED via lib/external/token-lifecycle.js:170-172]` calls "a separate
axis". Both mean "this person's access was withdrawn," so a nudge refuses rather
than silently reopening. A PD who wants them back restores the candidate first.
This is why the pending `[ASSUMED]` in §2 does not gate the build.

`removed` is a distinct reason (not `ineligible`) so the UI can say why.

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
  filter here. Concurrency stays safe — `sendOneReminder` claims via If-Match
  before sending, so a 412 aborts without sending.

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
- Map `removed` to "This reviewer was removed from the proposal — restore them
  first," and `conflict` to the existing already-claimed copy.

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

Every negative test must construct the state that WOULD trip the guard — a
`removed` fixture failing an earlier check proves nothing. Each fixture is
asserted to pass all other gates first.

Gates: `check:types`, `check:api-routes` (+ self-test), `check:route-lifecycle-auth`,
`check:trust-boundary-guid`, `check:atlas`, full `tests/unit`.

## 6. Risks

1. **The cron remains unfixed.** Out of scope by choice; safe only because the
   flag is null everywhere. Anyone arming it before that fix reintroduces the
   removed-candidate send across the whole scanned population
   `[DERIVED-FROM: outputs/respond-reminder-gates.json scanned, 2026-08-13;
   independent of TBD count]`. Record in the wiki hazard page.
2. **`respondReminderSentAt` in the DTO** is a projection change — check for
   other consumers before adding.
3. **Re-sends are unbounded.** A PD can nudge repeatedly; only the confirm
   dialog and the visible "last nudged" stamp restrain it. Accepted as matching
   the shipped review-due behavior.
4. **`kind` defaulting** must not let a malformed body silently send the wrong
   template. Allowlist the two values.

## 7. Open questions for review

- Should `removed` map to a conflict or an unprocessable-entity status?
  Currently proposing conflict, to match `ineligible`.
- Should the respond nudge also refuse when the reviewer's CURRENT token is
  expired, or is re-minting exactly the point? Plan assumes re-mint (owner
  accepted the window extension).
- Is there a reason to keep the review-due manual permissive about revocation
  that this plan has missed?
- Is a single `removed` reason right, or should unselected and revoked be
  distinguished so staff-cutoff reads differently from removal?
