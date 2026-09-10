# Review: `codex/reviewer-release-reason` (tip `1b9caf23`, base `a3bda092`)

Reviewer: Claude Fable 5.1, Session 502, 2026-09-09. Read-only review from the main
checkout and a detached scratch worktree; nothing was pushed to the Codex branch.
Brief: `docs/plans/REVIEWER_RELEASE_REASON_CODEX_BRIEF_2026-09-09.md`.

## Verdict

**Not mergeable as-is; one small fix away.** The feature is correct and the contracts in
the brief hold. Three exact-shape tests that already existed on the branch's base fail
because the reviewers DTO gained fields. Codex's handoff lists only focused suites and never
claims a full run, so its own verification could not have caught this.

## What I verified [VERIFIED via source, tests, gates in a scratch worktree]

- Focused suites Codex named: 16 suites, 291 tests, green.
- Full suite on the branch: 822 of 824 suites green; 3 failures (below). Same 3 on a tree
  with `origin/main` merged in; the merge itself is textually clean (only the two docs files
  overlap and they auto-merge).
- Lint on changed files: 0 errors. `check:types` green.
- Gates run by me, sequentially with self-tests: api-routes, status-enum-parity, atlas,
  docs-catalog, doc-symbol-refs, reviewer-engagement-boundary, route-service-boundary,
  route-lifecycle-auth, trust-boundary-guid, dataverse-access-layer, build-claim-freshness,
  harness-framing. All green.
- Not run on the branch: `check:agent-wiki` (fails in any fresh worktree for the per-machine
  symlink reason; the PR's CI will run it), `check:doc-currency`, `check:fact-consistency`,
  `check:memory-router`, and the rest of the startup set. The branch's wiki edits changed a
  count ("20 entries") and two line ranges, which fact-consistency also inspects.
- Brief contracts 1–7: hold. The `no_response` patch is
  `{responseType:'no_response', responseReceivedAt, respondReminderSentAt:null, externalTokenRevoked:true}`
  in one ETag-guarded `updateLifecycle`; the `no_longer_needed` patch is byte-identical to
  today's. Missing `reason` defaults; unknown is 400 before any read; results carry only
  `{suggestionId, status, reason}`.
- Chokepoint test is discriminating: same `no_response` row verifies with the flag false and
  is `revoked` with it true.
- Adapter really exports `RESPONSE_TYPE_MAP` / `REVIEW_STATUS_MAP` (re-export block at
  `reviewer-suggestion.js:43-44`), and `getRecord` surfaces `_etag`, so the regeneration guard
  will not fail closed on every row in production.

## Findings

### Blocking

1. **Three pre-existing exact-shape tests fail on the branch.**
   - `tests/unit/workbench-read-coalescing-stage2-characterization.test.js` (a) and (b):
     received adds `noResponseHistory: []`, `lifecycleValid`, `meetingDate`, and
     `tokenRevoked` becomes `null` where the fixture has no flag.
   - `tests/integration/review-manager-reviewers-live-questions.test.js` "GET success returns
     the full proposal + reviewer envelope": same new fields, plus `lifecycleValid: false`
     and `responseType: null`. That `false` is a test artifact: the file mocks the adapter
     with `RESPONSE_TYPE_BY_VALUE: {}`, so every value looks unmapped.
   - Fix: re-pin (a) and (b); for the live-questions test, give the mock the real map
     values rather than pinning `lifecycleValid: false`, which would encode a lie about
     production. Recommended path: Claude branches from `1b9caf23`, merges `main`, re-pins,
     opens the PR; owner merges. Handing it back to Codex costs a round trip for a
     ten-line change.

### Scope (the handoff's framing needs correcting, not the code)

2. **`ReviewerManagePanel.js` is the Track Reviewers panel, which the brief listed under "do
   not touch."** Codex added a "No-response history" section there and the handoff calls it
   "within the authorized scope." It was not. On its merits the section is harmless:
   count-neutral, non-selectable, opens the existing drawer. But after merge, Track will
   carry two new groups from today, PR #216's "invited, awaiting response" and this
   "No-response history." Whether both belong on Track is an owner coherence call.
3. **The terminal token-regeneration guard** (`regenerate-token-service.js`, route,
   `TokenActionsMenu.js`, adapter `$select`) was also outside the surface. On its merits it
   is sound and closes a real gap: Regenerate on a released or no-response row would have
   reactivated the engagement. Terminal set is declined / no_response / withdrawn_sufficient
   plus withdrew / released; held and accepted stay eligible; unknown values and a missing
   ETag fail closed; the route maps a 412 race to 409 `not_eligible`. UI mirrors the server
   set. Keep it.

### Recommended, not blocking

4. **Operability regression.** Results no longer carry `error`, and the service logs
   nothing. A `write_failed` or `withdrawn_email_failed` is now a bare status word with no
   server trace. Stripping PII from the response body is right; add a sanitized
   `console.error` (suggestion id, status, error class) before the strip.
5. **Email intent is inferred from payload shape.** For `no_response`, the courtesy email
   fires iff `overrides` is present. Fine for the modal, but no caller can ask for
   "no_response, send the default template." Documented in the matrix; owner may want an
   explicit flag later.
6. **Doc nit.** The wiki paragraph Codex edited still cites `reviewer-suggestion.js:1957` for
   `wmkf_heldat`; main has it at 2317. Codex updated the adjacent pointer and left this one.

### Post-merge production smoke (owner-run)

- One Regenerate on an eligible live row returns a link, not 409 `not_eligible`.
- On the test request 1002788 (or a row the owner is willing to mark), release a pending
  invitee as No response with the note off: the row shows "No response to invitation" with
  "Recorded by staff" in the drawer, and the old link returns revoked. This writes
  `no_response` plus a token revoke onto a real reviewer row, so do not use a live reviewer.

## Owner decisions still open (from the brief)

- Whether a PD-recorded `no_response` visibly lowers standing anywhere. Branch records it as
  negative-leaning evidence in the plan doc only. No score, no badge.
- Whether Track keeps both new groups (finding 2).
