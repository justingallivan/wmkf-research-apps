# Session 218 Prompt: Land PR4 (reviewer self-report ORCID) after Codex e2e — or new features

## ⏰ Standing context / guardrails (carried S197–S217)
- **`main` auto-deploys to prod on push.** Commit/push only when asked. Feature branches do NOT deploy — use one for anything that touches a live prod-write path, smoke it, then merge.
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`) + a PreToolUse reminder on durable-doc scope claims. Run the *disconfirming* query before asserting scope/quantity; derive denominators independently. (S217: the 162/1,533 backfill counts came straight from the live `--summary` and sum to the denominator.)
- **Codex via the RESCUE PATH works well** — `Agent(subagent_type: 'codex:codex-rescue')`. S217 ran clean pre-impl + adversarial passes on PR1/PR4 and caught real bugs (PR4: a fail-open guard, a confirm-without-edit miss, a honorarium-ordering strand). **Codex has no outbound network** — feed it captured data / point it at in-repo files, tell it not to fetch. Deliver Codex output VERBATIM ([[feedback-share-codex-verbatim]]).
- **CI-green ≠ correct for async/effect/UI/external-write paths.** Manual or scripted smoke is mandatory ([[feedback-profile-context-runtime-bugs]]). S217 live-smoked PR1's write (1 write + verify) before the bulk apply.
- **Local-dev hits the SAME prod Dataverse** — no isolated test store. `AUTH_REQUIRED=false NEXTAUTH_SECRET=dev-throwaway NEXTAUTH_URL=http://localhost:3000 ./node_modules/.bin/next dev`. Ad-hoc prod probes/writes: the `.env.local`-loading script pattern + `bypassDynamicsRestrictions(...)`. `queryAllRecords` caps at 5000.
- **ORCID/NCBI + EXTERNAL_LINK_SECRET are "Sensitive" in Vercel** → `vercel env pull` returns them EMPTY; hand-enter in `.env.local` ([[project-vercel-sensitive-env-pull-empty]]). For local reviewer-flow e2e, `EXTERNAL_LINK_SECRET` can be ANY 32+ char throwaway (minted + verified by the same local env).

## Session 217 Summary

Shipped the **reviewer ORCID back-propagation** work end-to-end to prod, plus two carried reviewer follow-ons and an ORCID search hardening. Built PR4 (reviewer self-report capture) on a branch and **handed its e2e to Codex** so we can move to new features.

### Shipped to `main` (deployed)
1. **PR1 — runtime forward-flow** (`a25bda2`): ORCID flows onto the matched `contact.wmkf_orcid` on every send/accept/enrich. Centralized `orcid-normalize` (mod-11-2) + `setOrcidIfAbsent` (fill-only, conflict-surfacing, conditional If-Match) + shared `backPropReviewerOrcidToContact`. Codex: 2 design passes + an adversarial impl pass (tightened 412 detection).
2. **PR2 — historical backfill, RAN** (`0c75ec9`): `scripts/backfill-contact-orcid.js`. Live counts matched the projection exactly — **162 write / 0 conflict / 0 malformed**, all verified by `(contactId, reviewerId)`, 0 failures. Contact ORCID population **~423 → ~585**.
3. **S213 follow-ons** (`ee689e8`): co-PI COI parity in `discover.js` (shared `lib/utils/proposal-authors.js`) + per-user Workbench invite signature (reads `SENDER_INFO`).
4. **ORCID SOLR-injection fix** (`87a84ad`): special-char reviewer names (hyphens, parens, `<>`) no longer 500 `searchByName`.
5. **Docs** (`cfc7c04`): design §12 marked PR1/PR2 shipped; PR3 (intake reviewer-capture) documented as blocked-on-Connor with a day-one wiring note.

### Built on a branch — `feature/reviewer-self-reported-orcid` (NOT merged; pushed)
6. **PR4 — reviewer self-reported ORCID capture** (`c5e0ec0`): the reviewer confirms their OWN ORCID on the Stage 2a accept/decline form → captured onto person + contact. Persisted as a **sticky `confirmed`** status (the resolver never emits `confirmed`, so `writeIdentityDecision`/`clearIdentityFields` refuse to downgrade/clear it — fail-closed). Codex adversarial pass folded (4 findings). 1842 tests, build clean.
7. **PR4 e2e handoff** (`c58d7b3`): `docs/REVIEWER_SELF_REPORT_ORCID_E2E_HANDOFF.md` + `scripts/pr4-e2e-{setup,verify,cleanup}.js` — handed to Codex to build the automated e2e suite.

## Potential Next Steps

### 1. ⭐ Land PR4 once Codex's e2e is green
Codex is developing the e2e for `feature/reviewer-self-reported-orcid` (handoff doc + scaffolding scripts on the branch). When it passes: review Codex's e2e work, run it (or confirm Codex's run), then **merge the branch to `main`** (fast-forward off `cfc7c04`). After merge, add a memory entry for the **sticky-`confirmed` invariant** (a future resolver change could violate it) — held until merge so it's not recorded for unshipped code.

### 2. Carried reviewer follow-ons (operator / live-session work — not code)
- Grant `reviewers` app access to pilot PDs + validate `/workbench` with a real PD login (runtime admin in `/admin` → `wmkf_appuserappaccesses`).
- **Intake virus-scan EICAR e2e** — STILL parked pre-cycle must-do ([[project-intake-portal-virus-scan-e2e-deferred]]); needs deployed env + Entra applicant session.

### 3. ORCID capture residual (from S215)
Lone-ORCID + clean-Scholar (~4.4%) — a second backfill pass running Scholar would catch them (SerpAPI cost), or let normal enrichment pick them up. Operational/cost decision, not code.

### 4. PR3 — intake reviewer-capture (blocked, future)
Carry ORCID through the intake-portal applicant-suggested-reviewer capture. BLOCKED: that capture form doesn't exist (intake `submit.js` ships only budget_lines; persons parked behind Connor; reviewers not on the list). Day-one ORCID wiring is documented in design §12 PR3 + memory [[project-intake-portal-reviewer-capture]]. Defer until the capture feature is built.

### 5. New features
Everything above is finish-work or blocked. Open to new capability work — see the roadmap memories ([[project-app-roadmap-2026-04-25]], [[project-staged-review-pipeline]], [[project-proposal-context-extraction]]).

## Key Files Reference
| File | Purpose |
|------|---------|
| `docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md` | §12 PR1/PR2 (shipped), §13 Codex, §14 PR4 (reviewer self-report + sticky-confirmed) |
| `docs/REVIEWER_SELF_REPORT_ORCID_E2E_HANDOFF.md` | Codex's e2e brief for PR4 (on the PR4 branch) |
| `lib/services/backprop-reviewer-orcid.js` · `lib/dataverse/adapters/contact.js` | shared back-prop helper + `setOrcidIfAbsent`/`resolveForBackprop` |
| `lib/utils/orcid-normalize.js` | centralized normalizer + mod-11-2 checksum |
| `scripts/backfill-contact-orcid.js` | PR2 backfill (resolve/summary/apply/verify) — already run |
| `lib/services/capture-self-reported-orcid.js` · `lib/dataverse/adapters/researcher.js` | PR4 service + the sticky-`confirmed` guards (on the PR4 branch) |
| `scripts/pr4-e2e-{setup,verify,cleanup}.js` | PR4 e2e scaffolding (on the PR4 branch) |

## Testing
```bash
npx jest                                    # full suite (eslint is CI-only, not local)
node --check <file>.js                       # syntax
npm run check:atlas && npm run check:api-routes && npm run check:fact-consistency && npm run check:doc-currency
# PR4 e2e (after Codex builds it): see docs/REVIEWER_SELF_REPORT_ORCID_E2E_HANDOFF.md
git checkout feature/reviewer-self-reported-orcid   # PR4 work lives here until merged
```
