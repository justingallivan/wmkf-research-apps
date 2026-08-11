# Codex Work Order: route the reviewer email needs-merge alert to the person who can decide

**Written:** 2026-08-11 (S414), by Claude, for a fresh Codex session.
**Codex has the lead.** This is not a plan to implement. The previous plan was
reviewed and killed; you own the redesign, including rejecting the framing below.

**Read first:** `outputs/reviewer-email-merge-surfacing-scope.md` (the killed
proposal, now annotated NO-SHIP) and the verbatim review in §5.

---

## 1. The owner's problem — this is the actual objective

The nightly `reviewer-email-reconciler` cron raises a
`reviewer_email_reconcile_needs_merge` alert when it cannot auto-recover a
vetted reviewer email. The owner's words:

> "It goes to the sysadmin rather than the person using the application who has
> that record open in front of them. The sysadmin can make a change, but it's
> the user that can make the call of which address wins. It just seems like a
> very inefficient process."

That objective is **unchanged and still open.** The review killed one solution,
not the problem.

Two facts sharpen it:

- **No email is sent to anyone.** Severity is `warning` with no `emailAdmins`,
  and `notify()` emails only on `emailAdmins || error || critical`
  `[VERIFIED via lib/services/notification-service.js:74-75]`. The alert is a
  row in `/admin` that someone must happen to browse.
- **The staffer already sees a generic amber box on that exact row** — "Contact
  withheld / identity review required… add the exact address"
  `[VERIFIED via shared/components/reviewers/ReviewerInvitePanel.js:476-480]`.
  So the system knows the address and the blocker, and tells the person who
  could act only "add an email."

---

## 2. Already shipped this session — do NOT redo

| Commit | What |
|---|---|
| `c0562ded` | `scripts/probe-reviewer-email-reconcile-alert.mjs` — read-only probe replaying the reconciler ladder against live Dataverse; returns STILL_BLOCKED / SELF_HEALING / ALREADY_RESOLVED / NOT_RECONCILABLE. Needs `DATAVERSE_ALLOW_PROD_READS=yes` per invocation. |
| `80b85408` | The reconciler now **retracts its own alerts** when a row reaches a non-alert outcome (email landed, suggestion gone, deselected, write, repoint). Deliberately does NOT retract on ambiguous skips or a stale-roster request mismatch. 12 tests; 4 mutations verified to fail. |

**Consequence:** the backlog problem is largely solved. Alert 383 — the only
active one — probed `ALREADY_RESOLVED` (its suggestion had been deselected, so
the cron had skipped it nightly since 2026-07-30). **There are currently zero
live instances of this alert.** Weigh that when deciding whether to build at all.

---

## 3. The reconciler's three alert kinds (this matters — the killed plan got it wrong)

`lib/services/reviewer-email-reconciler.js` ladder, per candidate:

- owner of the vetted email is **none** → WRITE the email onto the person
- **one ACTIVE** owner → REPOINT the suggestion to that owner ("keeper"),
  **unless** the keeper already has a suggestion on this request — the
  `(person,request)` alt key would 412 → **ALERT `keeper_has_suggestion`**
  (metadata carries `detail.keeperId`)
- **ambiguous** (>1 active owner) → **ALERT `ambiguous_owner`** — no pair, no
  `detail`
- **inactive** single owner → **ALERT `inactive_owner`** — **no `detail`, so no
  `keeperId` at all**

Only `keeper_has_suggestion` identifies two specific records. Any design must
treat the three kinds separately and fail closed on the other two.

---

## 4. The proposal that was killed (summary — full text in the scope doc)

Surface the alert on the Invite Reviewers row and add a "Resolve duplicate"
button that opened the **existing** merge UI (`CandidateEditModal` merge mode)
pre-loaded with the alert's `keeperId`/`loserId`, via a new `initialMerge` prop
and a new read-only route serving active alerts per request.

Rationale at the time: the merge service, route, UI and auth all already exist
(`lib/services/reviewer-merge.js` `planMerge`/`executeMerge`,
`pages/api/reviewer-finder/merge-candidates.js`, `CandidateEditModal.js`), so
"the only gap is discovery and trigger."

---

## 5. Codex adversarial review — VERBATIM

> Target: branch diff against 80b85408
> Verdict: needs-attention
>
> No-ship. The proposal bypasses the live duplicate proof that currently protects a globally destructive merge, overstates which alerts are mergeable, and leaves orientation, authorization, partial-failure recovery, and verification unresolved.
>
> Findings:
> - [high] Alert-driven entry bypasses the only live proof that the records still conflict (outputs/reviewer-email-merge-surfacing-scope.md:70-76)
>   The existing UI receives `conflictingRecordId` only after a fresh duplicate-email PATCH resolves exactly one active owner; none, ambiguous, inactive, or failed lookups suppress merge mode (`my-candidates-service.js:818-845`). The proposed `initialMerge` instead starts from a potentially day-old Postgres alert. `merge-candidates.js:31-46` accepts any two GUIDs, while `planMerge` validates identity, existence, and loser safety but never verifies that the alert's suggestion still belongs to the request, the target email is still owned by the other record, or the records are still duplicates (`reviewer-merge.js:211-248`). Execution can then delete suggestions and deactivate a person. Thus the documented stale state can cause a wrong-record merge, not merely an obsolete button.
>   Recommendation: Replay the reconciler ladder server-side on both plan and confirm. Bind requestId, suggestionId, current personId, target email, current unique active owner, alert kind, and ETags into a short-lived server-issued merge intent; reject execution when any binding changes.
> - [high] "Collision, not a block" is false and applies to only one alert subtype (outputs/reviewer-email-merge-surfacing-scope.md:47-53)
>   The service computes `blocked` independently from `collisions`: same-request rows enter the collision bucket (`reviewer-merge.js:258-277`), but the chosen loser can simultaneously be blocked for contact promotion, engagement on any request, or protected identity (`:225-248`). Moreover, only `keeper_has_suggestion` proves two same-request rows. `ambiguous_owner` has no pair, while `inactive_owner` lacks `detail.keeperId` entirely and the current duplicate-PATCH path deliberately suppresses inactive owners. Therefore discovery is not the only missing capability for two of the three alert kinds, and even the third is not proven executable.
>   Recommendation: Define a fail-closed action matrix by alert kind. Offer merge only for a live-revalidated `keeper_has_suggestion`; give `ambiguous_owner` and `inactive_owner` separate manual-resolution workflows. Treat collision and blocked status as orthogonal and test both orientations.
> - [high] The default orientation selects the opposite global record for destruction (outputs/reviewer-email-merge-surfacing-scope.md:108-115)
>   `enterMergeMode` hardcodes the open row as keeper and the email owner as loser (`CandidateEditModal.js:333-350`). Its default email choice then moves the owner's address to the open row. For a same-request collision, execution deletes the owner's suggestion, clears its email, and deactivates that owner (`reviewer-merge.js:401-500`). The original rationale—preserve the record the staffer just curated after an explicit edit—does not apply to an alert-driven launch where the staffer merely opened the Invite tab. Swap and labels do not make a systematically inverted destructive default safe.
>   Recommendation: For `keeper_has_suggestion`, default to the reconciler's current active email owner as keeper and the email-empty candidate as loser. Require an explicit, separately confirmed override before reversing that orientation, showing exactly which suggestions, slots, and person record will be deleted or deactivated.
> - [high] Existing app auth is not request- or merge-pair authorization (outputs/reviewer-email-merge-surfacing-scope.md:44-46)
>   The cited guard proves only app-level access. `requireAppAccess` does not enforce the Workbench's request-specific `canManage` decision, a write-capable role, or membership of either GUID in the displayed request; `merge-candidates` does not even receive requestId. The UI's `canManage` gate is documented as cosmetic and fail-open (`reviewer-modes.js:86-96`). Surfacing alert metadata and a direct destructive action under this guard lets any reviewer-finder app user invoke a global merge for arbitrary known GUIDs, including records outside the request they are viewing.
>   Recommendation: Authorize the new read route against the requested Workbench record and enforce equivalent server-side write authorization on confirm. Require the server-issued merge intent to bind the authorized request and suggestion to both person IDs; never accept a client-selected pair alone.
> - [medium] The easier trigger exposes a non-atomic hard-delete flow without a recovery contract (outputs/reviewer-email-merge-surfacing-scope.md:113-127)
>   `executeMerge` writes keeper fields, hard-deletes colliding suggestions, then updates applicant slots, moves email, and finally deactivates the loser (`reviewer-merge.js:363-500`). Failures after deletion leave partially applied state; there is no transaction or compensation in this service, and the modal's specialized recovery covers only the email-transfer tear. With zero live alerts available, the proposal also names no synthetic end-to-end test for stale alerts or failures after deletion. A successful plan preview is therefore not evidence that confirm completes or can be rolled back.
>   Recommendation: Before broadening discovery, add a durable merge audit/snapshot and resumable or compensating recovery for each post-delete failure point, plus explicit destructive confirmation. Build synthetic contract tests for stale/changed owners, all alert kinds, both orientations, concurrent changes, and failures after collision deletion; require a non-production integration smoke.
>
> Next steps:
> - Replace the current open questions with decisions on live semantic binding, actionable alert kinds/orientation, server-side authorization, and partial-failure recovery.
> - Revise the scope and acceptance tests before implementing the alert route or direct modal entry.

### Independent verification of the review (by Claude, post-review)

Every load-bearing claim was checked against source and **confirmed**:

| Claim | Evidence |
|---|---|
| Existing entry attaches `conflictingRecordId` only for a single ACTIVE owner, fail-closed otherwise | `lib/services/reviewer-finder/my-candidates-service.js:833-838` |
| `executeMerge` deletes colliding suggestions then deactivates the loser person, no transaction | `lib/services/reviewer-merge.js:428-437`, `:499-500` |
| `executeMerge` refuses a non-active loser | `lib/services/reviewer-merge.js:339` |
| `inactive_owner` / `ambiguous_owner` carry no `detail`, hence no `keeperId` | `lib/services/reviewer-email-reconciler.js` ambiguous/inactive alert branch |
| `computeCanManage` is cosmetic and fails open | `shared/components/reviewers/reviewer-modes.js:86-96` — the docblock says so |
| `merge-candidates` receives no `requestId` | `pages/api/reviewer-finder/merge-candidates.js:22-36` |

**One correction to the review's framing.** Its authorization finding reads as
though surfacing *creates* the exposure. It does not — see §6.

---

## 6. SPUN OUT — a live pre-existing issue, independent of this work

`pages/api/reviewer-finder/merge-candidates.js` accepts only
`{keeperId, loserId}` — **never a `requestId`** — behind app-level
`requireAppAccess(req, res, 'reviewer-finder', 'reviewers')`. Ids are
GUID-validated but membership is never checked. The UI gate `computeCanManage`
is documented "Cosmetic only — the reused server APIs stay org-open — so it
FAILS OPEN."

So **today**, any user with reviewer-finder app access can POST two arbitrary
GUIDs and execute a global merge — deleting suggestion rows and deactivating a
person — for records in requests they are not viewing.

This exists now and is not introduced by any proposal here. It may be an
intentional consequence of the S207 "org-open" decision, but that decision
should be re-examined against a *destructive* merge. **Owner decision needed.**
Check `docs/API_ROUTE_SECURITY_MATRIX.md` and the S207 rationale before
proposing changes. Not yet investigated.

---

## 7. What Codex should decide

You have the lead. Legitimate outcomes include "build nothing."

1. **Is any build justified with zero live instances?** The auto-resolve may
   have removed most of the pain. The honest default may be to wait for a
   recurrence rather than ship against a case with no test data and no smoke.
2. **If something is built, what shape?** The review's answer is a server-issued
   merge intent that replays the reconciler ladder and binds
   requestId/suggestionId/personId/email/owner/kind/ETags, rejecting execution
   when any binding changes.
3. **A cheaper option not yet evaluated:** surface the enrichment-known address
   on the row as *information only*, with no merge button, and let the staffer
   use the existing Edit control. The normal PATCH then runs and, on a 409, opens
   the existing merge mode **with fresh live proof**. This routes staff *into*
   the safe entry point instead of around it, and adds no destructive surface.
   It does **not** fix the inverted orientation or §6. Claude proposed this after
   the review; it has not been reviewed or verified — treat as unvetted.
4. **The orientation default**, if merge is ever launched from an alert.
5. **Whether §6 blocks any of this** — arguably it should.

---

## 8. How the previous pass went wrong — distrust these patterns

Recorded so they are not repeated, not as apology.

1. **Confident claims from partial reads.** "Route auth = the same access the tab
   already requires" was offered as evidence of *safety* without reading
   `computeCanManage` or noticing the missing `requestId`. It was evidence of a
   gap.
2. **Evidence gathered but not connected.** The probe run earlier in the same
   session proved alert 383 was stale — then the plan proposed feeding exactly
   such an alert into a destructive flow. The staleness finding and the design
   were never put side by side.
3. **A headline compressed past correctness.** "Collision, not a block" was
   derived from a real reading of `reviewer-merge.js:258-277` but stated as
   though it settled executability. `blocked` and `collisions` are orthogonal.
4. **Risks named, then not weighed.** The scope doc's §5 listed the destructive
   button and zero live instances, then recommended building anyway. Naming a
   risk is not weighing it.
5. **Polish questions instead of the upstream question.** Three open questions
   were asked about button placement and timing; none asked whether alert-driven
   entry was sound at all.

Same session, earlier, same pattern: both Dataverse enforcement flags were
described as "fail closed" when `DATAVERSE_DAL_ENFORCEMENT` fails **open** in
production; and `system_alerts` dates were quoted from a JS client that
re-reads naive UTC timestamps as local, shifting every value by +7h. Both were
caught and corrected, but both started as confident statements from a partial
read. **Verify this document's claims rather than inheriting them.**

---

## 9. Constraints

- **Tier 1+ runtime UI/route work** → branch and deliberate promotion, not
  straight to `main` (`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`).
  `main` auto-deploys to production.
- **Live prod Dataverse reads from local** need `DATAVERSE_ALLOW_PROD_READS=yes`
  per invocation (`lib/dataverse/core/interlock.js:326-330`). Do not persist it.
- **Cross-layer / durable-state work** → run `/contract-reconcile`.
- **Gates:** run every `check:*` for surfaces touched, each with its
  `:self-test`, sequentially. `docs/CI_GATES_REFERENCE.md`.
- **Relevant memory:** `feedback-list-and-confirm-before-bulk-deletes` (the
  reason retraction is deliberately conservative),
  `feedback-ui-gates-must-mirror-server-guards` (directly on point for §6),
  `docs/agent-wiki/topics/reviewer-identity.md` (alert semantics + probe usage).
