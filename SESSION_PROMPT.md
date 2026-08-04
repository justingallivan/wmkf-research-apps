# Session 399 Prompt: Start D0 (applicant-reviewers fixed-floor attribution)

> **Handoff, 2026-08-04 (Session 398).** Production is healthy and carries TWO
> latency increments: the S397 blob cache and S398's increment C (auth-gate
> render race + auth-status dedupe), both production-verified with all
> temporary scaffolding removed. Owner directive for this session: **start
> D0** — attribute the ~2.9s N=0 fixed floor in `applicant-reviewers` before
> sizing increment D. Run `/start` first.

## Session 398 Summary

Full-arc day: gate hygiene → measurement → agent dig → a deliberate detour
(excluded-reviewers structured-intake plan for Connor) → increment C
build/review/ship/verify/cleanup.

### What Was Completed

1. **Traffic-gated observation window VOIDED (`88cf40b1`).** Reviewer search
   runs ~twice/year (owner), so the S397 "~90d window gates Candidate B" was
   vacuous. Memory:
   `project-reviewer-find-usage-cadence-blocks-observation-windows`. Follow-on
   increments are decided on deliberate smokes, never elapsed time.
2. **Client-side measurement + dig (evidence in
   `outputs/reviewer-find-warm-revisit-step0-findings.md`, gitignored).**
   5 pre-C production loads + 3 Sonnet source agents + a GET-only Dataverse
   survey (one-off owner-authorized `DATAVERSE_ALLOW_PROD_READS=yes`,
   command-scoped). Headlines: pre-fetch gap = RequireAuth render-race auth
   waterfall (~1.1–1.35s, not script); `applicant-reviewers` dominates
   (median ~4.0s at N=4; ~2.9s fixed floor at N=0, single sample); ingestion
   critical path = 1 + 2N + 2 sequential Dataverse round-trips; slot census
   bimodal (363 zero / 207 four-five of 570 D26-window rows); exclusion text
   substantive on 43/570 (~8%), never fired on 1002903.
3. **Excluded-reviewers structured-intake plan (`766b6cd2`, routing
   `bd3bc534`).** `docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md`: new
   child entity `wmkf_appexcludedreviewer` (name/affiliation/email,
   per-request soft-block only, S210 invariants preserved); repo-side
   Phases A/B buildable without Connor's form; §6 is the Justin×Connor
   meeting agenda. Queued under dependency-bound work.
4. **Increment C SHIPPED + PRODUCTION-VERIFIED (`8a338d9d` + `a717c992` +
   `27aba5be`; main ff `912ab995 → 27aba5be`).** RequireAuth keeps children
   mounted through session resolution (the 'loading' spinner branch had been
   unmounting ProfileProvider+AppAccessProvider mid-flight, discarding the
   in-flight app-access fetch); `shared/utils/auth-enabled.js` dedupes
   `/api/auth/status` across its three fetchers. Review chain: author
   adversarial pass → Codex adversarial (1 medium CONFIRMED: non-2xx JSON
   cached as persistent auth-disabled, a regression vs the self-healing old
   inline code — fixed with regression tests). Owner Preview smoke on the
   branch alias passed; production re-measurement: gate collapsed from 2–3
   sequential rounds to ONE app-access round-trip at t≈130ms; the
   stacked-slow-app-access blowout mode is structurally eliminated. 6,790
   tests green. Cleanup COMPLETE: branch deleted local+origin; temporary
   Entra preview callback removed (owner-run, post-restore `show` returned
   exactly four URIs). Wiki: security-auth "Client auth-gate render
   contract" section.

### Commits (session, chronological)
- `88cf40b1` docs: void the traffic-gated blob-cache observation window
- `766b6cd2` docs: plan for structured excluded-reviewer intake
- `bd3bc534` docs(memory): route excluded-reviewer intake work to the plan
- `912ab995` docs: record S398 latency dig set-aside + pending decision
- `8a338d9d` fix(auth): keep children mounted through session resolution
- `a717c992` fix(auth): landing page joins the deduped auth-status lookup
- `27aba5be` fix(auth): never cache a non-2xx/invalid auth-status response
- `3dc6a1dc` docs: record increment C ship + wiki auth-gate render contract
- `8b16f0ba` docs: Entra preview callback restore verified

## Next Items

### Verified Open

1. **D0 — attribute the ~2.9s N=0 fixed floor in `applicant-reviewers`
   (owner-directed starting task).** Evidence: findings doc "Dig pass" §3 —
   a single N=0 production load (request 1003106, possibly cold) returned
   2,941ms with zero slot work; candidates for the floor: route auth guard,
   `loadModelOverrides` Dataverse read on stale 5-min cache
   (`shared/config/baseConfig.js:214`), request `getById`, runtime init.
   Evidence-only increment: a few more N=0 loads (zero-slot dashboard-visible
   request 1003106; others exist but are pre-triage) and/or one temporary
   server-side timing log. D (parallelize slot loop + skip no-op PATCH,
   ~1–2s at N=5) is sized and approved-in-principle AFTER D0's numbers.
2. **Blob-cache hazard watch (passive, open-ended).** Watch for
   `[load-proposal] blob cache` MISS anomalies or the delete-after-hit window
   in owner reports. NOT a gate for anything (cadence memory).

### Owner Decision Needed

1. **postcss moderate advisory** (Dependabot 62) — pinned under `next`;
   likely needs a `next` upgrade; tier deliberately if approved.
2. **Enrichment-cache staleness on in-place proposal updates**
   (pre-existing, Codex S397 finding). Evidence: findings doc "Separate
   backlog item"; `reviewer-search-logic.js:531-560`. Priority call.
3. **Increment E — ProfileProvider double-fetch** (new, attributed post-C):
   the second `session` response landing with the real profileId re-fires
   the init effect (dependency `session?.user?.profileId`,
   `shared/context/ProfileContext.js:456-489`); doubles
   user-profiles + user-preferences on every page. Tail cost [ASSUMED
   ~0.5–1s; not a gate-path measurement].

### Parked

1. **Candidate B (exclusion-parse cache).** Helps only the 43/570 (~8%)
   substantive-text requests; never fired on 1002903; largely obsoleted for
   new data if the structured-intake plan ships. Re-open only with a
   measured slow substantive-text case.
2. **Excluded-reviewers intake Phases A/B.** Buildable now, but field names
   should survive the Justin×Connor reconciliation meeting first
   (plan §6). Re-open trigger: owner go after (or alongside) that meeting.

### Verify Before Acting

1. **Any latency-work expansion.** Required preflight:
   `.claude-memory/feedback-latency-plan-scope-accretion-postmortem.md` and
   `project-reviewer-find-usage-cadence-blocks-observation-windows.md`;
   one increment at a time, tier-gated, deliberate smokes not soak windows.
2. **D0's zero-slot request list.** The 363 zero-slot numbers are mostly
   pre-triage (not workbench-visible); only 1003106 intersected the
   dashboard on 2026-08-04. Re-derive the intersection before measuring —
   triage state moves.

### Do Not Reopen Without New Decision

1. Reverted warm-reconciliation range `5b6757df..7072d52a` and branch
   `reviewer-find-outcome-contract` (kept for history — never
   merge/cherry-pick). Evidence: incident doc resolution section.
2. Request `1002903` mutation work — read-only absent new exact owner
   authorization. (Page views for measurement are fine — established S397/8
   protocol.)

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/workbench/applicant-reviewers-service.js` | D0/D target: ingestion service (sequential slot loop) |
| `lib/dataverse/adapters/reviewer-suggestion.js:647-762` | `ensureApplicantRecommended` — read + unconditional PATCH per slot |
| `shared/components/RequireAuth.js` | Increment C: mount-once auth gate |
| `shared/utils/auth-enabled.js` | Deduped auth-status lookup (never cache non-2xx) |
| `outputs/reviewer-find-warm-revisit-step0-findings.md` | Full evidence trail (gitignored) |
| `docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md` | Connor reconciliation plan |

## Testing

```bash
npm run check:types
npx jest tests/unit/require-auth-render-race.test.js   # increment C contract
npx jest                                               # full suite, 6,790
# Production waterfall check: signed-in load of a workbench request;
# expect ONE auth/status + ONE app-access before the data burst.
```
