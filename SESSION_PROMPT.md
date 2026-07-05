# Session 330 Prompt: Close the Stage 7 email-write gap; decide prod DAL flip

## Session 329 Summary

Session 329 executed the ENTIRE staged Dataverse data-access-layer migration
(Stages 0-8) in one session via parallel worktree agents (Codex + Opus +
Sonnet builds, serial Claude review/merge), with Codex adversarial review at
each phase boundary. The mid-session crash this session opened with (app
`beforeQuit`/restart, 3 terminal PTYs killed) turned out to be a clean
restart, not data loss — the crashed session's last subagent ("Stage 8:
ratchet becomes law") had already completed and merged before the restart,
and a background Codex review kicked off right after the restart (via the
daemon, independent of the killed terminal PTYs) ran to completion
unaffected. Full audit trail: `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`
stage log (354-530ish). Milestone entry: `DEVELOPMENT_LOG.md` "July 2026 —
... Session 329".

### What Was Completed

1. **Plan hardening (pre-execution)** — second adversarial review (Codex)
   refuted the original probe/gate design (2 P0 + 4 P1: aliased-writer blind
   spots, `executeChangeset` raw-CRUD backdoor, Bulk Export subtree
   unexempted, Stage 8 wording banned the adapters themselves, Wave 3 missed
   answer-snapshot writes, Stage 7 auth-ordering risk). Plan amended in
   place before any code changed.

2. **Stages 0-1** — Babel-AST census gate (`scripts/check-dataverse-access-layer.js`,
   alias-aware, changeset-attribution-aware) + allowlist ratchet (211 → 181
   entries), CI-registered, self-tested (6 fixture kinds).

3. **Stage 2 + adapter wave** — `lib/dataverse/core/` toolkit (odata/
   entity-registry/errors/changeset/context) + all 18 per-entity adapters
   `[VERIFIED via ls lib/dataverse/adapters/ — 18 files]`, tests-first.

4. **Stages 3-6 (bulk conversion)** — ~80 caller files converted across 7
   parallel worktree clusters + 3 sequential tails; allowlist 181 → 12, all
   12 non-entity-transport. Full suite 4163/4163 at wave close.

5. **Stage 7** — restriction context folds into the layer:
   `withDalContext(scopeLabel, fn)` (thin wrapper over the existing
   `bypassDynamicsRestrictions` ALS), entity CRUD + `executeChangeset` assert
   a trusted context under `DATAVERSE_DAL_ENFORCEMENT` (unset = on outside
   prod). CLAUDE.md invariant + wiki reconciled. **Prod flag flip is a
   pending owner deploy decision.**

6. **Stage 8** — gate becomes law: allowlist file DELETED, gate fails on any
   identity not in the closed `non-entity-transport` method set, unknown
   method names fail closed. Suite 4181/4181, build clean.

7. **Codex post-impl review of Stage 7 (this session, 2026-07-05) — COMPLETED,
   verdict "needs changes."** See Verified Open #1 below — this is the one
   real open item from the whole migration.

8. **Docs reconciled this session**: `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`
   stage log, `DEVELOPMENT_LOG.md` Session-329 "Open" line, and
   `docs/agent-wiki/topics/dataverse-dynamics.md` (both the fail-closed
   ground-rule claim and the stale "9 adapters" operating note) all updated
   to reflect the Codex finding — none of them mentioned it before this
   close-out, `npm run check:agent-wiki` green after.

### Commits (Stage 7 → close-out; see plan doc for the full Stage 0-6 list)

- `59c38843` Merge Stage 7: DAL restriction fold-in
- `23ac6171` docs(data-layer): Stage 7 reconciliation
- `21fc7e66` feat(data-layer): Stage 8 — ratchet becomes law, allowlist deleted
- `3cf4a506` Merge Stage 8
- `41edacd9` docs(data-layer): Stage 8 close-out

(This session's doc-reconciliation edits are uncommitted as of this
handoff — see Step 2 below, commit them before anything else.)

## Next Items

### Verified Open

1. **Fix the Stage 7 email-write enforcement gap (Codex finding, High
   severity).**
   Evidence: `[VERIFIED via lib/services/dynamics-service.js:1231,1302,1337]`
   — `createEmailActivity`, `addEmailAttachment`, `sendEmail` perform
   Dataverse POST/action calls with no `assertTrustedDalContext`.
   `[VERIFIED via scripts/check-dataverse-access-layer.js:66]` — these 3
   method names (+ `logAiRun`) are the closed `non-entity-transport` exempt
   set, so the law-mode gate stays green while these paths are unguarded raw
   writes. Fix: add `assertTrustedDalContext` calls to these 3 methods (or
   decide/document why email-send is intentionally exempt from the DAL trust
   boundary — but that contradicts the Stage 7/8 "entity-changing network
   paths are fail-closed" framing already asserted in CLAUDE.md and the
   wiki). Do this BEFORE flipping `DATAVERSE_DAL_ENFORCEMENT` in prod or
   calling Stage 7/8 security-complete.

2. **Medium-severity Codex findings, same review — lower priority, owner call
   needed on each:**
   - "Trusted context" is ALS-presence only, not proof of post-auth
     establishment (`context.js:46,66`; `dynamics-context.js:140`) — no
     concrete exploit found, but the trust model can't distinguish a
     caller-owned post-auth wrap from an arbitrary legacy-bypass context.
   - `pages/api/grant-reporting/extract.js:590` calls `DynamicsService.logAiRun`
     with no DAL context; if enforcement flips on in prod, this audit write
     throws and is silently swallowed at `:600` (non-fatal by design, but
     worth deciding if audit-loss-on-flip is acceptable).
   - `tests/unit/dal-enforcement.test.js:87` doesn't cover the email helpers
     or `withDynamicsContext` as a write-trusted context — add coverage
     alongside the fix in #1.

3. **Commit this session's doc-reconciliation edits** (uncommitted at
   handoff): `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`, `DEVELOPMENT_LOG.md`,
   `docs/agent-wiki/topics/dataverse-dynamics.md`. `npm run check:agent-wiki`
   already verified green.

### Owner Decision Needed

1. **Prod `DATAVERSE_DAL_ENFORCEMENT` flip.** Evidence: unset = on outside
   production; prod itself needs an explicit flip. Should wait until
   Verified Open #1 (email-write gap) is closed — flipping now would still
   leave email sends unguarded, just with the rest of entity CRUD enforced.

2. **Mechanical strip of the remaining legacy `bypassDynamicsRestrictions`
   importers** (plan doc's Stage 7 entry counted 79 post-merge; a fresh
   `grep`-based recount just now landed in the low-80s depending on method,
   so treat the exact count as [ASSUMED stale] and recount before scoping —
   direction is unchanged) — functionally correct as-is (legacy wrapper IS a
   trusted context), purely a follow-up cleanup pass. Schedule whenever, no
   urgency.

3. **Session 328 items not yet revisited this session** — thank-you cron
   proof + rehearsal cleanup, owner browser spot-check of the release flow.
   Not re-verified this session; check `.claude-memory/` and a fresh probe
   before assuming still-open (durable-carryover rule) — see prior
   SESSION_PROMPT history for detail if picking these back up.

### Parked

1. **Spec-audit docs recovery** (work computer only, ~2026-07-08).
   Evidence: `.claude-memory/project-spec-audit-docs-recovery-parked.md`.

### Verify Before Acting

1. **Do not assume "entity writes are fail-closed" covers email sends** —
   the wiki now flags this explicitly (`docs/agent-wiki/topics/dataverse-dynamics.md`),
   but if anyone quotes the older CLAUDE.md/Stage-7-reconciliation wording
   in isolation it reads as full coverage. It is not, until Verified Open #1
   ships.

### Do Not Reopen Without New Decision

1. **Do not re-add CodeQL** (`180e9046`, `198fbd97`).
2. **Do not delete `lib/services/anthropic-admin.js`** (pricing cron imports).
3. **Client-side export remains the decision** until a Power Automate flow
   exists (`docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` decision 4).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` | Full 9-stage plan + stage log (complete audit trail, incl. the Codex finding). |
| `lib/services/dynamics-service.js` | `createEmailActivity`/`addEmailAttachment`/`sendEmail` — the unguarded methods to fix. |
| `scripts/check-dataverse-access-layer.js` | Law-mode gate; `NON_ENTITY_TRANSPORT_METHODS` closed list (line ~66). |
| `lib/dataverse/core/context.js` | `withDalContext`, `hasTrustedDalContext`. |
| `lib/services/dynamics-context.js` | `isDalEnforcementOn`, `assertTrustedDalContext`. |
| `tests/unit/dal-enforcement.test.js` | Fail-closed test suite — needs email-helper coverage added. |
| `docs/agent-wiki/topics/dataverse-dynamics.md` | Reconciled this session with the email-write gap. |

## Testing

```bash
# Gates for this surface
npm run check:dataverse-access-layer && npm run check:dataverse-access-layer:self-test
npm run check:agent-wiki
npx jest tests/unit/dal-enforcement.test.js

# Full suite (was 4181/4181 at Stage 8 close; pricing-canary was fixed in S329, no longer a known-red)
npm test
```
