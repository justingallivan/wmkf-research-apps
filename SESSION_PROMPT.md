# Session 198 Prompt: Triage the codebase-evaluation findings

## ⏰ Standing context / guardrails added S197
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`, wired in `.claude/settings.json`). It fires a non-blocking reminder on any scope/quantity word (only/all/none/every/never/always, "the rest", "N of M", "source of truth") written into `docs/`, `.claude-memory/`, `CLAUDE.md`, `SESSION_PROMPT.md`, `AGENTS.md`. Run the *disconfirming* query before asserting. Tunable via `/hooks`. Rationale: [[feedback-falsify-not-confirm]].
- **Codex stop-time review gate is ENABLED** for this project — Codex independently reviews before a turn is considered done.
- **Phasing is locked:** one applicant submission entered as Phase I; "Phase II" = internal status flip (no Phase II uploads). The "mid-June 2026 Phase II Research intake pilot" is **defunct** — intake is a Phase I build for the next cycle. Canonical: `docs/SYSTEM_MODEL.md` + [[project-system-model]].

### BILL reviewer-honorarium build (carryover)
- Chunk 4 (extend `respond.js` accept path: create honorarium `akoya_request` + PATCH the junction's `wmkf_HonorariumRequest` lookup) is **unblocked schema-side**, Vercel work. NOTE the eval flagged `wmkf_honorariumrequest` is documented-deployed but absent from schema-as-code + `reviewer-suggestion.js` `FIELD_SELECT` — that's chunk-4 territory.

### Intake virus-scan e2e (carryover, pre-launch)
- Run EICAR through `/apply` before the next cycle's Phase I intake goes live. Recipe in [[project-intake-portal-virus-scan-e2e-deferred]].

## Session 197 Summary

Started on the appresearcher collapse (correctly flagged as post-pilot-gated), pivoted to chronic **nomenclature/model drift**, and turned it into durable infrastructure.

### What was completed
1. **Canonical system model** — `docs/SYSTEM_MODEL.md` (rote/thinking principle, two orthogonal axes, capabilities vs trunk vs substrate, Mode 1/2, doc-resolution provenance tiers). Codex-reviewed twice; target-vs-built honesty enforced.
2. **Falsification defense-in-depth** for the confirm-vs-falsify failure mode: the **PreToolUse hook** (above) + [[feedback-falsify-not-confirm]] protocol + the **Codex stop-gate** (enabled). Hook proven live via sentinel.
3. **Drift audit + reconciliation** — a find→adversarial-verify→synthesize workflow; fixed no-judgment drift + Codex-caught siblings; reconciled the **defunct Phase II pilot cluster** across 16 files per 3 user decisions (rewrite-in-place; form module shelved; budget spec preserved). 142 live `Phase II Pending` rows + form-module paths left untouched.
4. **10-front codebase evaluation** (read-only workflow, 36 agents) → `docs/CODEBASE_EVALUATION_2026-05-29.md`, Codex-reviewed + corrected. All CI gates green throughout.

### Commits
- `d4e61e9` system model + memory · `f147d8b` drain-table gate fix · `5ee0b4d` iterate (don't overstate) · `cb1bee2` re-confirm fixes · `67666e7` falsification hook + memory · `37bfa5b` no-judgment drift fixes · `a84aee9` sibling reconcile · `6504333` Phase II pilot drift (16 files) · `04685e1` mark reconciled · `7332da3` gitignore outputs/ · (+ this closeout)

## Potential next steps for S198

### 1. Triage the evaluation findings (PRIMARY) — `docs/CODEBASE_EVALUATION_2026-05-29.md`
Verified, safe-to-act: **drain-submissions has no `startRun`/`completeRun` telemetry** (silent failure invisible to audit — highest operational); **no direct `proxy.js` test** (idle-timeout, CSP nonce) + untested referer fallback; **app-access 2-min TTL** also caches `is_active` (deactivated account keeps access 2 min); **README** stale Phase II framing; **entry points don't reference SYSTEM_MODEL.md / glossary**; **`APPLICATION_STATE_ATLAS.md` line-citation drift** (re-verify ~80, prefer symbols).
Verify-live-first (prod claims are S186-aged): migrations 011/013 are **almost certainly already applied** (DEV_LOG S186) — verify-and-close, don't re-apply; `INTAKE_BLOB_RW_TOKEN` + `VRP_ALLOWED_PROVIDERS` — `vercel env ls production`.

### 2. The eval's "Likely under-covered" deep passes
External-reviewer state machine (`respond.js`), drain-submissions internals, BILL partial-failure handling — areas the excerpt-based eval mischaracterized by shape; each warrants a *focused* read, not a broad fan-out.

### 3. Parked initiatives (unchanged)
- **Appresearcher collapse** — gated on reviewer-Workbench stabilization (NOT the intake pilot — mis-anchor corrected S197). `docs/APPRESEARCHER_COLLAPSE_PLAN.md`.
- **Dependency/sequencing pass** — the capability graph in goal/order terms (deferred from S197 start).
- **BILL chunk 4** (above).

## Key files reference
| File | Purpose |
|------|---------|
| `docs/SYSTEM_MODEL.md` | Canonical conceptual model (NEW S197) |
| `docs/CODEBASE_EVALUATION_2026-05-29.md` | 10-front eval, Codex-corrected (NEW S197) |
| `.claude/hooks/scope-claim-reminder.js` + `.claude/settings.json` | Falsification hook (NEW S197) |
| `.claude-memory/project-system-model.md`, `feedback-falsify-not-confirm.md` | Durable model + protocol (NEW S197) |

## Testing
N/A (docs/model/eval session). All CI gates green: `check:atlas`, `check:api-routes`, `check:fact-consistency`, `check:drain-table-mentions`, `check:prompt-storage-mentions`, `check:canonical-pointers`.
