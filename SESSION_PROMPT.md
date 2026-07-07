# Session 342 Prompt: Merge the S341 branch backlog; resume reviewer-invite send-side validation

## Session 341 Summary

Planned as reviewer-invite UI/test-email validation. That happened partially (read-only dry
run), but the session became a **multi-agent review + hardening sprint** whose headline outcome
was a **live security fix shipped to prod**. Ran a large background fleet (Codex reviews of the
three S340 branches + Fable TS Phase 0/1) and, from a Codex finding, traced and closed a real
injection/IDOR surface on `main`.

### What Was Completed

1. **SHIPPED TO PROD — requestId trust-boundary fix (3 commits, merged + deployed).** A Codex
   review of the Fable TS Phase-0 branch surfaced that `pages/api/phase-i-dynamics/summarize-v2.js`
   passed `req.body.requestGuid` with only a truthy check → `executePrompt` → `grantRequestAdapter.getById/updateById`
   → `DynamicsService.getRecord/updateRecord` raw `akoya_requests(${id})` key predicate (an
   authenticated over-fetch/IDOR/OData-injection surface). Fan-out audited all 6 `executePrompt`
   callers — only `summarize-v2` was vulnerable (`synthesize-reviews` already guards; three services
   pass no requestId). Fix has three layers: route-edge `isGuid`; a chokepoint `isGuid` in
   `executePrompt`; and `check-trust-boundary-guid` now models `executePrompt({ requestId })` as an
   object-arg sink (resolving import + value aliases, prebuilt-args objects, spread/computed keys).
   Two Codex re-reviews (found + fixed a gate false-positive on guarded spread-override). Full suite
   **5133/5133** + build green. Deploy **Ready** on prod (verified via `vercel inspect`; branded
   domains aliased). Commits `8a68dc39`, `a7d82dee`, `26402548`.
2. **Reviewer-invite read-only dry run (browser, capture mode).** Validated in the live workbench
   on Request #1002794: abstract-edit gate flagging ("hard line breaks"), abstract reflow (clean
   prose), greeting/secure-link/timeline-token render. GIF exported. **Lesson captured:** capture
   mode blocks email only — the preview still mints+stores a Dataverse token; send still stamps the
   lifecycle. See `reviewer-invite-capture-mode-not-full-sandbox.md`. (Left one orphan preview token
   on a real suggestion to self-heal — do not chase.)
3. **app-access-cache-fail-open — Codex found 2 real findings, fixed + verified + committed** (on the
   branch, unmerged). HIGH: `dataverse-identity-map.js` cached a partial map on a non-2xx systemusers
   lookup (cache poisoning still reachable); MEDIUM: `requireAppAccess` 503'd on grant lookup before
   the superuser bypass (superuser lockout). Both fixed per Codex's recs; 44 tests green. Commits
   `418841e6`, `c852e2c5`.
4. **Fable TS Phase 0 + Phase 1 built** (owner decided YES on the TS direction this session, previously
   an open decision). Phase 0 = branded `Guid` gate over the selector core; Phase 1 = branded
   `ActorRef` (brands `dynamicsSystemuserId`, minted only in `lib/utils/actor-ref.js`; auth.js pure
   re-export) + `#15` enum exhaustiveness. Verified by me and Codex. Both blocked on **call-site
   coverage** (the gate checks the sink signature, not the routes that call it — the same class the
   security fix above demonstrated end-to-end). Branch `worktree-agent-a837ad34b596771a7`, commits
   `4b36bb7d`, `e6b37f66`, `bd014d81`, `d6e6cb4e`.

### Commits (merged to main this session)
- `26402548` trust-boundary gate: fix spread false-positive + value-alias FN (2nd Codex round)
- `a7d82dee` harden trust-boundary gate: resolve executePrompt aliases + prebuilt-args (Codex finding)
- `8a68dc39` fix(security): GUID-validate client requestId before the Dataverse selector via executePrompt

## Next Items

### Verified Open

1. **Merge the four pending branches (owner's batch item; each is a prod deploy — sequence them).**
   Evidence: `git branch` shows all four; each verified this session.
   - `refactor/dynamics-checkpoint-b` (`daac9761`) — ✅ Codex-clean (behavior-freeze verified). Land the
     plan-doc status update at merge (was blocked in-worktree).
   - `fix/prompt-cache-remediation` (`35b089f4`) — ✅ Codex-approved (A7 nonce safe). **Run
     `tests/unit/utils/ai-payload-boundary.test.js` in a writable env first** (Codex sandbox couldn't).
   - `fix/app-access-cache-fail-open` (`c852e2c5`) — fixed + verified this session; ready.
   - `worktree-agent-a837ad34b596771a7` (Fable TS, `d6e6cb4e`) — see item 2 before merge.
2. **Fable TS follow-ups before/at merge.** Evidence: Fable report + Codex Phase-0/1 reviews.
   (a) Fold `tsconfig.check-phase1.json` into `tsconfig.check.json` + add a `check:types` (or
   `:phase1`) npm script + CI line, delete the phase-1 config — the Phase-1 gate is NOT wired into
   CI yet (Fable left it separate to avoid touching frozen Phase-0 files). (b) Extend branded-type
   coverage to the call-site routes (add `@ts-check` to the routes that call the branded selectors/
   `setTriageStatus`), which is what turns the gate from sink-only into real end-to-end enforcement.
3. **Resume reviewer-invite send-side validation (the original S341 primary — only the read-only half
   is done).** Evidence: S341 dry run covered preview/flagging/reflow only. Still unexercised:
   capture-send + the "possibly sent — verify" retry state, and the abstract-edit save + 409
   compare-and-set. Requires a **throwaway reviewer suggestion + proposal** (capture is NOT a full
   sandbox — see the memory), or accept lifecycle writes on a test record.

### Owner Decision Needed

1. **Deploy sequencing / timing for the four branches during the first-external-send window.**
   Evidence: this session held them deliberately; the security fix was merged alone. Decide order and
   whether to batch or space the deploys.

### Parked

1. Spec-audit design-docs recovery (work computer). Evidence: `project-spec-audit-docs-recovery-parked.md`.
2. Product/UX owner asks: review-output formatting (`project-review-output-formatting.md`), campaign-settings
   UX revisit (`project-campaign-settings-ux-revisit.md`).
3. Project-wide prompt-cache-hit audit. Evidence: `project-cache-hit-rate-review.md`.

### Verify Before Acting

1. **Branded-type "no-ship" from Codex on Fable Phase 0/1 is a CALL-SITE-COVERAGE point, not a code
   defect.** Evidence: both Codex reviews CONFIRMED the code correct (auth re-export pure, mint from
   session, exhaustiveness real); the block is that routes calling the branded sinks aren't `@ts-check`'d,
   so tsc can't prove end-to-end. Extend coverage (item 2b); do NOT relitigate the design.

### Do Not Reopen Without New Decision

1. **TypeScript direction: DECIDED (yes) and built this session.** Evidence: Fable Phase 0/1 branch;
   `docs/TYPESCRIPT_OPTION_ASSESSMENT.md`. It's the scoped `checkJs` + JSDoc-branded-types gate on `.js`
   files — NOT `.ts` renames (would fail-open five gates). Don't re-open the checker-vs-rename question.
2. **ActorRef brands `dynamicsSystemuserId`, minted only in `lib/utils/actor-ref.js`.** Evidence:
   `e6b37f66` doc-comment (owner-vetoable). Extend, don't relitigate, unless vetoing the design.
3. **The S341 dry-run orphan token** on a real suggestion is left to self-heal. Evidence: memory
   `reviewer-invite-capture-mode-not-full-sandbox`. Do not "clean it up."

## Key Files Reference

| File | Purpose |
|------|---------|
| `pages/api/phase-i-dynamics/summarize-v2.js` | Route-edge `isGuid` guard (shipped); Batch Phase I Summaries staff tool |
| `lib/services/execute-prompt.js` | `requestId` GUID chokepoint (shipped) — every prompt-executor caller funnels through it |
| `scripts/check-trust-boundary-guid.js` | Gate now models `executePrompt({ requestId })` object-arg sink; residual limits documented |
| `lib/utils/actor-ref.js` | Fable Phase-1 branded `ActorRef` mint (branch only) |
| `tsconfig.check-phase1.json` | Fable Phase-1 checkJs config — NOT wired into CI yet (fold into main config) |
| `docs/TYPESCRIPT_OPTION_ASSESSMENT.md` | The TS decision + phasing (Phase 0/1 built, Phase 2 = future) |

## Testing

```bash
npm test                                                  # full suite (5133 green as of S341)
npm run build
npm run check:trust-boundary-guid && npm run check:trust-boundary-guid:self-test   # 28 cases
# Reviewer-invite local walkthrough (send-side still to do; use a THROWAWAY record):
#   REVIEWER_EMAIL_DELIVERY_MODE=capture npm run dev   # capture blocks email, NOT Dataverse writes
```
