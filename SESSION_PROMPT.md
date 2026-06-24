# Session 282 Prompt: Acknowledgement copy + grantee cron + memory-hygiene follow-ons

## Session 281 Summary

A long, single-`main` session (no branch drift this time). Five threads landed, all pushed:

### What Was Completed

**1. Staff auth CUT OVER to `applications.wmkeck.org` (verified).**
Azure staff app registration ("WMK: SSO Authentication", client `a652a292-2574-434c-ae6f-aa01f61d82ad`)
now includes the redirect URI `…/api/auth/callback/azure-ad`, and `NEXTAUTH_URL=https://applications.wmkeck.org`
is set in Production. VERIFIED via live `/api/health` + an authenticated POST/DELETE write probe on the
branded host (sign-in + reads + writes all work; Origin CSRF check ON, pinned there). Legacy
`wmkfresearch.vercel.app` now 403s writes + funnels sign-in over. **Correction:** the prior "NEXTAUTH_URL
empty in prod" belief was a Sensitive-var `vercel env pull` artifact — runtime was always non-empty; trust
`/api/health`. Preview `NEXTAUTH_URL` removed (was wrongly set to the prod host). Commits `8776a32c`,
`bd0f3764`, `3030ecfa`. See `project-branded-domains.md`.

**2. Workbench Reviews tab BUILT** (`244073df`). `shared/components/workbench/ReviewsTab.js` reads back
submitted reviews (decoded Q1/Q3/Q10 ratings via new `labelForReviewRating` in
`lib/external/review-form-schema.js`, affiliation, received date, file download). Read-only; reuses the
existing `/api/review-manager/reviewers` GET — no new API/data layer. Tests added. Live-smoked to the empty
state (no cycle has accepted reviewers yet). Reviewers-tab 5→3 restructure also UI-smoked successfully.

**3. `AppAccessContext` bulletproofed** (`493cfb9a`). A stalled `/api/app-access` could strand every app
page on a permanent "Loading…". Now: per-attempt timeout + bounded retry + `error` state with a Retry
affordance + focus/visibility self-heal; fail-closed preserved. Regression test added.

**4. Memory/wiki staleness audit + fixes.** Ran a Codex audit (hardened prompt, after a lite-model run
produced 244 boilerplate false-positives — deleted). Real run: 26 STALE / 1243 verified / 82 NEEDS-PROBE.
Codex fixed all 26 (`c1d7cba9`); I spot-verified + a sonnet agent confirmed completeness (0 missed). Audit
report + prompts committed under `docs/audits/` (dated). Commits `04611a3f`, `d564a3fb`, `33237579`,
`31e1f6a6`.

**5. NEW gate `check:doc-symbol-refs`** (`d6c7d0a6`, hardened in `4c1314bf`). Hardens against the audit's
largest stale class: docs referencing renamed/removed code paths. Scans `.claude-memory/**` +
`docs/agent-wiki/**`, fails on any dangling `<prefix>/<…>.<ext>` path. **Primary trigger is CI-on-push**
(the breaking change is a code rename, not a doc edit); `/start` is a backstop. Codex-reviewed (caught 2
real P1s — line-wide exemption masking co-located typos + a self-test gap), Codex-fixed (per-ref windowed
exemption), I verified. 924 path refs checked, all resolve.

Plus: captured the **first-time-correctness-over-rework** working preference (`5b719c9f`); captured the
acknowledgement-text TODO (`200ca848`).

### Commits (this session — all on `main`)
- `8af0c1cd` past-tense the web-suggestions abandoned build record
- `4c1314bf` / `d6c7d0a6` check:doc-symbol-refs gate (+ Codex review-fix)
- `5b719c9f` memory: first-time-correctness-over-rework preference
- `31e1f6a6` dated memory/wiki audit artifacts
- `200ca848` TODO: finalize AI + COI acknowledgement text
- `c1d7cba9` Codex fix of 26 stale memory/wiki claims
- `d564a3fb` / `04611a3f` Codex audit + fix prompts
- `33237579` reconcile grantee auto-fill claim + classify audit report point-in-time
- `244073df` Reviews tab (read-back of submitted reviews)
- `493cfb9a` bulletproof AppAccessContext
- `3030ecfa` / `bd0f3764` / `8776a32c` staff-auth cutover to applications.wmkeck.org

## Potential Next Steps

### TODO — Finalize the AI + COI acknowledgement TEXT (owner content task)
Infra is VERIFIED already built (Dataverse `wmkf_policies` slots `reviewer-coi` + `reviewer-ai-use` →
`wmkf_policyversions`; admin `shared/components/admin/PoliciesSection.js` + `pages/api/admin/policies.js`,
superuser, versioned publish; shown to reviewers via `lib/external/policy-fetcher.js` → `PolicyAckModal` in
`Stage2aView.js`). **The published version of each slot is placeholder text** (owner-confirmed) — this is
from-scratch authoring of the real COI + AI-use copy, then Publish via the admin Policies section (it
versions, not edit-in-place; bump the version label; body ≥50 chars; markdown sanitized). No code needed.

### 1. Auto-on-award abstract cron (the one unblocked grantee item)
The grantee portal rollout polish (old #3) is mostly DONE-or-owner-blocked: the bracketed-field auto-fill I
scoped turned out ALREADY shipped (`fillInviteBody` in `shared/config/granteeInviteEmail.js`), and reminder
cadence / waiver wording / public image serving are all owner/Connor decisions. The one actionable
engineering item left: an idempotent `pages/api/cron/*` route that pre-generates abstracts for newly-`Active`
research awardees (eligibility filter `granteeResearchPrograms.js`). Optional. See `docs/GRANTEE_PORTAL_BUILD_PLAN.md` §"Open (later chunks)".

### 2. `check:build-claim-freshness` gate (memory-hygiene follow-on)
The doc-symbol-refs gate covers the renamed/removed-PATH stale class. The audit's other big class was
"not built yet / design-only / TODO" notes that shipped and were never flipped. A `build-claim-freshness`
gate would flag a "not built" assertion in a memory whose cited producer path now EXISTS. Same gate pattern
(CI-on-push primary). Scoped but unbuilt.

### 3. Reviews tab — live smoke when real review data exists
Built + tested, but only smoked to the empty state (no cycle has accepted reviewers). When a reviewer
actually submits, eyeball the populated rendering (decoded ratings + download link).

### 4. ~~Migrate new reviewer invitations to `reviews.wmkeck.org`~~ — DONE (verified S282)
Already live. The invitation link's domain has ONE producer: `buildExternalUrl` (`lib/external/token-lifecycle.js:181`)
→ `getReviewerPortalBaseUrl()` → `REVIEWER_PORTAL_BASE_URL || NEXTAUTH_URL`. `render-emails.js:165` mints links via
`mintAndStore` → `buildExternalUrl`, and `REVIEWER_PORTAL_BASE_URL` is set in Production (`vercel env ls`; value
`https://reviews.wmkeck.org` smoke-verified 2026-06-23, see `project-branded-domains.md`). No hardcoded host in any
reviewer email/link path. So new invitations already mint on `reviews.wmkeck.org`; latest-link-wins replaces any older
link on re-render. (S282 did NOT re-read the exact prod value — a full env pull was blocked; confirmed var-set + code-uses-it.)

## Key Files Reference

| File | Purpose |
|------|---------|
| `scripts/check-doc-symbol-refs.js` (+ `-self-test`) | NEW gate: dangling repo path refs in memory/wiki (CI-on-push) |
| `scripts/lib/point-in-time-files.js` | shared point-in-time-doc classifier (audit report basename registered here) |
| `shared/components/workbench/ReviewsTab.js` | Reviews tab read-back surface |
| `lib/external/review-form-schema.js` | `labelForReviewRating` decode + the Q1/Q3/Q10 schema |
| `shared/context/AppAccessContext.js` | hardened access fetch (timeout/retry/error/self-heal) |
| `shared/components/admin/PoliciesSection.js` / `pages/api/admin/policies.js` | acknowledgement (COI/AI) admin editor |
| `lib/external/policy-fetcher.js` / `shared/components/external/PolicyAckModal.js` | reviewer-facing acknowledgement display |
| `docs/audits/memory-wiki-audit-2026-06-23.md` (+ `-PROMPT`, `-fix-PROMPT`) | the audit report + the two Codex prompts |
| `docs/CREDENTIALS_RUNBOOK.md` | env contract (`NEXTAUTH_URL` now = applications.wmkeck.org) |

## Gotchas / Continuity

- **Branch discipline (shared working dir):** one git driver at a time; `git status --short --branch` before
  any commit/checkout. This session a concurrent Codex run committed to `main` cleanly (different files,
  explicit-path adds, pull-rebase). See `feedback-verify-branch-before-git-action.md`.
- **`NEXTAUTH_URL` = `https://applications.wmkeck.org`** (Production, verified). Origin CSRF check ON;
  old-host writes 403. Don't trust `vercel env pull` for it (Sensitive-var reads back `""`); use `/api/health`.
- **Working-preference (NEW):** Justin optimizes for first-time correctness over fix-later; upfront overhead
  on starts/stops/commits (gates, verification) is wanted. Bias toward prevention. `feedback-first-time-correctness-over-rework.md`.
- **`check:doc-symbol-refs` exists now** — a dangling repo path in `.claude-memory/**` or `docs/agent-wiki/**`
  fails CI. Fix the path, or annotate with a same-line removal/planned keyword or `<!-- doc-symbol-refs:ignore -->`.
- **Email copy live source is Dataverse, not code** (`wmkf_appsystemsettings` / `/admin → Email Defaults`);
  `lib/seed/email-defaults/*` is backup. `rebaseline-email-defaults.mjs --force-keys` CLOBBERS admin edits.
- **Test data parked:** request **1002788** (D26, GUID `feabe26f-dc1b-f111-8341-000d3a306da2`) was flipped to
  **Advancing** so Justin can exercise reviewer email flows in the UI (its applicant-recommended reviewers
  have self-linked emails → invites go to Justin). The applicant-recommended PROMOTE path runs NO Claude
  verification (only the AI search/discover path does) — so promoting won't be blocked. **Revert to Set-aside
  when done testing.**
- **Latest-link-wins:** reviewer email rendering with `{{externalLink}}` mints a new hash, invalidates prior links.
- **Known-red suites:** `bill.test.js` + `discovery-verification-status.test.js` only — confirm it's just
  those before chasing a "red" run.

## Testing

```bash
npm test                          # full suite (only the 2 known-red above should fail)
npm run check:doc-symbol-refs && npm run check:doc-symbol-refs:self-test   # the new gate
npm run lint
```
