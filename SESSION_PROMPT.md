# Session 430 Prompt: Observability Plan Review Closed — Owner Merge Decision Pending

## Session 429 Summary

Session 429 ran the full adversarial review cycle over the Workbench
observability/read-coalescing plan on the documentation-only branch
`codex/claude-workbench-plan-revision` (worktree
`WMKF_Apps-claude-observability`, base `b4c8e048`). Six Codex review passes
(8 + 5 + 6 + 3 + 7 + 4 findings, plus a final graph/token amendment) were each
independently verified against current source, confirmed, and folded into the
plan; every pass's dispositions live in
`docs/audits/claude-workbench-observability-plan-response-2026-08-15.md`.

**Codex's final read-only verdict accepted the branch:** the graph/token
amendment is correct (the Graph token request targets
`login.microsoftonline.com` and classifies as `azuread`/`token`;
`graph`/`token` is rejected), pass counts and durable restatements are
reconciled, independent compatibility verification and all applicable
documentation gates/self-tests passed, and **no further plan revision is
requested**.

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
2. **All review-cycle verification ran green on the final tree:** ten
   documentation gate/self-test pairs (sequential), `npm run lint`,
   `npm run build`, `git diff --check`, and the local fixture NDJSON test of
   the export workflow's Steps 2–4.

### Commits (all on `codex/claude-workbench-plan-revision`)

- `34e2378e` / `33b9d202` — initial revision per the first Codex review
- `96190462` / `28a25e67` — second pass
- `5f38f006` — third pass
- `e51bf0fe` — fourth pass
- `c408ca23` — fifth pass
- `eec823a6` — sixth pass
- `a33e2d6b` — graph/token amendment (final reviewed commit)

## Final Disposition

1. **The documentation-only branch is ready for the owner's merge decision.**
2. **The observability plan remains a draft and is NOT authorized for
   implementation.** Naming a stage authorizes brief Phase 8; this review
   authorized nothing.
3. **If Stage 1 is explicitly authorized after the documentation branch
   merges, implement it in a fresh Tier-2 worktree and branch based on the
   resulting `main`.**
4. **Do not reuse this plan-review worktree
   (`WMKF_Apps-claude-observability`) for runtime implementation.**
5. **Stage 2 remains separately authorized**, after Stage 1 supplies a usable
   before/after dependency-call baseline (Stage 2 is source-certain, not
   latency-gated; the baseline is for acceptance verification).

## Next Items

### Owner Decision Needed

1. **Merge the documentation branch `codex/claude-workbench-plan-revision`?**
   Evidence: Codex final read-only verdict (accepted, no further revision);
   branch clean at `a33e2d6b`. Deliberate owner merge; docs-only, no runtime
   change, no deploy effect beyond docs.
2. **Authorize Stage 1 (and/or later Stage 2) implementation?** Phase 8 stays
   dormant until a stage is explicitly named. Per the disposition above:
   fresh Tier-2 worktree/branch off post-merge `main`.
3. **Campaign window / release posture** remains `[NEEDS OWNER]`.
4. **Vercel plan log-retention confirmation** at measurement-window start
   (Stage 1 sink contract).
5. **Verifier-deselect hardening?** The token verifier checks `revoked` but
   not `wmkf_selected`; whether deselection alone should invalidate an
   existing link is a separate small hardening (recommendation: leave revoke
   and deselect distinct).
6. **Run the 7-item read-only production-probe list?** Owner-executed
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
| `docs/audits/codex-workbench-observability-plan-adversarial-review-2026-08-15.md` | First Codex review (point-in-time) |
| `docs/audits/fable-audit-final-handoff-2026-08-14.md` | Audit decision trail and verdicts |
| `.claude-memory/project-reviewer-org-open-access-by-design.md` | The org-open by-design principle (T1 + D4) |
| `lib/services/reviewer-reminder-sweep.js` | T2 fix (eligibility filter + atomic ETag PATCH) |

## Testing

Review-cycle verification on this branch (all green at `a33e2d6b`):

```bash
# ten documentation gate/self-test pairs, sequentially, e.g.:
npm run check:doc-currency && npm run check:doc-currency:self-test
# ... doc-symbol-refs, fact-consistency, build-claim-freshness,
#     docs-catalog, agent-invariants ...
npm run lint
npm run build
git diff --check
```
