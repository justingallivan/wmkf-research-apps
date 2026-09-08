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

5. **`J27:` marker convention and `scripts/check-j27-register.js`: MERGED TO `main` 2026-09-08 UTC**
   (Session 496, PR #180, merge commit `6059118a`; advisory gate + `--root`-isolated self-test,
   registered in `docs/CI_GATES_REFERENCE.md` and `/start`). Baseline 61 ok / 0 stale /
   6 unverifiable / 9 closed. All three `J27:` markers found without ids (the third,
   in `.claude/skills/start/SKILL.md`, surfaced only on plan-closeout re-run) were
   resolved 2026-09-07 and merged via PR #181 (`5cef9f85`); the memory/wiki pointer
   exit criterion is also met. §8 owner answers beyond Q0 remain open. Gate follow-ups recorded in
   register §9: prose-colon false positives, any-fragment/any-file multi-site check.
   Also merged 2026-09-08 UTC: PR #182 (`f1a5113d`) reconciling the `docs/onboarding/` decks with
   post-incident reminder behavior, the nine-tab Workbench strip, closeout honorarium disposition,
   Overview funnel, and page-level access; `python-pptx==1.0.2` pinned. Open follow-ups from its
   Codex/Opus reviews: generator↔deck parity check (owner decision). `REVIEWER_ENGAGEMENT_SPEC.md:110`
   stale hold wording and `finance-honoraria.md:41-42` stale "deployment pending" — **both resolved
   2026-09-08 on branch `claude/j27-gate-tighten`, commit `c1f4893d`.**
   **Unmerged, branch `claude/j27-gate-tighten` (2026-09-08):** the two register-§9 gate follow-ups
   above (prose-colon false positives, any-fragment/any-file multi-site check) are fixed, plus a
   site-to-fragment binding schema, STRICT UNBOUND, and full register reconciliation across four
   parallel slice agents and two Opus matrix reviews, then a Codex adversarial review found four
   more findings (row-disappearance parsing bypass, J27-023 bound to a non-fact fragment, two stale
   doc restatements), all fixed. Owner ruled 2026-09-08 on J27-023 (option 1: the shortcode-domain
   audit is not a J27 site; citation dropped, `Ev` back to SV). Gate: 59 ok / 0 stale / 6 unverifiable
   / 11 closed, 0 unbound, self-test 80/80 with `KNOWN_OWNER_PENDING` empty. **MERGED to `main`
   2026-09-08 as PR #186 (`999f4baf`)**; merging `main` first surfaced real drift from Codex PR #183
   on J27-020/J27-037 (visibility predicate moved to `shared/config/workbenchVisibility.js`), rebound
   in the same PR. Next action is the J27 build plan once Q5 lands (item 6 below).
6. **Write `docs/J27_BUILD_AND_CHANGE_PLAN.md`** once Connor's file-location decision (Q5) lands.
   Evidence: register §2 deliverables table. Sequence unchanged from the S492 prompt.
7. **Annotate the pilot passages** coupling "J27 Initial Assessment" to 2026-08-18:
   DONE 2026-09-07, merged via PR #181 (`5cef9f85`), all 4 of 4 cited sites —
   `REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` (two sites), `DATAVERSE_SHAREPOINT_FILE_MODEL.md`,
   `strategy-roadmap.md`, and memory `project-reviewer-apps-redesign-direction.md` — each now
   carries a dated `J27: J27-051` note. Register row J27-051 is `done`. Evidence: register J27-051, Q18.
8. **Smaller shared select variant** for the 54 inline/table/modal selects (optional consistency
   follow-up). Evidence: S492 survey above; owner asked for consistency but did not direct this.
   Not urgent; propose before building.

### Owner Decision Needed
1. **Combined dossier retention policy beyond the pilot.**
   Evidence: the pilot uses app-managed private storage and preserves editions. Confirm eventual
   retention duration and deletion behavior before treating that storage contract as permanent.
2. **Colleague discussion:** PD front-end flip to `Phase II Pending` as primary path (register Q8).
3. **Connor:** J27 proposal SharePoint location and filename (Q5); back-end status changes; slice G
   checklist (register §8). Connor is out as of 2026-09-08; Q5 and this item are parked until he returns.
4. **Filed, not urgent** (register §7 status line): Q1b, Q12, Q13, Q15, Q16, Q20, Q24.
5. **Dataverse attribute drops** (`wmkf_summarybloburl`, `wmkf_summarypages`) approved 2026-09-06;
   Connor-applied with its own pre-flight. Tier 0 when convenient.
6. **Final writeups header structure.** Final writeups is the only Workbench view not using the
   shared centered `PageHeader`; the other three do. Deliberate since 6A, but a consistency question
   surfaced in S492. No action unless the owner wants the four headers to match.

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
