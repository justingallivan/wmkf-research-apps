# Session 430 Prompt: Reviewed Documentation Merged — Implementation Decisions Pending

## Session 429 Summary

Session 429 ran the full adversarial review cycle over the Workbench
observability/read-coalescing plan on the documentation-only branch
`codex/claude-workbench-plan-revision` (worktree
`WMKF_Apps-claude-observability`, base `b4c8e048`). Six Codex review passes
(8 + 5 + 6 + 3 + 7 + 4 findings, plus a final graph/token amendment) were each
independently verified against current source, confirmed, and folded into the
plan; every pass's dispositions live in
`docs/audits/claude-workbench-observability-plan-response-2026-08-15.md`.

In parallel, Claude completed the documentation-only auth/side-effect security
audit on `codex/claude-security-followup-audit`. Four Codex correction rounds
resolved the disabled-account revocation contract, both `link-profile` branches,
fresh disabled-user sign-in side effects, missing-profile fail-open behavior,
the 28-site raw-error inventory, and the two-verifier cron-auth topology. The
final accepted audit is
`docs/audits/claude-auth-side-effect-security-audit-2026-08-15.md`.

**Codex's final read-only verdict accepted the branch:** the graph/token
amendment is correct (the Graph token request targets
`login.microsoftonline.com` and classifies as `azuread`/`token`;
`graph`/`token` is rejected), pass counts and durable restatements are
reconciled, independent compatibility verification and all applicable
documentation gates/self-tests passed, and **no further plan revision is
requested**.

**Codex's final bounded security verdict also accepted its branch:** all four
round-four corrections match current source, the applicable documentation and
API-route gates/self-tests passed independently, and no further audit revision
is requested.

### What Was Completed

1. **The plan is internally consistent and implementation-ready as a plan.**
   Final state: verified external-egress inventory (emission vs. measurement
   scope); independent pre-auth request-correlation ALS; v1 telemetry envelope
   with `eventId`, fetch-semantics `operation`, source-resolved `resourceClass`
   allowlists, and outcome↔statusClass consistency; exact error-preservation
   semantics; structured-platform-log sink with a fixture-tested, fail-closed,
   unfiltered export workflow; chunk-aware Stage 2 census/formula; T1/T2
   uniformly closed as history; contract-reconcile Mode A (sixth pass):
   **READY WITH NAMED CHANGES** (owner items only).
2. **The security audit is complete and implementation-scoped.** Its primary
   recommendation is a separate Tier-2 revocation-hardening effort: deny fresh
   sign-in for disabled identities before side effects, block the current
   request, invalidate subsequent staff tokens, fail closed on missing profiles,
   and guard both `link-profile` branches with safe persistence ordering.
3. **The owner merged both reviewed documentation branches into `main`:** the
   Workbench plan at `741e7d99` and the security audit at `c0bf48da`. No runtime
   implementation or stage authorization was included.
4. **All review-cycle verification ran green on the final trees:** ten
   documentation gate/self-test pairs (sequential), `npm run lint`,
   `npm run build`, `git diff --check`, and the local fixture NDJSON test of
   the export workflow's Steps 2–4; the security branch additionally passed the
   API-route gate/self-test and an independent 19-route cron-verifier census.

### Commits (all on `codex/claude-workbench-plan-revision`)

- `34e2378e` / `33b9d202` — initial revision per the first Codex review
- `96190462` / `28a25e67` — second pass
- `5f38f006` — third pass
- `e51bf0fe` — fourth pass
- `c408ca23` — fifth pass
- `eec823a6` — sixth pass
- `a33e2d6b` — graph/token amendment (final reviewed commit)
- `ebcf469c` — Session 430 branch closeout

### Security-audit commits

- `571da7f0` — initial auth/side-effect audit
- `4fbb99ef` / `7efcf929` / `7c447d5c` / `c34cf21f` — four Codex correction rounds

### Main merge commits

- `741e7d99` — merge reviewed Workbench observability plan
- `c0bf48da` — merge reviewed auth and side-effect security audit

## Final Disposition

1. **Both documentation-only review branches are merged into `main`.**
2. **The observability plan remains a draft and is NOT authorized for
   implementation.** Naming a stage authorizes brief Phase 8; this review
   authorized nothing.
3. **If Stage 1 is explicitly authorized, implement it in a fresh Tier-2
   worktree and branch based on current `main`.**
4. **Do not reuse this plan-review worktree
   (`WMKF_Apps-claude-observability`) for runtime implementation.**
5. **Stage 2 remains separately authorized**, after Stage 1 supplies a usable
   before/after dependency-call baseline (Stage 2 is source-certain, not
   latency-gated; the baseline is for acceptance verification).
6. **Security runtime hardening is also not yet authorized.** If authorized,
   implement it in a separate fresh Tier-2 worktree, not either audit worktree.

## Next Items

### Owner Decision Needed

1. **Authorize Stage 1 (and/or later Stage 2) implementation?** Phase 8 stays
   dormant until a stage is explicitly named. Per the disposition above:
   fresh Tier-2 worktree/branch off post-merge `main`.
2. **Authorize Tier-2 revocation hardening?** The accepted security audit's
   behavioral invariants are in §10.2; implementation belongs in a fresh branch.
3. **Hard-delete reprovisioning policy?** Recommended posture: use
   `is_active = false` as durable revocation. Add a tombstone/denylist only if a
   hard-deleted Azure identity must also be prevented from reprovisioning.
4. **Campaign window / release posture** remains `[NEEDS OWNER]`.
5. **Vercel plan log-retention confirmation** at measurement-window start
   (Stage 1 sink contract).
6. **Intake launch authorization must keep proxy routing + CSRF together.**
   Extending applicant routing without Origin validation would make the latent
   gap live; ship both in one pre-launch change.
7. **Verifier-deselect hardening?** The token verifier checks `revoked` but
   not `wmkf_selected`; whether deselection alone should invalidate an
   existing link is a separate small hardening (recommendation: leave revoke
   and deselect distinct).
8. **Run the 7-item read-only production-probe list?** Owner-executed
   (standing rule bars self-authorized prod Dataverse reads). List in
   `docs/audits/fable-current-state-evidence-2026-08-14.md`.

### Verified Open (unchanged audit follow-ups, scope discipline)

1. Security Operating Plan materially drifted (~12 controls unrecorded since
   2026-05-05) — reconcile with `/sweep`.
2. `check:trust-boundary-guid` and `check:status-enum-parity` have no CI
   backstop (Claude-Code commit-hook only) — worth wiring into `test.yml`.
3. Untracked secret-rotation names (`UPLOADS_BLOB_RW_TOKEN`,
   `OPENAI_API_KEY`, etc.) absent from `lib/utils/tracked-secrets.js`.
4. Stale doc counts: DAL migration plan says 19 adapters (now 20);
   `CANONICAL_COUNTS.md` re-derive against 157 routes / 20 adapters /
   29 migrations.

### Verify Before Acting

1. **Confirm the Tier-2 production deploy of `171c46a9` reached Ready** and
   scan for post-deploy errors on the reviewer-reminder and grantee-abstract
   surfaces (Session 428 shipped two runtime changes; `main` auto-deploys).

### Do Not Reopen Without New Decision

1. **Reviewer merge org-open access (T1)** — accepted by-design 2026-08-15.
   See `.claude-memory/project-merge-candidates-authorization-gap.md` (closed).
2. **Staff-wide cross-request document reads (D4)** — accepted by-design
   2026-08-15. See `.claude-memory/project-reviewer-org-open-access-by-design.md`.
3. **The full Request Workbench Data Plane as a big-bang refactor** — deferred
   in favor of measure-first + incremental slices behind seams.
4. **CLI-version upgrade/churn housekeeping** — the plan's rule is
   version-agnostic (record installed version, inspect help, preflight against
   a known emitted event at window start); do not add upgrade tasks.
5. **Grantee recipient override and stateless invitation-token behavior** —
   accepted risks in the security audit; require a new owner decision to change.

## Historical Context (Session 428, retained for continuity)

Session 428 executed the Fable audit brief (Phases 0–7), closed T1/D4 by owner
decision (org-open by design — no technical ownership of requests/data in
Dataverse to scope against), shipped the T2 reminder-eligibility fix and the
abstract-save ambiguous-write reconciliation, and merged to `main`
(`171c46a9`, `42f190e0`, `aaf92cf5` — historical Session 428 state; the
current baseline has since advanced).

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` | The reviewed staged plan (draft, not authorized); Stage 1 is the next authorizable work |
| `docs/audits/claude-workbench-observability-plan-response-2026-08-15.md` | All six review-pass dispositions + final Mode A verdict |
| `docs/audits/claude-auth-side-effect-security-audit-2026-08-15.md` | Accepted auth/side-effect audit, owner decisions, and Tier-2 revocation invariants |
| `docs/audits/codex-workbench-observability-plan-adversarial-review-2026-08-15.md` | First Codex review (point-in-time) |
| `docs/audits/fable-audit-final-handoff-2026-08-14.md` | Audit decision trail and verdicts |
| `.claude-memory/project-reviewer-org-open-access-by-design.md` | The org-open by-design principle (T1 + D4) |
| `lib/services/reviewer-reminder-sweep.js` | T2 fix (eligibility filter + atomic ETag PATCH) |

## Testing

Review-cycle verification was green on both reviewed branches. Re-run the
documentation gates on merged `main` before pushing the reconciliation commit:

```bash
# ten documentation gate/self-test pairs, sequentially, e.g.:
npm run check:doc-currency && npm run check:doc-currency:self-test
# ... doc-symbol-refs, fact-consistency, build-claim-freshness,
#     docs-catalog, agent-invariants ...
npm run lint
npm run build
git diff --check
```
