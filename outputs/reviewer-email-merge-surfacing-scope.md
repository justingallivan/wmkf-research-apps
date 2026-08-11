# Scope: surface `reviewer_email_reconcile_needs_merge` where the decision-maker is

**Status:** proposal, nothing built. Written S414 (2026-08-11) for adversarial review.
**Reviewer: challenge the approach, not the prose.** Every claim below carries
`file:line`. Verify them — several were wrong on first pass this session.

---

## 1. The problem (owner's framing)

The nightly `reviewer-email-reconciler` cron raises a
`reviewer_email_reconcile_needs_merge` alert when it cannot auto-recover a vetted
reviewer email. The owner's objection:

> "It goes to the sysadmin rather than the person using the application who has
> that record open in front of them. The sysadmin can make a change, but it's the
> user that can make the call of which address wins."

### Verified facts about the current routing

| Claim | Evidence |
|---|---|
| Alert severity is `warning`, `emailAdmins` not set | `lib/services/reviewer-email-reconciler.js` `alertNeedsMerge` |
| `notify()` emails only on `emailAdmins \|\| error \|\| critical` | `lib/services/notification-service.js:74-75` |
| ⇒ **NO email is sent to anyone.** It is a row in `/admin` only | derived from the two above |
| Admin panel default view is `status IN ('active','acknowledged')` | `lib/services/alert-service.js:134` |
| The staff user already sees a generic amber box on that exact row: *"Contact withheld / identity review required… add the exact address"* | `shared/components/reviewers/ReviewerInvitePanel.js:476-480` |

So the system knows the email **and** the reason it is blocked, shows the staffer
only "add an email", and files the actual finding somewhere the staffer never looks.

---

## 2. The finding that shapes this proposal

**The decision UI already exists.** `shared/components/reviewers/CandidateEditModal.js`
implements a complete merge mode: plan preview, per-field picker, Swap-which-record-wins,
block-reason display, confirm.

| Claim | Evidence |
|---|---|
| Merge service has plan + execute | `lib/services/reviewer-merge.js:206` `planMerge`, `:325` `executeMerge` |
| `email` is a user-choosable field | `lib/services/reviewer-merge.js:26` `MERGE_PICKER_FIELDS` |
| API route exists | `pages/api/reviewer-finder/merge-candidates.js:43,46` |
| Route auth = the same access the tab already requires | `pages/api/reviewer-finder/merge-candidates.js:23` `requireAppAccess(req, res, 'reviewer-finder', 'reviewers')` |
| UI already calls it | `shared/components/reviewers/CandidateEditModal.js:297,404` |
| **Our case is a `collision`, NOT a block** — both records holding a suggestion on the same request | `lib/services/reviewer-merge.js:258-277`; `executeMerge` deletes the colliding loser row, transplanting applicant provenance first |
| Merge blocks only on: loser promoted to CRM contact, loser engaged, loser has `confirmed` identity while keeper does not | `lib/services/reviewer-merge.js:226-247` |
| Merge mode is entered **only** from a duplicate-email PATCH 409 | `shared/components/reviewers/CandidateEditModal.js:270-277` |
| `enterMergeMode` needs only `{conflictingRecordId, value}`; `partialSuccess`/`savedFields` default, `token` is optional | `shared/components/reviewers/CandidateEditModal.js:335-351` |

**Therefore the gap is discovery and trigger, not capability.** Merge is reachable
only if a staffer happens to type the duplicate address into Edit and trips a 409.

### Interaction with the S414 retraction (shipped this session)

The reconciler now auto-resolves its own alert when a row reaches a non-alert
outcome (`lib/services/reviewer-email-reconciler.js` `retractNeedsMerge`, 5 call
sites). Either merge outcome therefore clears the alert on the next nightly run:

- keep the email-owner ⇒ loser suggestion deleted ⇒ `suggestion_gone` ⇒ retract
- Swap, keep the empty record ⇒ email lands on it ⇒ `email_present` ⇒ retract

---

## 3. Proposed change

| # | Change | File | Est. |
|---|---|---|---|
| 1 | Read-only route: active needs-merge alerts for a request, keyed by `suggestionId` | `pages/api/reviewer-finder/reconcile-alerts.js` (new) | ~40 ln |
| 2 | Panel fetches and joins onto candidate rows | `ReviewerInvitePanel.js` | ~15 ln |
| 3 | On flagged rows replace the generic amber box with the specific conflict + "Resolve duplicate" | `ReviewerInvitePanel.js:476-480` | ~20 ln |
| 4 | `initialMerge` prop so the modal opens straight into merge mode | `CandidateEditModal.js` | ~10 ln |

Copy for a flagged row: we found `<email>`; it belongs to another record for this
person who is also on this request; **Resolve duplicate**.

### Alternatives considered and rejected

- **Join alerts inside `my-candidates-service`.** Rejected: that service reads
  Dataverse (`lib/services/reviewer-finder/my-candidates-service.js:142`) while
  alerts are Postgres. It loads every candidate list; a cross-store read there
  puts an alert-table outage on the hot path. A separate fetch degrades to
  exactly today's behavior on failure.
- **Email the alert to the PD.** Rejected: once the work appears where the work
  happens, email re-creates the routing problem the owner objected to.
- **Change the reconciler's decision ladder.** Rejected: it is correct. Only its
  output was misrouted.
- **Remove the admin alert.** Rejected: it remains the backstop for requests
  nobody opens.

---

## 4. Open questions (owner has NOT answered these)

1. **Show the button when `planMerge` is blocked?** Proposal: show it with the
   block reason inline rather than hiding it, so the staffer learns why. Costs a
   plan fetch per flagged row unless lazy-loaded on click. Leaning lazy-load.
2. **`ambiguous_owner` (>1 owner) has no two-record merge to offer.** Proposal:
   explanation without a button. Currently zero active alerts of this kind.
3. **Resolve the alert on merge success, or let the nightly cron retract it?**
   Leaning immediate + cron as backstop.

---

## 5. Known weaknesses in this proposal — attack these

- **Keeper/loser orientation is inverted between the two subsystems.** The
  reconciler calls the email-owner the "keeper"; the modal uses the open row as
  keeper and the conflicting record as loser
  (`CandidateEditModal.js:338-339`). Swap exists, but the *default* orientation
  presented to the staffer may be the wrong one, and the copy could mislead.
- **`executeMerge` deletes a suggestion row.** That is destructive and reached
  from a button this proposal makes materially easier to press. Is the existing
  confirm step sufficient at this new, lower friction? Nothing here adds a guard.
- **Not verified:** that `planMerge` is unblocked for the *actual* live alert
  (383). A local prod read requires `DATAVERSE_ALLOW_PROD_READS=yes`; the probe
  run this session reported alert 383 `ALREADY_RESOLVED` (suggestion deselected),
  so there is currently **no live instance to build against** — the feature would
  ship against a case with zero live examples.
- **Alert freshness.** The panel would render an alert raised up to a night ago.
  A stale alert whose condition cleared would show a "Resolve duplicate" button
  for a non-problem until the cron retracts it. No live re-validation is proposed.
- **Sizing may be optimistic.** Estimated ~85 lines across 4 files plus tests, but
  the panel-to-modal wiring and the block/lazy-load path are the parts most likely
  to grow.
- **Zero live instances also means zero natural test data** for a manual smoke.

---

## 6. What is NOT being claimed

- No claim that the underlying duplicate `wmkf_potentialreviewers` records for
  alert 383 were merged — the probe cleared the *reconciler's* work item only.
- No estimate of how often this alert fires: 1 active at time of writing, and the
  historical rate was not measured.
