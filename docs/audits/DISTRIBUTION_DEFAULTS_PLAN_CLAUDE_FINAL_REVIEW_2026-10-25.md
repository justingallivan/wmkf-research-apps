---
title: Final Claude review of distribution-defaults plan
domain: workbench
kind: audit
status: active
summary: "Read-only OAuth final review of 7baa3ad99: READY TO IMPLEMENT; N1–N4 resolved, no blockers, non-blocking clarifications and execution limits retained."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md
---

# Final independent plan-review receipt — 2026-10-25

[VERIFIED via ordinary host Claude CLI using Claude.ai OAuth.]
The final review below is preserved verbatim and names the exact reviewed commit
and document fingerprint. Root verified those values before recording it. No
code, live probes, other checkout access or database operations were performed.
No metered review product was invoked. Recording this receipt and the recommended
non-blocking clarifications does not authorize implementation or release.

# Final recheck: distribution-defaults plan, N1–N4

**Target:** HEAD `7baa3ad99004673f93caca9ad99da4b64395f12e`. The plan file `docs/plans/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md` has SHA256 `22002ac5628caaf69554c61bbbb9f2586562edf6ab2c3439172f1d13c5735de1` [VERIFIED via `git rev-parse` and `shasum`]. The worktree was clean.

**Scope:** I read the preceding rereview (`85ad11acf`) and `git diff 85ad11acf..HEAD`, and traced the source behind each amendment.

## Verdict: **READY TO IMPLEMENT**

No amendment introduced a blocker, and N1–N4 are each resolved in substance. The six findings below are non-blocking. Findings 1 and 5 are one-sentence plan edits that would change a test expectation, so I recommend making them before the first test commit. They are not gates.

## N1–N4 resolution matrix

| # | Asked for | Plan text at HEAD | Source check | Status |
|---|---|---|---|---|
| N1 | Option (a) from source. Every issued call must return a complete, valid server response. A permanent latch on network failure, abort, malformed, inProgress or unconfirmed. Then a fresh exact history row with explicit null ID and send intent and false `transportAccepted`. Missing fields or a failed read block the proof. No error-code allowlist. | §3.7 "No-activity proof" says all of this. The latch is permanent per envelope. Absent row or fields, a failed history read or a pending call all keep the envelope. The release clears envelope, preview and confirmation, keeps wording and recipients, and offers an explicit new preview only. The §7 table now extends the stale-refusal fixture with the proof read instead of claiming it stays green unchanged. | The ordering holds [VERIFIED]. `send.js:163` is the only transport call (`rg sendEmail(`). It runs only after `recordSendRequested` (`:146`). That store update requires `dynamics_email_id IS NOT NULL` (`distribution-store.js:355`) and stamps `send_requested_at` with `COALESCE` (`:352`). Nothing ever resets `send_requested_at` (`rg`). The reconcile branch (`:65`) also needs `send_requested_at`. So a null `sendRequestedAt` on a call that has settled means no transport happened. A complete response means the server handler has finished; `recordFailure` is awaited before the rethrow (`:183`). Earlier uncertainty is covered by the permanent latch. | **Resolved** |
| N2 | Board guard as the pattern, used by a hook local to this panel family. An `onRetentionChange` signal. No promise to get the previous `beforePopState`. Reset to allow-all on cleanup. A scoped catch for the cancelled rejection in `selectTab`. A required four-case Playwright gate. | §4D names `useBoardUnsavedChanges.js` as the pattern and a hook local to the family, mounted inside the retained panel. It specifies `onRetentionChange({draftDirty, editorDirty, mutationPending, recoveryPending})`, the `beforePopState(() => true)` reset with an explicit "no public getter", and a catch in `selectTab` for the cancelled rejection only. It requires the four-case Playwright spec against the real router with fixture data, and states that Jest alone is not browser proof. §5 moves `[requestId].js` to the catch-only change. | The precedent matches the plan's description (`useBoardUnsavedChanges.js:25-51`): emit `routeChangeError` then throw cancelled, approval scoped to the destination and cleared on complete/error, `pushState` restore on cancelled Back. `selectTab` (`[requestId].js:165-171`) has no catch today. | **Resolved** |
| N3 | Take `status` out of the mount key. Gate on initial auth. Transient loading hides and pauses the same retained sender. A real identity or email change invalidates. | §4D: the scope is request + confirmed system-user ID + normalized email, with "Do not key by transient auth status". Nothing personal mounts before authentication. `loading` pauses and hides without a remount. A real replacement or unauthenticated status clears memory before anything renders for the new actor. The §7 lifecycle row adds the matching test. | It is consistent with the actor/session row of the close-path table. Today's key is the artifact key at `StaffDeliberationsTab.js:1830`. The `session=` prop there is the deliberation session, not auth. | **Resolved** |
| N4 | Separate lanes for history, init, preferences, prepare, send and reissue. Operation + actor + call token gate the send response and `finally`, not the source or history generation. | §4B lists all six lanes. A source change cannot abort the send, drop its response or leave its busy flag stuck. A late acceptance resolves its original envelope but cannot rebase the current compose or sent flag. Prepare and reissue keep their own generation checks. A test for a source change during send is named. | It targets the shared `sequence`/`controllerRef` in the current send (`PreSiteDistributionPanel.js:624-628`) and the gated `finally` at `:699-704`. | **Resolved** |

## Findings (all non-blocking)

**1. N1 has a residual by design: a refusal after the email activity is created stays in the reconcile view. Recommend naming it in the test row.**
- **Evidence:** `assertAttemptSourceCurrent` runs twice:
  - at `send.js:75`, before the email activity is created;
  - at `:136`, after it is created but before send intent is recorded.

  The `brief_regeneration_in_progress` error comes from the same function, via `resolveSource` (`artifact-service.js:519-527`). A stale or regeneration refusal at `:136` leaves `dynamicsEmailId` set and `sendRequestedAt` null. That fails the proof, so the envelope stays in the reconcile view.
- **Escape path:** a warned departure, then a fresh mount. History then shows the existing "unconfirmed" label (`PreSiteDistributionPanel.js:180-200`), and a new preview is allowed. This follows the strict null-ID rule you selected.
- **Minimal change:** one sentence in the §7 Frozen-recovery row. The recoverable fixtures use the refusal before creation (`:75`), with a null ID. A refusal after creation, with the ID set and null intent, is a retained-envelope case.

**2. The fixture extension is mandatory.**
- **Evidence:** `preparedAttempt` in `pre-site-distribution-panel.test.js` sets `state` and `transportAccepted` but has no `dynamicsEmailId` or `sendRequestedAt` keys. Under the "all three fields explicitly present" rule, the `:595-625` scenario would keep the envelope and fail unless the proof-read mock supplies explicit nulls.
- **Production is safe under this strict rule:** `SELECT *` returns null columns, and `projectDistributionAttempt` (`model.js:198-209`) passes them through as present keys.
- The plan's "extend fixture" covers this. Implementers should know the fixture needs explicit null keys.

**3. "Structurally valid" has to be checked in the panel.**
- **Evidence:** `requestEnvelope` (`shared/utils/api-request.js:207-214`) only surfaces `parseError` on non-OK responses. With `tolerantBody`, a 2xx response can come back with null or partial `data`.
- **Minimal change (implementation note):** count a call as complete only after an explicit shape check: an object `attempt` on 2xx, a string `code` on non-2xx. Do not rely on `tolerantBody`.

**4. The "No-activity" label overclaims; it should say "no transport".**
- **Evidence:** in `send.js:92-110`, if the create succeeds but both persistence and correlation recovery fail, a Dynamics draft is left behind with a null ledger ID.
- The plan body already says "evidence of no transport", which is accurate. Only the heading overclaims.
- Today's panel already allows a new preview after a stale refusal, so orphan drafts are not new.

**5. The release conflicts with how the panel handles a regeneration refusal today. Pick one.**
- **Evidence:** the current panel deliberately keeps the still-valid preview on `brief_regeneration_in_progress` (`PreSiteDistributionPanel.js:653-667`). The §3.7 proof release clears the preview and confirmation.
- No user work is lost either way: compose text is kept, and prepare also refuses during regeneration.
- **Minimal change:** state that this departure is intentional, or limit the release to the envelope only when the refusal code is regeneration.

**6. Correction to the prior rereview.** Its claim "[VERIFIED] no other `beforePopState` user outside tests" is wrong:
- `AssessmentWorkflow.js:624` and `useAdminUnsavedChangesGuard.js:45` also call it.
- Neither is imported by `/workbench/[requestId]` (checked against its imports).
- The plan's "check for competing registrants" already covers this. No plan change is needed.

## Limits
- I only read source and tests. I ran no tests and no live probes, and did not use credentials or other checkouts. The other Claude's database work was not touched.
- The planned tests and the Playwright gate are planned, not proof.
- `listDistributionAttempts` returns at most 25 rows (`distribution-store.js:63-69`). On a request with more than 25 attempts, the target row can fall off the list. The proof then fails because the row is missing, which keeps the envelope (the safe direction).
- Real-browser behavior of the navigation guard is not proven here.
- This recheck does not authorize coding, runtime, schema, transport or DTO changes.

