# Session 495 Prompt: Reconcile the Cycle Dossier and run a measured one-request smoke

## Session 494 Summary

This owner-present session replaced Research-only Workbench discovery assumptions with live Grant
Program scope, preserved Research as the default, and shipped the reconciled behavior to Production.
The work was built by Luna, reviewed by Terra, and orchestrated by Codex. The separate Cycle Dossier
pilot remains a draft and was not promoted.

### What Was Completed

1. **Live Grant Program scope shipped across Workbench discovery.**
   - Program choices come from Dataverse and default from the signed-in program director's newest
     assignment, with Research as the fallback.
   - Request list, Reviewer follow-up, Request Locator, search/options, exact-number hydration, and
     cache behavior now honor the selected program consistently.
   - Compact controls and meeting-date cycle choices were preserved; outside-program exact matches
     use a small acknowledgement instead of silently changing scope.
2. **Reviewer follow-up was simplified.**
   - Set Aside requests and the temporary Show set aside control were removed from this view.
   - Cycle labels show active counts only; the reviewer lens reads `Needs attention (#)` and
     `Show all (#)`, where the latter is the current non-Set-Aside request universe before search.
3. **Request list personal counts were made explicit and race-safe.**
   - The lens now reads `My requests (#)` using server-resolved program-director identity.
   - Counts remain current after triage changes and rapid program A→B→A changes cannot publish a
     stale response.
4. **Release completed.**
   - PR #183 merged to `main` as `bc699284`; its Production deployment completed successfully.
   - Signed-in Production reads confirmed Research / D26 shows 23 requests, `My requests (7)`, and
     Reviewer follow-up shows `Needs attention (6)` / `Show all (7)` with no Set Aside control.

### Commits

- `bba54eb4` — Add live broad Grant Program Workbench scope
- `56132fee` — Harden Workbench program scope review paths
- `8376fa56` — Hide set-aside requests from reviewer follow-up
- `f05cfbf1` — Show reviewer follow-up request count
- `1f522e1b` — Show Workbench personal request counts
- `ac044509` — Keep Workbench personal counts current after triage
- `5acfe4b1` — Merge current `origin/main` into the release branch
- `fd4ba598` — Document Request Quick Find metadata ownership
- `bc699284` — Merge PR #183 to `main`

## Next Items

### Verified Open

1. **Reconcile the Cycle Dossier pilot with the production program-scope contract.**
   Evidence: draft branch `origin/codex/cycle-dossier-pilot-build` still contains
   `pages/cycle-dossier.js`; PR #179 was not merged during Session 494; `origin/main` is
   `bc699284`. Inspect the current PR diff first, then merge/rebase current `main` and replace any
   dossier-specific roster or program assumptions with `program-scope-service.js` and
   `shared/config/workbenchVisibility.js` where their contracts apply.
2. **Re-run dossier verification after reconciliation.**
   Evidence: the production program filter changed after the dossier branch was built. Run focused
   dossier tests, the affected security/DAL gates, full build, and rollout preflight before any live
   generation.
3. **Run a controlled one-request dossier smoke and measure actual cost.**
   Evidence: the owner explicitly authorized a real smoke and cost measurement, but paused it for
   Workbench scope reconciliation. After items 1–2 pass, use the existing staged rollout controls
   and a single D26 request, record actual provider cost and output behavior, and preserve all
   generated editions.
4. **Make a deliberate release decision for PR #179.**
   Evidence: the Cycle Dossier remains a superuser pilot on a draft branch. Promote only after the
   reconciled build, review, and measured smoke are satisfactory.

### Owner Decision Needed

1. **Combined dossier retention policy beyond the pilot.**
   Evidence: the pilot uses app-managed private storage and preserves editions. Confirm eventual
   retention duration and deletion behavior before treating that storage contract as permanent.

### Parked

1. **Request Quick Find metadata repair.**
   Evidence: two Dataverse metadata update attempts returned HTTP 400 / `0x80040216`; readback was
   unchanged and `PublishXml` was not invoked. Do not retry or use Power Apps without a new owner
   decision.

### Verify Before Acting

1. **Concurrent worktrees.**
   Evidence: `codex/UI-audit` has an unrelated dirty `pages/workbench.js`; other checkouts include
   `codex/reviewer-ui-surfacing` and `claude/j27-gate-tighten`. Coordinate ownership and inspect
   status before touching or removing any of them.
2. **Dossier rollout configuration and candidate identity.**
   Evidence currently available: earlier work referenced rollout profile 2 and Request `1002963`.
   Re-read current source and live read-only state before using either value; do not carry them
   forward as durable configuration.

### Do Not Reopen Without New Decision

1. **Set Aside in Reviewer follow-up.**
   Evidence: the owner decided this view should never solicit reviewers for Set Aside requests;
   `8376fa56` removed both the rows and the control.
2. **Hard-coded Research-only filtering.**
   Evidence: the owner chose a reusable Grant Program selector with personal defaults because the
   suite will serve other programs; PR #183 is Production-live.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/workbench/program-scope-service.js` | Live programs and signed-in user's default program |
| `shared/config/workbenchVisibility.js` | Shared Workbench visibility and scope rules |
| `lib/services/workbench/dashboard-service.js` | Request-list loading and personal counts |
| `lib/services/workbench/request-search-service.js` | Program-scoped discovery and exact-number behavior |
| `pages/workbench.js` | Request-list controls and race-safe count state |
| `pages/workbench/reviewer-follow-up.js` | Non-Set-Aside reviewer queue and counts |
| `shared/components/workbench/RequestLocator.js` | Program-aware request search UI |
| `pages/cycle-dossier.js` | Draft Cycle Dossier pilot UI on PR #179 |
| `docs/atlas/dataverse-akoya-request.md` | Dataverse request and saved-query ownership notes |

## Testing

Session 494 passed 10 affected suites / 193 tests, targeted ESLint with 0 errors (2 existing effect
warnings), `npm run build`, `npm run check:agent-invariants`, and the Atlas/docs gates. PR #183 CI
passed the full Jest job, Playwright, Claude review, Semgrep, Gitleaks, Trivy, and Vercel.

```bash
npm test -- --runInBand --watch=false --testPathPatterns "workbench|reviewer-follow-up|request-search"
npm run check:agent-invariants
npm run check:atlas
npm run build
```

## Handoff and Milestone Determination

Milestone entry added to `DEVELOPMENT_LOG.md`: "Workbench discovery gains live Grant Program scope
(Session 494)." The claim-evidence report was unavailable because local observation state could not
be read, so no pilot row was added.
