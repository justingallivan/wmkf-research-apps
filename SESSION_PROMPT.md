# Session 212 Prompt: Workbench reviewer-invite — PROD SMOKE (real email) + co-PD COI follow-up

## ⏰ Standing context / guardrails (carried S197–S211)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity into docs/memory. Authoritative lint = `npx eslint . -f json` keyed on `ruleId`/`severity`, never grep over the default formatter.
- **Codex stop-time review gate is ENABLED and it WORKS.** In S211 it blocked **three** times on the invite feature and every catch was real (materials-on-invitation → caller-controlled attachment gate → server-authoritative acceptance gate). Reconcile every restatement in the same turn; verify-as-you-go.
- **Deliver Codex output VERBATIM** ([[feedback-share-codex-verbatim]]) — paste the whole `codex:codex-rescue` result in a delimited block as the *next* message; fold fixes a turn later.
- **`main` auto-deploys to prod.** All S211 work is pushed.
- **CI-green ≠ correct for async/effect/UI/outward-facing code.** Manual smoke is mandatory ([[feedback-profile-context-runtime-bugs]]). The whole reviewer-invite flow below was **NOT browser-smoked** and sends **real Dynamics email** — that's the #1 next step.
- **Local-dev auth bypass:** `AUTH_REQUIRED=false NEXTAUTH_SECRET=dev-throwaway NEXTAUTH_URL=http://localhost:3000 ./node_modules/.bin/next dev`. Under bypass `/api/app-access` returns all apps + `isSuperuser:true`; per-request paths (`?requestId=`) are email-independent.
- **Ad-hoc prod-Dataverse probes:** the `.env`/`.env.local`-loading mjs pattern (client-credentials token → OData) works read-only and (with explicit user OK) for writes. The auto-mode classifier will (correctly) pause DELETE/PATCH on prod — get explicit confirmation first.

## Session 211 Summary

**Massive reviewer-Workbench session.** Brought the in-panel search to full parity + real bibliometrics (3 commits, earlier), then `enrich-recommended`, then — after live testing on request **1002794** surfaced wrong-person enrichment + "vanishing" candidates — added a Candidates tab, real invitations, and a Scholar-disambiguation fix. ~6 commits, all pushed, **1729 tests green, 0 lint errors, build + all CI gates green**. Many Codex rounds (pre-impl + stop-gate), every catch folded.

### What was completed (this session's later half)
1. **Full search parity + real bibliometrics + ranker fix (`ef78bf9`)** — source/count/diversity/notes inputs, rich COI/mismatch cards in Claude/Database/Unverified sections, all enrichment tiers on-by-default, real h-index/citations via SerpAPI `google_scholar_author`, shared `rankByRelevance` field-fix + client re-rank.
2. **Enrich-recommended (`fe82593`)** — `/api/workbench/enrich-recommended` runs applicant-recommended reviewers through verify→COI→enrich, writes back (race-safe sidecar upsert + atomic `setMatchReason`). `model: sonnet` 404 hotfix (`0758a3b`): the endpoint + `enrich-contacts` now call `loadModelOverrides()`.
3. **Candidates tab + real invitations + Scholar disambiguation (`bd95087`)** — see below; the headline of the session's back half.

### Live-data findings on 1002794 (ground truth, via prod probes)
- The applicant submitted **rich data** for all 5 recommended (name/email/affiliation/title/expertise), not just names.
- Search results are **ephemeral until "Save"** — the "12 reviewers disappeared" was unsaved results, never persisted.
- Enrichment matched the **wrong same-named person** for 2/5 (Landsman→Harvard podiatrist, Becker→Göttingen psychiatrist). **Cleared** those 5 sidecars + reset the COI tag with explicit user OK (recommendation rows + applicant data preserved). 1002794 is a clean slate.

### `bd95087` — what shipped
- **Scholar disambiguation:** institution-in-query + keep-biased `institutionConflicts` guard (`serp-contact-service.js`); skip persisting a mismatched profile (`contact-enrichment-service.js`). 12 unit tests incl. the 4 real cases.
- **Candidates sub-tab:** `ReviewersTab` now has 5 tabs (Find→Candidates→Invite→Track→Completed); `CandidatesPanel.js` = roster from `my-candidates` with invite status. "Invite" tab still = materials (post-accept); **Candidates = invite (pre-accept)**.
- **Invitations:** `InviteEmailModal.js` → `render-emails`/`send-emails` `templateType:'invitation'` (real Dynamics email + accept/decline magic link, sets `invited`, no reviewstatus bump). Accept via external portal → flows into Invite tab.
- **Send safety (Codex, 3 rounds):** `lib/utils/reviewer-invite.js` — `shouldSkipDuplicateInvitation` (no double-send), `sendAllowsAttachments` (no fetch for invitations), and the load-bearing `recipientMayReceiveAttachments` (materials attach ONLY to `wmkf_accepted===true` recipients — server-authoritative, not caller's templateType).

### Commits
- `ef78bf9` parity + bibliometrics · `fe82593` enrich-recommended · `0758a3b` model-resolver hotfix · `bd95087` Candidates tab + invitations + disambiguation

## Potential Next Steps

### 1. ⭐ PROD SMOKE the full reviewer-invite flow on 1002794 (the parked must-do — sends REAL email)
On the deployed site, `/workbench/<1002794-guid>?tab=reviewers&sub=find`:
1. **Enrich recommended** → confirm Corkum/Weinacht/Le get correct h-index/citations and **Landsman/Becker get NO scholar metrics** (institution mismatch correctly skips the wrong person).
2. **Candidates tab** → the 5 show as "Not invited" with applicant email/affiliation; select → **Send invitation** → real email sends, they flip to "Invited — awaiting response". Re-click → no duplicate (skipped). Confirm **no proposal materials are attached** to the invitation.
3. Click the magic link → external accept → candidate appears in the **Invite** tab. Capture console/network errors.

### 2. Co-investigator COI parity in `discover.js` (small follow-up)
enrich-recommended folds `coInvestigators` into the coauthor check; the shared `discover.js` search path still checks the PI only (`proposalInfo.proposalAuthors`, normalized to PI at `reviewer-finder.js:243`). Decide whether to fold co-Is there too (shared with the standalone — re-smoke).

### 3. Grant `reviewers` to the pilot PDs + validate the dashboard tier (carried from S211)
Adding the registry key grants no one. Grant `reviewers` via `/admin` → App Access to the pilot PDs; validate `/workbench` dashboard with a real login (PD-email-gated; never smoked in prod).

### 4. Intake virus-scan EICAR e2e — STILL parked pre-cycle must-do
[[project-intake-portal-virus-scan-e2e-deferred]]. Needs deployed env + Entra applicant session. Separate track.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/reviewers/CandidatesPanel.js` | Candidates sub-tab roster + invite trigger |
| `shared/components/reviewers/InviteEmailModal.js` | Lean preview→send invitation modal |
| `lib/utils/reviewer-invite.js` | Pure send-safety helpers (dup-guard, attachment gates) — unit-tested |
| `pages/api/review-manager/send-emails.js` | `invitation` lifecycle + server-authoritative attachment gate |
| `lib/services/serp-contact-service.js` | `findScholarProfileViaGoogle` (institution-aware) + `institutionConflicts` guard |
| `pages/api/workbench/enrich-recommended.js` | Applicant-recommended verify→COI→enrich→writeback |
| `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` | §Phase 3 + S211/S212 bullets (SHIPPED) |

## Testing
```bash
npx jest                                 # 1729 tests
npx eslint . -f json                     # 0 errors (warnings don't gate)
npm run check:atlas && npm run check:api-routes && npm run check:doc-currency && npm run check:fact-consistency
./node_modules/.bin/next build
# Reviewer-invite smoke (local bypass): /workbench/<guid>?tab=reviewers&sub=candidates — but real send needs a deployed env + real Azure session.
```
