# Session 429 Prompt: Post-Fable-Audit — Stage 1 Observability Is the Next Authorizable Work

## Session 428 Summary

Session 428 executed the Fable Production Audit, Security, and Refactor master brief
end to end, resolved two standing security questions by owner decision, shipped two
runtime fixes, and merged everything to `main`.

At Session 428 close, `main` was at `171c46a9` and auto-deployed (historical
Session 428 state — the current baseline has since advanced; check `git log`).
All Session 428 feature branches were merged and deleted (local + remote); the
worktree was clean.

### What Was Completed

1. **The Fable audit brief was run to its stop point (Phases 0–7).**
   - Four read-only scouts (change inventory, semantic security map over 157 routes,
     Workbench performance trace, controls/operability) plus two Fable-personal
     confirm-or-refute traces (merge authorization, reminder-token eligibility), all
     fanned in and verified against source.
   - Architecture verdict: **measure/observability-first, then an in-service read
     merge — NOT the full Request Workbench Data Plane** (deferred, not rejected,
     because there is zero per-dependency timing instrumentation to justify it). The
     source-certain finding is redundant reads: three sibling `wmkf_potentialreviewers`
     read-pairs across two services (chunk-aware count, `q(n)=ceil(n/25)`:
     before `2q+2q+2q+q(decline)`, after `q+q+q+q` — the earlier fixed "×6 across
     3 routes" phrasing was not a valid census; decline-referrals has a single
     unmergeable read).
   - Staged plan `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md`, Opus
     adversarially reviewed (`changes required` → all 9 findings folded in, incl. a
     corrected Stage 2 mechanism). Subsequently re-reviewed by Codex on 2026-08-15
     (`docs/audits/codex-workbench-observability-plan-adversarial-review-2026-08-15.md`,
     verdict NEEDS REWORK — all 8 findings confirmed) and revised on branch
     `codex/claude-workbench-plan-revision`
     (`docs/audits/claude-workbench-observability-plan-response-2026-08-15.md`, fresh
     Mode A `READY WITH NAMED CHANGES`); a second five-finding Codex follow-up pass
     was likewise confirmed and folded in on the same branch (`96190462`), as was a
     third six-finding correction pass (timeout classification, JSON emitter
     contract, historical Vercel CLI 59.0.0 log workflow, emission-vs-measurement
     scope, unverified-volume sampling assumption, durable-state cleanup) and a
     fourth Q1–Q3 pass (per-event `eventId` dedup key, coarse-query + local-jq
     filter-of-record workflow with RAW-first truncation check, allowlisted
     `operation` enum). Full artifact set under
     `docs/audits/fable-*-2026-08-14.md` + the two 2026-08-15 audit files.

2. **Two standing security questions were closed by owner decision (2026-08-15).**
   - **T1 — reviewer merge authorization:** keep as-is (org-open, app-level access).
   - **D4 — staff-wide cross-request document reads:** accept as by-design.
   - Both rest on one principle: **there is no technical ownership of requests or data
     in Dataverse to scope against**, so app-level access is the correct boundary.
     Captured as `.claude-memory/project-reviewer-org-open-access-by-design.md` so
     future audits do not re-flag app-level-auth-on-a-record-scoped-op.

3. **T2 — automatic reminder token eligibility — fixed and shipped.**
   - The daily reviewer-reminders cron re-minted (and reactivated) links for
     deselected/revoked reviewers. Fix: both sweep filters now require selected +
     not-revoked (null-safe), and the cron marker+token is a single ETag-guarded
     PATCH so a concurrent revoke/deselect 412s instead of being clobbered.
   - Codex adversarial review caught the clobber race (P1); it was verified against
     source and fixed. 136 tests + gates green.

4. **Abstract-save ambiguous-write reconciliation was promoted.**
   - Rebased from `codex/fix-abstract-save-timeout` (`f69e3289`) onto current `main`,
     doc conflicts resolved, 139 tests + gates green. A committed-but-timed-out
     Dataverse PATCH is now reconciled to success instead of a false failure.

### Commits (merges on `main`)

- `171c46a9` — Merge Fable audit, staged plan, and T1/D4 decisions (docs/memory)
- `42f190e0` — Merge reviewer-reminder token eligibility + race fix (Tier 2)
- `aaf92cf5` — Merge abstract-save ambiguous-write reconciliation (Tier 2)

## Next Items

### Verified Open

1. **Stage 1 — the observability seam — is the next authorizable implementation.**
   Evidence: `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` Stage 1 (as
   revised 2026-08-15 after the Codex adversarial review) instruments **three**
   egress seams — `lib/services/dynamics/http.js:24`, the module-local
   `graph-service.js` transport (Graph does NOT route through the Dynamics helper),
   and `lib/dataverse/client.js` — with a versioned PII-safe event contract and an
   independent pre-auth request-correlation ALS (not the DAL context). It is the
   measurement foundation every later stage depends on. It is a draft NOT yet
   authorized to build; naming it authorizes Phase 8. Merge of branch
   `codex/claude-workbench-plan-revision` (Codex read-only review first) precedes
   any authorization.

2. **Audit follow-ups surfaced but not acted on (scope discipline):**
   - Security Operating Plan is materially drifted (~12 controls unrecorded since
     2026-05-05) — reconcile with `/sweep`.
   - `check:trust-boundary-guid` and `check:status-enum-parity` have **no CI
     backstop** (Claude-Code commit-hook only) — worth wiring into `test.yml`.
   - Untracked secret-rotation names (`UPLOADS_BLOB_RW_TOKEN`, `OPENAI_API_KEY`,
     etc.) absent from `lib/utils/tracked-secrets.js`.
   - Stale doc counts: DAL migration plan says 19 adapters (now 20);
     `CANONICAL_COUNTS.md` re-derive against 157 routes / 20 adapters / 29 migrations.

### Owner Decision Needed

1. **Authorize Stage 1 (and/or Stage 2) implementation?** Phase 8 is dormant until a
   stage is explicitly named.
2. **Campaign window / release posture** remains `[NEEDS OWNER]` — no doc states the
   active window; the restrictive posture was assumed throughout the audit.
3. **Run the 7-item read-only production-probe list?** Owner-executed (standing rule
   bars self-authorized prod Dataverse reads). Confirms current-state facts; the
   architecture verdict does not depend on it. List in
   `docs/audits/fable-current-state-evidence-2026-08-14.md`.
4. **Verifier-deselect hardening?** The token verifier checks `revoked` but not
   `wmkf_selected`, so a link minted while selected keeps working if the reviewer is
   later deselected-without-revoke. The T2 fix stops the cron from reactivating such
   links; whether deselection alone should also invalidate an existing link is a
   separate small hardening (recommendation: leave revoke and deselect distinct).

### Verify Before Acting

1. **Confirm the Tier-2 production deploy of `171c46a9` reached Ready** and scan for
   post-deploy errors on the reviewer-reminder and grantee-abstract surfaces. Two
   runtime changes shipped; `main` auto-deploys.

### Do Not Reopen Without New Decision

1. **Reviewer merge org-open access (T1)** — accepted by-design 2026-08-15. See
   `.claude-memory/project-merge-candidates-authorization-gap.md` (status: closed).
2. **Staff-wide cross-request document reads (D4)** — accepted by-design 2026-08-15.
   See `.claude-memory/project-reviewer-org-open-access-by-design.md`.
3. **The full Request Workbench Data Plane as a big-bang refactor** — the audit
   deferred it in favor of measure-first + incremental slices behind seams.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` | The Opus-reviewed staged plan; Stage 1 is next |
| `docs/audits/fable-audit-final-handoff-2026-08-14.md` | Audit decision trail and verdicts |
| `docs/audits/fable-security-audit-2026-08-14.md` | T1/T2/D1–D6 findings and dispositions |
| `.claude-memory/project-reviewer-org-open-access-by-design.md` | The org-open by-design principle (T1 + D4) |
| `lib/services/reviewer-reminder-sweep.js` | T2 fix (eligibility filter + atomic ETag PATCH) |
| `lib/services/workbench/grantee-deliverables/abstract-service.js` | Abstract-save reconciliation |

## Testing

Session 428 verification on the merged `main` tree:

```bash
npx jest tests/unit/reviewer-reminder-sweep.test.js tests/unit/reviewer-manual-reminder.test.js \
  tests/unit/reviewer-suggestion-disposition.test.js tests/unit/reviewer-thankyou-sweep.test.js \
  tests/unit/awardee-tab.test.js tests/unit/grantee-abstract-workbench-service.test.js \
  tests/unit/grantee-deliverables-abstract-route.test.js --runInBand
```

286 changed-surface tests passed; the full 34-gate CI-relevant battery was green on the
combined tree before the push.
