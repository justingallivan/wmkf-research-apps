# Session 213 Prompt: Workbench invite — PROD SMOKE (real email) + per-user email-template / signature follow-ups

## ⏰ Standing context / guardrails (carried S197–S212)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity into docs/memory. Authoritative lint = `npx eslint . -f json` keyed on `ruleId`/`severity`, never grep over the default formatter.
- **Codex stop-time review gate is ENABLED and it WORKS.** In S212 it blocked **six** times and every catch was real (stale plan counts → smoke helper attaching to a real reviewer → marker-reuse trusting corrupted state → `--person` deleting an arbitrary reviewer → smoke state file not gitignored → invite preview fetch-loop). Reconcile every restatement in the same turn; verify-as-you-go.
- **Deliver Codex output VERBATIM** ([[feedback-share-codex-verbatim]]).
- **`main` auto-deploys to prod.** All S212 work is pushed.
- **CI-green ≠ correct for async/effect/UI/outward-facing code.** Manual smoke is mandatory ([[feedback-profile-context-runtime-bugs]]). None of the S212 UI/email work was browser-smoked.
- **Local-dev auth bypass:** `AUTH_REQUIRED=false NEXTAUTH_SECRET=dev-throwaway NEXTAUTH_URL=http://localhost:3000 ./node_modules/.bin/next dev`. Both local-dev and prod hit the SAME prod Dataverse — there is NO isolated test store.
- **Ad-hoc prod-Dataverse probes/writes:** the `.env.local`-loading mjs pattern works; adapters need a `bypassDynamicsRestrictions(...)` wrapper or they fail closed ("Restrictions not initialized").

## Session 212 Summary

A long Workbench-polish + email-infrastructure session. **9 feature commits (+memory/gitignore/smoke-helper), all pushed; 0 lint errors, build clean, 135 reviewer tests green, all CI gates green.** Codex stop-gate fired 6× and every catch was folded.

### What was completed
1. **D26 allowlist test request (`bf1257b`)** — added **1002826** (out-of-consideration, lead PD = Justin, Dec-2026) as a harm-free testbed; reconciled the live-vs-historical "35→36" count references in the build plan.
2. **Candidates-tab provenance + detail (`99f8b55`, `c943c58`, `078ac27`)** — green **"Applicant-suggested"** badge (matched wording on Find + Candidates); migrated candidate **rationale / metrics / Scholar·website·ORCID links** onto the Candidates tab. **Papers stay ephemeral by design** (user-confirmed): Scholar link, not a persisted list.
3. **Click-to-edit candidate (`56e13c5`)** — click a candidate name → modal to fix name/email/affiliation/website/h-index (the assistant-email case). Edits are global to the researcher.
4. **Kebab-menu clipping fix (`fb4976c`)** — `TokenActionsMenu` now renders in a portal with fixed positioning + upward-flip (was clipped by the table's `overflow-hidden`/footer).
5. **⭐ Per-user email templates + invite timing (`1b806e9`, `1ba2418`, `308f5e6`)** — the headline:
   - **Phase A** — invitation email carries the review timeline (**respond-by / proposal-delivery / review-due**), entered in the invite modal, pre-filled from **sticky per-user defaults** (Dataverse `reviewer_invite_timing`), saved on send. Dates interpolated **client-side** (blank date drops its line; edits preserved).
   - **Phase B** — all four templates (invitation/materials/followup/thankyou) are now **per-user in Dataverse** (`reviewer_email_templates`, via `email-template-store.js`) — off browser-localStorage. New **"✎ Email templates"** editor on the Reviewers tab; InviteEmailModal + ReviewerManagePanel both source from the store.
   - Fixed a preview **fetch-loop** I introduced (memoized `suggestionIds`).
6. **Smoke-test helper (`<this session>`)** — `scripts/smoke-test-candidate.mjs` create/cleanup (GUID-keyed, marker-gated, refuses real reviewers/contacts). State file gitignored.

### Live smoke state (request 1002826 / "BioLego")
- A throwaway candidate **"ZZZ Smoke Test (DELETE)"** (`person 0d103aa6…`, `suggestion 13103aa6…`) with email **beehive.beatnik.66@icloud.com** is LIVE on 1002826, already **accepted** (in the Invite tab) with a promoted contact (`fe90752c…`).
- **Cleanup when done:** `node scripts/smoke-test-candidate.mjs cleanup` (tears down sidecar→suggestion→person→contact by recorded GUID).

### Commits
- `bf1257b` allowlist · `99f8b55`/`c943c58` badge · `078ac27` candidate detail · `fcc6303` memory · `56e13c5` edit modal · `fb4976c` kebab portal · `0ead23e` gitignore · `1b806e9` invite timing · `1ba2418` per-user templates · `308f5e6` loop fix · smoke helper

## Potential Next Steps

### 1. ⭐ PROD SMOKE the invite + email-template flow on 1002826 (the parked must-do — sends REAL email)
On the deployed site, `/workbench/48e66a0b-0d3f-f111-88b5-000d3a3064b7?tab=reviewers&sub=candidates`:
1. **"✎ Email templates"** button → edit + save a template → reopen to confirm it persisted (per-user Dataverse).
2. Invite a candidate → confirm the **review-timeline dates** appear (sticky next time), blank-date lines drop, no leaked `{{tokens}}`, edits survive date changes, **no fetch-loop** (watch the network tab).
3. Kebab menu on a Track/Invite row → confirm it's no longer clipped by the footer.
4. **When finished, run the cleanup command** above to remove the test candidate.

### 2. Per-user SIGNATURE into the Workbench invite (small follow-on)
`workbench/[requestId].js:~80` passes `settings.signature = session.profileName` (weak). Wire the real per-user signature (`SENDER_INFO` pref, as `EmailSettingsPanel` does) into the Workbench so invitations sign correctly.

### 3. Co-investigator COI parity in `discover.js` (carried from S211)
`enrich-recommended` folds `coInvestigators` into the coauthor check; the shared `discover.js` search path still checks PI only. Decide whether to fold co-Is there too (shared with the standalone — re-smoke).

### 4. Grant `reviewers` app access to pilot PDs + validate the dashboard tier (carried S211)
Adding the registry key grants no one. Grant via `/admin` → App Access; validate `/workbench` with a real PD login.

### 5. Intake virus-scan EICAR e2e — STILL parked pre-cycle must-do
[[project-intake-portal-virus-scan-e2e-deferred]]. Needs deployed env + Entra applicant session. Separate track.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/reviewers/email-template-store.js` | Per-user template defaults + Dataverse load/save (`reviewer_email_templates`) |
| `shared/components/reviewers/EmailTemplatesModal.js` | Per-user template editor ("✎ Email templates") |
| `shared/components/reviewers/InviteEmailModal.js` | Invite modal: timeline dates + sticky timing + client-side token interp |
| `shared/components/reviewers/CandidateEditModal.js` | Click-a-name candidate editor |
| `shared/components/reviewers/ReviewerManagePanel.js` | Composer sources/saves templates via the store; kebab menu portal |
| `scripts/smoke-test-candidate.mjs` | Throwaway-candidate smoke create/cleanup (GUID-keyed) |
| `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` | Build plan (D26 allowlist incl. 1002826 test row) |

## Testing
```bash
npx jest tests/unit/reviewer               # 135 reviewer tests
npx eslint . -f json                       # 0 errors (warnings don't gate)
npm run check:atlas && npm run check:api-routes && npm run check:doc-currency && npm run check:fact-consistency
./node_modules/.bin/next build
# Invite smoke (local bypass): /workbench/<guid>?tab=reviewers&sub=candidates — real send needs deployed env + real Azure session.
```
