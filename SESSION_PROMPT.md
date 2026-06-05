# Session 221 Prompt: live-smoke the reviewer fixes, then merge to main

## ⚠️ Read first — work is on a BRANCH, not main
S220's reviewer-enrichment fixes live on branch **`fix/workbench-reviewer-find-enrichment`** (pushed to origin), **NOT merged to main → NOT deployed to prod.** This was deliberate: the fixes are Codex-verified + unit-green but **never exercised in the live app**. Next session: **do the live PD smoke first**, then merge to main (which auto-deploys). Don't merge blind.

To resume: `git checkout fix/workbench-reviewer-find-enrichment` (or it may already be checked out).

## ⏰ Standing context / guardrails (carried S197–S220)
- **`main` auto-deploys to prod on push.** Feature branches do NOT deploy. Commit/push only when asked. One-shot operator scripts + SQL migrations hit prod directly when run locally.
- **`rtk` is UNINSTALLED (S220).** Do NOT prefix commands with `rtk`; the global `~/.claude/RTK.md` instructions are stale. The PreToolUse hook was removed from `~/.claude/settings.json`. See [[project-rtk-grep-output-corruption]].
- **Two PreToolUse hooks still LIVE** (`.claude/settings.json`): `scope-claim-reminder.js` + `doc-edit-reconcile-reminder.js` (read the WHOLE file + grep repo + fix every instance on any docs/memory edit).
- **Local-dev hits the SAME prod Dataverse + prod Postgres.** `.env.local` has `POSTGRES_URL`, `SERP_API_KEY`, `BLOB_READ_WRITE_TOKEN`. **`CLAUDE_API_KEY` in `.env.local` was stale/401 at S220 start — Justin replaced it.** ORCID/NCBI/EXTERNAL_LINK_SECRET are "Sensitive" → empty on `vercel env pull`, hand-enter.
- **jest harness for live-pipeline repro:** Next skips `.env.local` under `NODE_ENV=test`; load it by hand in the test, and override `jest.setup.js`'s stub `CLAUDE_API_KEY='test-...'`. Restore real `fetch` via `undici` (give it a no-op `.mockClear`). Service files use extensionless ESM imports → plain `node` can't require them; run through `npx jest`. Pattern proven in S220.
- **Memory is a ROUTER.** `.claude-memory/MEMORY.md` routes "for THIS task → read these 1–3 files" (in full).

## Session 220 Summary — reviewer "search" bug → 3 real fixes (on branch)

Started on the S220 carryover #1 (reviewer-workflow validation / PD smoke of `/workbench`). Probed live state (only Justin holds the `reviewers` grant; smoke testbed = request **1002788**, lead PD Justin, real `ProjectDescription.pdf` proposal). Before smoking, Justin reported the Find-tab reviewer search "only returned the applicant's suggested reviewers." Ran the **real** analyze→discover pipeline via a jest harness: it returns **12 correct on-topic reviewers** — so the *search* works. The screenshot showed the symptom was actually the **"Enrich applicant-recommended reviewers"** flow, which exposed three real bugs. Fixed all three (Codex-reviewed twice → CLEAN):

1. **Fabricated / wrong-person emails.** Tier-3 (Claude web_search) hallucinated emails (`justin@gmail.com` for a 0-pub fake reviewer) and Tier-4 (SerpAPI) could surface a same-named stranger's address (`SarahRose888@boisestate.edu` for "Gallivan"). Added `ContactParser.isNameConsistentEmail` (name-grounding guard on both tiers) + hardened the Tier-3 prompt to forbid guessing.
2. **Wrong-person name-only match.** A bare applicant name (no affiliation) matched any same-named PubMed author. `enrich-recommended` now treats a no-affiliation + below-`probable`-resolver match as **unconfirmed** and withholds ALL match-derived fields (email/scholar/ORCID/metrics/affiliation/keywords/COI/back-prop) from the Dataverse writeback AND the card, marking `needsIdentification`.
3. **Search-vs-enrich UX.** Two near-identical dark buttons with the optional enrich on top. Reordered "Search for reviewers" to primary-first; demoted applicant-verification to a secondary outline button relabeled "Optional: verify the applicant's suggested reviewers (does NOT find new reviewers)".

Also: **uninstalled rtk** + removed its Claude Code hook (it was summarizing `npx jest` output to `PASS/FAIL`, hiding console logs).

### Commits (branch `fix/workbench-reviewer-find-enrichment`)
- `eeaf1de` - fix(workbench): guard reviewer enrichment against fabricated/wrong-person emails + name-only matches
- `762c1ec` - docs(memory): record rtk uninstall + Claude Code hook removal
- `fcdd63a` - fix(workbench): address Codex review — full unconfirmed-match gating + all-source email check
- `<probe>` - chore(scripts): add read-only reviewers-grant + smoke-state probe

## Potential Next Steps

### 1. Live PD smoke of the reviewer fixes, then merge to main (TOP)
Log in as a PD, open `/workbench/<1002788>` → Reviewers → Find. Verify: "Run reviewer search" returns ~12 real reviewers; the "Optional: verify the applicant's suggested reviewers" button is clearly secondary/below; enriching the 4 fake "Justin" reviewers no longer fabricates emails and marks the no-affiliation ones "needs identification". Then merge the branch to main (→ deploys to prod).

### 2. The ORIGINAL S220 task is still open
The reviewer-workflow validation (Find→Invite→Track→Completed walkthrough) was never completed — we found bugs at the Find step. Resume it after #1.

### 3. Consider tightening the email same-surname residual
`isNameConsistentEmail` still accepts a same-surname different person (`bgallivan@…` for "Justin Gallivan") via the bare-surname rule — documented tradeoff (defense-in-depth via identity resolver + human review). Tighten only if it bites.

### 4. Reviewer-app consolidation / other S219 carryovers
Retire legacy `reviewer-finder`/`review-manager` keys (destructive — grep first). Intake virus-scan EICAR e2e (pre-cycle must-do).

## Key Files Reference
| File | Purpose |
|------|---------|
| `lib/utils/contact-parser.js` | `isNameConsistentEmail` name-grounding email guard |
| `lib/services/contact-enrichment-service.js` | Tier-3/4 email guard + hardened web-search prompt |
| `pages/api/workbench/enrich-recommended.js` | unconfirmed-match gating of all writeback fields |
| `shared/components/reviewers/ReviewerSearchSection.js` | search-primary / enrich-secondary reorder |
| `tests/unit/contact-parser-email-consistency.test.js` | 17 cases for the email guard |
| `scripts/probe-reviewers-grant-and-smoke-state.js` | read-only: who holds `reviewers` grant + 1002788 reviewer state |

## Testing
```bash
npx jest tests/unit/contact-parser-email-consistency.test.js   # the email guard
npx jest                                                        # full suite (1,859 green at S220)
node scripts/probe-reviewers-grant-and-smoke-state.js          # live grant + smoke-state probe
```
