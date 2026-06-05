# Session 222 Prompt: live-smoke the (now-deployed) reviewer fixes, then resume the workflow walkthrough

## ⚠️ Read first — the reviewer fixes are NOW IN PROD
S220 + S221's reviewer-enrichment fixes are **merged to `main` and deployed** (the S221 handoff wanted the smoke *before* merge; Justin chose to merge first, so the live PD smoke is now **owed post-deploy**). The code is well-tested (1868 green) and twice Codex-reviewed at home, but **still never exercised by a real PD login.** Top task: do that smoke against prod.

## ⏰ Standing context / guardrails (carried S197–S221)
- **`main` auto-deploys to prod on push.** Feature branches do NOT deploy. Commit/push only when asked. One-shot operator scripts + SQL migrations hit prod directly when run locally.
- **`rtk` is FULLY UNINSTALLED + cleaned on both machines (S221).** Do NOT prefix commands with `rtk`. The two per-machine surfaces (`~/.claude/settings.json`(+`.bak`) and `.claude/settings.local.json`) are now clean on home + office. Global `~/.claude/RTK.md` does not exist here. See [[project-rtk-grep-output-corruption]].
- **THREE reminder hooks LIVE** (`.claude/settings.json`, repo-tracked → all machines):
  - PreToolUse `scope-claim-reminder.js` — disconfirm scope/quantity claims.
  - PreToolUse `doc-edit-reconcile-reminder.js` — on any `docs/`/`.claude-memory/`/`CLAUDE.md`/`SESSION_PROMPT.md`/`AGENTS.md` Edit: read the WHOLE file + grep repo + fix every instance.
  - **NEW PostToolUse `codex-verbatim-reminder.js` (S221)** — fires when a `Task|Agent` codex result returns: **paste Codex output VERBATIM before ANY verify/act/paraphrase.** Added because that rule failed ~5× in prose; the hook only reminds, the rule still binds. See [[feedback-share-codex-verbatim]].
- **Codex skills come from `.agents/skills/` (symlink → `.claude/skills/`), per-machine (gitignored).** `/start` Step 1.6 self-heals it. Do NOT run `migrate-to-codex` (corrupts `.agents/` + severs `AGENTS.md` symlink).
- **Local-dev hits the SAME prod Dataverse + prod Postgres.** `.env.local` has `POSTGRES_URL`, `SERP_API_KEY`, `BLOB_READ_WRITE_TOKEN`. ORCID/NCBI/EXTERNAL_LINK_SECRET are "Sensitive" → empty on `vercel env pull`, hand-enter. (S220: `CLAUDE_API_KEY` in `.env.local` had gone stale/401; Justin replaced it.)
- **jest harness for live-pipeline repro:** Next skips `.env.local` under `NODE_ENV=test`; load it by hand + override `jest.setup.js`'s stub `CLAUDE_API_KEY`. Restore real `fetch` via `undici`. Run through `npx jest` (extensionless ESM imports). Proven S220.
- **Memory is a ROUTER.** `.claude-memory/MEMORY.md` routes "for THIS task → read these 1–3 files" (in full).

## Session 221 Summary — merged S220 to prod, then a fresh Codex review caught 2 more leaks

Justin started S222-adjacent: noticed an unmerged branch ahead of `main` (`fix/workbench-reviewer-find-enrichment`, the S220 work + S221 prompt) and merged it to prod (fast-forward `6019cec..2cc6708`). Then flagged that the S220 Codex reviews ran on the **work machine whose session went stale** — unverifiable. A fresh Codex review at home (correct call) found the prior "Codex-reviewed → CLEAN" was not the whole story:

### 1. Two wrong-person leaks closed (`549dd52`)
- **Bug 1 (data leak, was live in prod):** the unconfirmed-match guard in `enrich-recommended.js` gated on `c.verified !== false` — but contact enrichment (web/SerpAPI/Scholar) runs on the bare name for verified AND unverified candidates, so a PubMed-UNverified, no-affiliation row leaked a same-named stranger's website/faculty/email/Scholar to writeback. Dropped `c.verified !== false`.
- **Bug 1 residual:** `writeIdentityDecision` still persisted the stranger's resolver anchors (`canonicalKey`+`sourceUrl`) to `wmkf_identityverifiedanchorsjson` (NOT in `RESOLVER_SOURCED_FIELDS`, so `clearIdentityFields` couldn't scrub them). Now sanitized (`anchors:[]`, generic summary) for unconfirmed matches; bare `unresolved` status still recorded. **Policy decision (Justin): the affiliation-grounded below-probable path keeps its anchors — audit trail, low risk.**
- **Bug 2 (email-guard false-rejects):** `isNameConsistentEmail` left suffix/credential tokens (Jr/Ph.D./MD) as the "surname" and stripped accents to nothing. Now NFD-normalize + strip `\p{Mn}`, collapse intra-token punctuation, filter `SUFFIX_TOKENS`. **Residual:** suffix-strip collapsed `"John MD"` to lone given name → re-opened the false-accept; fixed with a ≥2-real-token fallback.
- +9 tests; full suite 1868 green; lint 0 errors. Codex round-2 confirmed both bugs closed.

### 2. codex-verbatim enforcement hook (`097e1e4`)
The verbatim-Codex rule failed twice this session (ran verification Bash/Read + paraphrased into tables before showing the review). Per S219's "lever is the hook, not prose": added PostToolUse `.claude/hooks/codex-verbatim-reminder.js` (fails open, 5-case tested), updated [[feedback-share-codex-verbatim]], fixed the stale "two hooks" count.

### 3. rtk fully removed on home + memory reconciled (`965700d`)
Justin uninstalled rtk; S220 only cleaned the **office** machine (`.claude/settings.local.json` is gitignored → never synced). Home still had **20** dead `Bash(rtk …)` allowlist entries (S220 note said 9 = office-only) → removed. Refreshed `~/.claude/settings.json.bak`. Fixed `rtk proxy npx jest` → `npx jest` in a build-plan doc. Reconciled [[project-rtk-grep-output-corruption]] (explained the 9-vs-20 per-machine gap).

### 4. Codex skills symlink fixed (`88c1ce2`)
`.agents/skills/` (Codex) held stale May-22 copies of `start`/`stop`, missing `sweep` → Codex ran outdated skills. Replaced with symlink `.agents/skills → ../.claude/skills` (one source of truth). `/start` Step 1.6 now self-heals it per-machine. **Justin confirmed he already created the office symlink** — per-machine + gitignored, so no git conflict.

## Potential Next Steps

### 1. Live PD smoke of the deployed reviewer fixes (TOP — now owed post-deploy)
Log in as a PD, open `/workbench/1002788` (lead PD Justin, real `ProjectDescription.pdf`) → Reviewers → Find. Verify: "Run reviewer search" returns ~12 real reviewers; the "Optional: verify the applicant's suggested reviewers" button reads as secondary; enriching the 4 fake "Justin" reviewers fabricates NO emails and marks the no-affiliation ones "needs identification" — AND now (S221) writes no stranger website/faculty/anchors for them. Only Justin holds the `reviewers` grant; grant pilot PDs via `/admin` (`wmkf_appuserappaccesses`). Read-only state probe: `node scripts/probe-reviewers-grant-and-smoke-state.js`.

### 2. Reviewer-workflow validation walkthrough (the ORIGINAL S220 task, still open)
Find→Invite→Track→Completed end-to-end. Never completed — bugs surfaced at the Find step both sessions. Resume after #1.

### 3. Reviewer-app consolidation (destructive — grep first)
Retire legacy `reviewer-finder`/`review-manager` appRegistry keys now Workbench has Find parity. Both keys still live; 18 routes accept `reviewers` variadically. [[project-reviewer-apps-redesign-direction]] (Option B). Verify live callers before touching.

### 4. Intake virus-scan EICAR e2e — parked pre-cycle must-do
[[project-intake-portal-virus-scan-e2e-deferred]]; needs a deployed env + Entra applicant session.

## Key Files Reference
| File | Purpose |
|------|---------|
| `pages/api/workbench/enrich-recommended.js` | unconfirmed-match gating (S221: dropped `c.verified` escape hatch + sanitized identity anchors) |
| `lib/utils/contact-parser.js` | `isNameConsistentEmail` (S221: NFD + suffix-strip + ≥2-token fallback) |
| `tests/unit/contact-parser-email-consistency.test.js` / `reviewer-route-identity-gate.test.js` | the S221 regression cases |
| `.claude/hooks/codex-verbatim-reminder.js` | NEW PostToolUse — paste Codex verbatim before acting |
| `scripts/probe-reviewers-grant-and-smoke-state.js` | read-only: who holds `reviewers` grant + 1002788 reviewer state |

## Testing
```bash
npx jest tests/unit/contact-parser-email-consistency.test.js tests/unit/reviewer-route-identity-gate.test.js
npx jest                                                        # full suite (1868 green at S221)
node scripts/probe-reviewers-grant-and-smoke-state.js          # live grant + smoke-state probe
# full gate set (matches /start):
for g in migrations-manifest api-routes atlas doc-currency fact-consistency canonical-pointers drain-table-mentions prompt-storage-mentions prompt-injection-tagging memory-router; do npm run check:$g; done
```
