# Session 356 Prompt: interlock warn-log observation, plus carryover

## Session 355 Summary

Full-lifecycle session on ONE objective: the fail-closed Dataverse
target/write interlock went from [PLANNED] (strategy §6) to designed, built,
four-times adversarially reviewed, merged, and LIVE in `warn` mode. Plus one
empirical fact settled (akoyago hostname), one wrong runbook host corrected,
and two process memories written.

### What Was Completed

1. **Interlock design** — `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md`:
   verified inventory of every runtime Dataverse HTTP path (two write funnels
   + read-only export family), tracked hostname registry, deployment × target
   × operation policy matrix, off/warn/on modes, two audited exceptions
   (date-bounded operator ack; Mode-D rehearsal grant).
2. **Stage 1 (policy module)** — `lib/dataverse/core/interlock.js` +
   `target-registry.js` + 103-test suite. Merged at `e113b4bf`.
3. **Four Codex adversarial rounds, eight findings (2+2+3+1), all fixed and
   diff-reviewed.** Theme: every finding was fail-open-by-omission at the
   EDGES (input grammar, exception structure, config/wiring/error seams) —
   the core matrix survived untouched. Hardening: first-segment OData
   parsing; `$batch` never grant-coverable; GUID-only recordIds (alt-keys are
   upsert channels); exact-collection-only create fast-path; set-but-invalid
   flag fails closed to `on`; URL scoping in-module
   (`shouldInspectDataverseUrl`); export denials never rewrapped as
   FetchXmlError.
4. **Stage 2 (hook wiring)** — three hook families call the interlock
   unconditionally: `dynamics/http.js#fetchWithTimeout` (covers read-ops,
   write-core, changeset, email), `dataverse/client.js#call()`, and the
   dataverse-export read family. 9 wiring tests pin the denial contracts
   (never wrapped as transient/no-response; dryRun exempt). Merged at
   `8067de3a`; full suite 5361/5361 + prod build green.
5. **Warn rollout EXECUTED** — `DATAVERSE_TARGET_INTERLOCK=warn` live in
   `.env.local` + Vercel Production/Preview; production redeployed (aliased
   `reviews.wmkeck.org`, Ready); zero `[dataverse-interlock]` lines on the
   live deployment at rollout time.
6. **akoyago resolved empirically** — read-only Global Discovery probe: the
   app registration sees exactly two orgs (`wmkf` prod, display name "WM Keck
   Foundation akoyaGO", and sandbox `orgd9e66399`); `akoyago.crm.dynamics.com`
   never existed (product-name/hostname conflation). Runbook's sandbox host
   corrected (`wmkfsandbox` → `orgd9e66399`) + four interlock env vars
   documented in `docs/CREDENTIALS_RUNBOOK.md`.
7. **All three §7 owner decisions resolved**: akoyago (probe); prod→sandbox =
   deny; preview prod-reads stay denied by default.
8. **Tooling/preferences**: Codex CLI upgraded 0.133→0.144.1; owner directive
   persisted — ALL Codex calls use `--model gpt-5.5`
   (`feedback-codex-model-gpt55`). New process memory
   `feedback-author-adversarial-pass-first` (author attacks enforcement code
   BEFORE delegating review). New reference
   `reference-staleness-ack-single-line` (stop-hook ack parser needs
   path+RECHECKED on one physical line).

### Commits (main, all pushed)

- `e113b4bf` — Merge Stage-1 policy module (+ `610b50ca`/`d55b5175`/`b2409928`/`9bffbcd6` on branch)
- `4e10f940` — round-3 hardening (invalid mode → on; in-module URL scoping)
- `8067de3a` — Merge Stage-2 hook wiring (+ `8278d170`/`ad68d97c` on branch)
- `87da872e` — warn rollout docs (env live, redeploy verified)
- `9e16bed8`/`5a55c3da` — akoyago resolution + registry/wiki reconcile
- `5c818aac` — owner policy decisions resolved
- `b93714c4`/`9a3f6550`/`ec81cb34`/`753ea109` — memory entries
- Session 355 stop/handoff commit follows this file.

## Next Items

### Verified Open

1. **Interlock observation → flip to `on` (plan §5 Stage 3).** `warn` is live
   everywhere as of 2026-07-11. Review logs after normal staff use + at least
   one full cron cycle: every `[dataverse-interlock] would deny` line is
   either a real hazard or a policy gap to fix first. EXPECTED noise source:
   local `npm run dev` reads prod Dataverse → local→prod reads log would-deny
   lines; at flip time decide whether `.env.local` gets
   `DATAVERSE_ALLOW_PROD_READS=yes`. Evidence:
   `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md` §5; `vercel env ls`.
2. **Make session automation branch-aware** (`/start` pulls `origin/main`,
   `/stop` hard-codes push to main). ELEVATED: S355 hit the exact failure —
   a subagent switched the shared checkout to a feature branch and a docs
   commit landed on the wrong ref (recovered via cherry-pick). Evidence:
   `.claude/skills/start/SKILL.md`, `.claude/skills/stop/SKILL.md`, S355
   transcript.
3. **Fix the policy-version `label_conflict` UX** without weakening
   immutability. Evidence: `lib/services/admin/policies-service.js:274-292`,
   `shared/components/admin/PoliciesSection.js`. (Carried from S353;
   unverified this session beyond the file paths existing.)

### Owner Decision Needed (carryover, unchanged, still blocked)

1. Reviewer-institution→CRM linking brief to Connor + Sarah
   (`outputs/reviewer-institution-crm-linking-brief.md`, local-only;
   `.claude-memory/project-reviewer-affiliation-institution-linking.md`).
2. Whack-a-mole reconciliation; holistic-redesign green-light; rescue-tool
   location; closeout payability scope; `check:types` end state. Evidence:
   S353/S354 SESSION_PROMPT history + cited memories.

### Parked

1. **Interlock Stage 4 (optional)**: `check:dataverse-interlock` CI gate
   asserting hook sites still call the assert. Re-open trigger: after the
   flip to `on`, or any refactor touching the hook files. Evidence: plan §5.
2. **`DYNAMICS_SANDBOX_URL || DYNAMICS_URL` fallback cleanup** in the four
   client.js services — quiet-window work; the interlock now makes divergence
   visible (deny) rather than silent. Evidence: plan §4, §2.2.
3. Prior parked items carry forward unchanged (reviewer holistic redesign
   branch; accepted-reviewer stand-down; review rendition formatting;
   campaign settings UX; prompt-cache-hit audit; reviewer ack provenance
   parity; Dependabot PR #53; intake portal). Evidence: S353–S355
   SESSION_PROMPT history + cited memories.

### Verify Before Acting

1. **Any `[dataverse-interlock]` line in PROD logs means env misconfig or an
   unregistered target** — investigate the caller; do NOT blindly extend
   `lib/dataverse/core/target-registry.js` (adding a host = a reviewed
   commit, by design). Evidence: registry header + wiki dataverse topic.
2. Re-verify the affiliation probe numbers before quoting them
   (`scripts/probe-reviewer-affiliation-account-match.js`) — data drifts.

### Do Not Reopen Without New Decision

1. **Interlock policy calls are owner-decided (S355)**: prod→sandbox = deny;
   preview prod-reads denied by default; akoyago is NOT an org; `$batch` and
   alt-key writes never grant-coverable in v1; invalid flag → `on`. Evidence:
   plan §3.2/§3.3/§7 + `5c818aac`.
2. All Codex calls use `--model gpt-5.5` unless the owner says otherwise
   (`feedback-codex-model-gpt55`). The user's `~/.codex/config.toml` pins
   gpt-5.6-sol which the CLI rejects — do not edit that file.
3. Decline-referral one-click add (`ef97fcd`, S354) shipped and verified.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/dataverse/core/interlock.js` | Policy module: classify/mode/exceptions/assert (+`shouldInspectDataverseUrl`) |
| `lib/dataverse/core/target-registry.js` | Tracked hostname registry (prod `wmkf`, sandbox `orgd9e66399`) |
| `lib/services/dynamics/http.js` | Hook 1: fetchWithTimeout (assert BEFORE the wrap-try) |
| `lib/dataverse/client.js` | Hook 2: call() (assert after dryRun; CJS requires the ESM module — Node 24 OK) |
| `lib/services/dataverse-export/fetch-client.js` | Hook 3 + denial-preservation guard in requestWithBackoff |
| `tests/unit/dataverse-interlock.test.js` | 103 policy tests |
| `tests/unit/dataverse-interlock-wiring.test.js` | 9 wiring/denial-contract tests |
| `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md` | Design + status (§5 rollout stages) |
| `scripts/discover-dynamics-envs.js` | Read-only org discovery probe (akoyago resolution) |

## Testing

```bash
npx jest tests/unit/dataverse-interlock.test.js tests/unit/dataverse-interlock-wiring.test.js
npm run check:types
# Observe warn logs on the live prod deployment:
vercel ls --prod   # get current deployment URL
vercel logs <url> | grep dataverse-interlock
```
