# Session 321 Prompt: Run the delegated reviewer-gating strategy review (or pick the next follow-up)

## ⇒ In flight: delegated reviewer-gating strategy review

A fresh reviewing LLM (repo access, incl. skills) has been **briefed but not yet
launched** to evaluate whether the reviewer-finder fail-closed gate system over-gates
or fires gates at the wrong stage/input, and to produce a redesign doc. **The brief is
`docs/REVIEWER_GATING_STRATEGY_REVIEW_PROMPT.md` — start there.** Its expected output is
`docs/REVIEWER_GATING_STRATEGY_REDESIGN.md` (not yet written). Launching it is the
top candidate task for S321.

## Session 320 Summary

Cause #2 (enrichment email-coverage miss) was deep-diagnosed and then handed off to a
fresh LLM for a strategy review. No code changed this session — investigation + a
delegated-review brief only.

### What Was Completed

1. **Cause #2 deep-diagnosis (live-verified).**
   - Probe (`scripts/probe-no-email-breakdown.mjs`, 120d): 482 selected reviewers, 11
     no-email (2.3%), **5 true Cause #2** (enrichment ran, no email surfaced).
   - **Corrected the prior hypothesis.** The disabled resolved-page fetch tier is NOT
     the main lever. In 4 of 5 cases a *correct* institutional email was found and then
     discarded by a gate:
     - 2× `verified_domain_contradiction` (`_validateEmailAgainstVerifiedDomain`,
       contact-enrichment-service.js:300) — the guard trusts a single OpenAlex
       last-known-institution domain. Live probe confirmed: one case is a legit
       **dual-affiliation** (OpenAlex pinned `hhmi.org`, correct email is
       `…@princeton.edu`), the other is an OpenAlex **mis-map** (pinned `calu.edu`, a
       different school; correct email is `…@seas.upenn.edu`).
     - 2× `name_mismatch` (`ContactParser.isNameConsistentEmail`) — correct email on the
       correct domain, rejected by the local-part heuristic (truncated surname /
       initials+number).
     - 1× never-fetched captured faculty page.
   - The fetch tier cannot rescue the two domain-contradiction cases even if enabled —
     its fetch is SSRF-bound to the same wrong verified domain.
   - Note: `pruneCandidateForRoster` (reviewer-search-logic.js:250) drops
     `verifiedInstitutionDomain`, so a naive roster probe shows it null even when set live.

2. **Delegated strategy-review brief authored.**
   - `docs/REVIEWER_GATING_STRATEGY_REVIEW_PROMPT.md`: pointer-based brief for a
     repo-access LLM to review all reviewer fail-closed gates for over-gating /
     mis-sequencing / wrong-input, and produce a concrete redesign.
   - Reframed the safe default (per owner): the real harm is *sending* to the wrong
     person, not *surfacing* a candidate — prefer "surface for one-click staff confirm"
     over silent-drop; confirm-before-invite (contract 3) is the true backstop.
   - Scope: redesign contracts 1/3/6/7 + the two email guards; assess-only for 2/4/5/8.
   - Pass/fail bar: recover-or-surface all 5 §3 cases without opening a send path.

3. **Docs reconciled.** `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md` Cause #2 note updated
   (5 not 8; corrected root cause; pointer to the brief).

### Commits

- `aab02a95` - docs: reconcile Cause #2 count + root cause in email-persist plan
- `2fb8efa7` - docs: brief a fresh LLM to review reviewer fail-closed gating strategy

## Next Items

### Verified Open

1. **Launch the delegated reviewer-gating strategy review.**
   Evidence: `docs/REVIEWER_GATING_STRATEGY_REVIEW_PROMPT.md` (written, not yet run).
   Hand the brief to a repo-access LLM (e.g. Codex rescue path) to produce
   `docs/REVIEWER_GATING_STRATEGY_REDESIGN.md`; then review the redesign here.

2. **B2 - enrichment-timeout partial-return.**
   Evidence: `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md` §B2;
   `lib/services/contact-enrichment-service.js:1247`. `enrichCandidates` throws on abort
   and discards enrichment already computed. Deferred reviewer-email reliability work,
   separate from the gating review.

### Owner Decision Needed

1. **Prod value of `REVIEWER_PAGE_EMAIL_TIER_ENABLED`.**
   Evidence: `vercel env ls` shows it set in Production (16d ago) but the value was NOT
   read (pulling the full prod secret file was correctly blocked). If the redesign
   depends on the fetch tier's live state, confirm true/false first (owner tells us, or
   authorize a targeted read).

2. **Whether to delete merged remote feature branches.**
   Evidence: `git ls-remote --heads origin codex/referral-seeding-build codex/program-area-normalization`
   (both still present, both merged into `main`). Keeping them is harmless; deleting is
   optional cleanup. Additive/destructive carryover — verify merged before deleting.

### Parked

1. **Spec-audit docs recovery.**
   Evidence: `.claude-memory/project-spec-audit-docs-recovery-parked.md`.
   Two design docs live only on the work computer (unpushed). Re-open ~2026-07-08 on
   that machine: push `codex/spec-audit` there, then fetch/review/merge here. Do not
   re-search local/origin first.

### Verify Before Acting

1. **Reviewer-finder metadata prompt assumptions.**
   Evidence: `pages/api/reviewer-finder/analyze.js` requires `requestId`; live probe for
   `1002916`/`1002926` (S319). If touching this path, re-check caller → route →
   `loadReviewerRequestContext` before claiming the LLM is/isn't asked to infer metadata.

2. **The line anchors in the review brief are starting points.**
   Evidence: `docs/REVIEWER_GATING_STRATEGY_REVIEW_PROMPT.md` §4 (self-flagged). Code
   moves; the reviewing LLM must confirm each `file:line` against the live file.

### Do Not Reopen Without New Decision

1. **Cause #2 is a gating problem, not a discovery problem.**
   Evidence: S320 live probes; `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md` Cause #2 note.
   Do not re-frame it as "just enable the fetch tier" — that leaves the two
   domain-contradiction cases unfixed.

2. **Claude/Codex branch collision + referral/program-area merges (S319).**
   Evidence: `main` clean; both features merged. Do not unwind or re-merge.

3. **S317 reviewer-email fixes + cron are shipped.**
   Evidence: prior commits `7212a5e2`; S319 summary. Open work is Cause #2 gating review
   and B2 only.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_GATING_STRATEGY_REVIEW_PROMPT.md` | The brief for the delegated fail-closed-gating strategy review (start here). |
| `docs/REVIEWER_GATING_STRATEGY_REDESIGN.md` | Expected output of the review (not yet written). |
| `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` | The 8 fail-closed contracts, each traced to `file:line`. |
| `lib/services/contact-enrichment-service.js` | Enrichment pipeline; `_validateEmailAgainstVerifiedDomain` (300), `_attachEmailFromResolvedPage` (1064), `_attachOpenAlexMetrics` (784), `_finalize` (1124). |
| `lib/utils/reviewer-invite.js` | `emailConfidence` / `HIGH_TRUST_EMAIL_SOURCES` (invite-confidence backstop). |
| `shared/components/reviewers/reviewer-search-logic.js` | `pruneCandidateForRoster` (drops verifiedInstitutionDomain into roster DTO). |
| `scripts/probe-no-email-breakdown.mjs` | Read-only Cause #2 population probe (classifies why each no-email reviewer missed). |
| `docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md` | The flag-gated faculty-page fetch tier design + limitations. |
| `docs/REVIEWER_EMAIL_PERSIST_FIX_PLAN.md` | S317 no-email fix plan; B2 deferred; Cause #2 note. |

## Testing

```bash
# Read-only Cause #2 population probe (needs .env.local Dynamics + Postgres creds):
node scripts/probe-no-email-breakdown.mjs 120

# Doc/gate surfaces touched this session:
npm run check:doc-symbol-refs && npm run check:docs-catalog && npm run check:doc-currency
npm run check:fact-consistency && npm run check:memory-router
```
