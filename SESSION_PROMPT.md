# Session 343 Prompt: Resume reviewer-invite send-side validation; continue Dynamics decomposition

## Session 342 Summary

Executed the S341 batch backlog: **merged all four pending branches to prod** (each verified,
deployed Ready, one-at-a-time), then the Fable-TS branch expanded — via three Codex adversarial
reviews — into a **real compile-time trust-boundary gate**. Closed the session by killing the
recurring Dependabot CI-failure email noise.

### What Was Completed

1. **Merged 4 branches → prod (all deploys Ready + smoke-verified).**
   - `fix/app-access-cache-fail-open` (`495004dc`) — fail-closed on app-grant/systemusers lookup errors.
   - `refactor/dynamics-checkpoint-b` (`7c577afb`) — extracted `dynamics/schema.js` + `read-ops.js`
     (behavior-freeze); Checkpoint B of the Dynamics decomposition. Plan-doc status landed (`289e4cdf`).
   - `fix/prompt-cache-remediation` (`4fa53c7e`) — opt-in stable untrusted-content nonce; ran the
     required `ai-payload-boundary.test.js` (20/20) in a writable env first.
   - `worktree-agent-a837` Fable TS (`b9a349d7`) — reconciled against the checkpoint-B refactor
     (relocated branded annotations to `read-ops.js`; `dynamics-service.js` conflict resolved by
     taking main's structure since Fable's change there was pure JSDoc).
2. **TypeScript branded-type gate (`check:types`) — Phase 0 + Phase 1, now enforcing END-TO-END.**
   Three Codex rounds drove it from a module-only island to a real control:
   - Facade coverage (`3f400471`): `DynamicsService.getRecord/updateRecord/deleteRecord` brand
     `recordId` as `Guid` through the PUBLIC API (12 `...args` wrappers restored to typed sigs).
   - Trust-boundary call-sites (`c27fbaca`): the TWO routes that pass a *client* id into a selector
     (`summarize-v2.js`→`executePrompt.requestId`, `cycle-material.js`→`findById`) are `@ts-check`'d;
     deleting either `isGuid` guard turns `check:types` RED (ratchet proven, not theater). Caught the
     **`any`-poisoning trap**: `req.body` is `any` and silently satisfies `Guid` — ids are narrowed
     from `unknown` so the guard is load-bearing.
   - BILL regression fix (`1f2860db`): the Fable `isGuid` dedup swapped an untrimmed exact check for
     the trimming canonical guard, silently accepting whitespace GUIDs; restored fail-fast with
     `isCanonicalGuid` + regression tests.
3. **Killed recurring Dependabot CI-failure emails** (`b13e0f6d`, `f835694e`). Root cause: bot PRs
   run with a read-only token + no secrets, so Gitleaks 403s on API write-back and `claude-review`
   gets an empty key. Fix: skip both jobs on `dependabot[bot]`; ignore all major version updates in
   `dependabot.yml` (majors broke Jest/Playwright for real). Closed the 6 stale major PRs (#28–33);
   #48 superseded by grouped **#53** — verified Gitleaks/claude-review now show `skipping`.

### Commits (all pushed to main)
- `f835694` ci(dependabot): ignore all major version updates
- `b13e0f6` ci: skip Gitleaks + Claude review on Dependabot PRs
- `c27fbac` feat(types): compile-time trust boundary on the 2 client-id→selector routes
- `1f2860d` fix(bill): reject whitespace GUIDs in onboarding validation
- `3f40047` feat(types): extend branded-Guid gate to the DynamicsService facade
- `b9a349d` Merge Fable TS Phase 0+1 (reconciled) · `4fa53c7e` prompt-cache · `7c577afb` checkpoint-B · `495004dc` app-access

## Next Items

### Verified Open

1. **Resume reviewer-invite send-side validation** (the original S341 primary — still only the
   read-only half is done). Evidence: `git log 495004dc..HEAD` shows NO commits touching the
   reviewer-invite send path this session; `reviewer-invite-capture-mode-not-full-sandbox.md`.
   Unexercised: capture-send + the "possibly sent — verify" retry state, and the abstract-edit save +
   409 compare-and-set. Requires a **throwaway reviewer suggestion + proposal** (capture mode is NOT
   a full sandbox — it blocks email only, still mints/stores Dataverse tokens + stamps lifecycle).
2. **Continue the Dynamics decomposition — Checkpoint C (`write-core.js`, Stage 6).** Evidence:
   `docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md` (A + B EXECUTED; C–F pending). C is the DAL
   entity-write core — DEDICATED review (4 `assertTrustedDalContext` sites, impersonation fallback,
   412/ETag contracts, `updateIfEmpty` read-modify-write). Highest-risk cluster is D (`changeset.js`).
3. **Merge Dependabot #53 once its real tests go green** (housekeeping). Evidence: `gh pr checks 53`
   — Gitleaks/claude-review skip; Jest/Playwright/Semgrep/Trivy run. Safe grouped minor/patch bundle.

### Owner Decision Needed

1. **How far to push the TS gate beyond the trust boundary.** Evidence: `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`
   implementation-status note. The actual untrusted surface (2 routes) is now compile-time closed.
   Extending `@ts-check` further (more adapters/routes) is optional monotonic ratcheting, not a
   trust-boundary need. Phase 2 (`.ts` migration) remains a separate future decision.

### Parked

1. Spec-audit design-docs recovery (work computer). Evidence: `project-spec-audit-docs-recovery-parked.md`.
2. Product/UX owner asks: review-output formatting (`project-review-output-formatting.md`),
   campaign-settings UX revisit (`project-campaign-settings-ux-revisit.md`).
3. Project-wide prompt-cache-hit audit. Evidence: `project-cache-hit-rate-review.md` (S339 flagged).

### Do Not Reopen Without New Decision

1. **TS direction: DECIDED (yes) + BUILT + shipped Phase 0/1.** Evidence: `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`.
   Scoped `checkJs` + JSDoc branded types on `.js` — NOT `.ts` renames (would fail-open five gates).
2. **Dependabot ignores all majors on purpose** (`f835694`). Evidence: `.github/dependabot.yml`.
   Majors are taken by hand; don't re-enable automated major PRs without deciding to adapt them.
3. **The facade `...args` wrappers were restored to typed signatures** (runtime-neutral). Evidence:
   `3f40047`; `DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md` Checkpoint F note. Don't "restore" `...args`.

### Verify Before Acting

1. **`check:types` is a partial ratchet, not whole-surface coverage.** Evidence: it covers the 8
   opted-in files + 2 trust-boundary routes; server-derived-id selector calls in other adapters/routes
   are intentionally out of scope (not a trust-boundary risk). Before claiming "the gate protects X",
   confirm X is in `tsconfig.check.json` `include` AND `@ts-check`'d. The runtime `check:trust-boundary-guid`
   remains the whole-route-surface control.

## Key Files Reference

| File | Purpose |
|------|---------|
| `tsconfig.check.json` | The `check:types` gate include list (guid/changeset/read-ops/facade + ActorRef path + 2 trust routes) |
| `lib/services/dynamics-service.js` | Facade — `@ts-check`'d; read wrappers typed, write selectors brand `recordId: Guid` |
| `lib/services/execute-prompt.js` | `executePrompt.requestId` branded `Guid` (compile) + isGuid runtime chokepoint |
| `lib/bill/onboard-reviewer-service.js` | `isCanonicalGuid` — rejects whitespace GUIDs at BILL onboarding validation |
| `docs/TYPESCRIPT_OPTION_ASSESSMENT.md` | TS decision + implementation status (Phase 0/1 shipped; the `any`-poisoning caveat) |
| `docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md` | Decomposition status (A+B done; C–F pending) |
| `.github/dependabot.yml` / `.github/workflows/{gitleaks,claude-code-review}.yml` | Dependabot noise fix |

## Testing

```bash
npm test                                                  # full suite (5146 green as of S342)
npm run build
npm run check:types && npm run check:trust-boundary-guid  # compile gate (0) + runtime gate
# Prove the ratchet: delete an isGuid guard in summarize-v2.js / cycle-material.js → check:types goes RED.
# Reviewer-invite send-side (still to do; use a THROWAWAY record):
#   REVIEWER_EMAIL_DELIVERY_MODE=capture npm run dev   # capture blocks email, NOT Dataverse writes
```
