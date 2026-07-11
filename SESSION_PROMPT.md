# Session 355 Prompt: reviewer institution→CRM linking (pending stakeholder decision), plus carryover

## Session 354 Summary

Bug-fix + design session. One product fix shipped to production; one larger
direction investigated with a read-only probe and parked pending a stakeholder
decision. No schema or API-contract changes.

### What Was Completed

1. **Decline-referral "Add as candidate" now works — one-click in-place add (`ef97fcd`, deployed to `main`/prod).**
   A PD reported the Track Reviewers "Add as candidate" button (S349) "did
   nothing." Root cause: its only action was `router.push({sub:'find'})` +
   prefill — an unreliable tab hop, with the pre-filled card below the fold.
   Replaced with an in-place add: the button POSTs the suggested name + decliner
   to the existing `/api/workbench/manual-reviewer` (no `resolution`) and stays
   on Track Reviewers. Per-row outcomes: **200** → "✓ Added" + lands on Invite
   Reviewers; **409 + `lookup`** → inline identity-confirm picker (never
   auto-resolves a namesake); **excluded/error** → inline message + Try again.
   Client-only — no route/schema/migration change; reuses the existing server
   path. New tests `tests/unit/reviewers-tab-referral-add.test.js` (3);
   eslint + `check:types` + full `npm run build` + 92 reviewer/workbench tests
   green. Wiki updated (`reviewer-workbench-lifecycle.md`).

2. **Explained the `reviewer_contact_affiliation_mismatch` System Alert** and
   investigated auto-populating reviewer institutions into the CRM. Wrote and ran
   a **read-only** probe (`scripts/probe-reviewer-affiliation-account-match.js`).
   Findings: live backlog is only **~8** alerts (all "contact has no
   institution," not conflicts); **~30%** of reported affiliations exact-match one
   Account; **~62%** aren't in Accounts at all; 120 duplicate account names; noisy
   affiliation data. Conclusion: **it's a data problem, not a matching problem.**
   Owner insight settled the architecture: research names (OpenAlex/ROR) vs
   legal/payee names (Dataverse Accounts) are **two namespaces** — resolution must
   always be against Dataverse; OpenAlex is only an alias-feeder. Direction
   **PARKED** pending a Connor + Sarah account-cleanup decision. Full detail:
   `.claude-memory/project-reviewer-affiliation-institution-linking.md`.

3. **Drafted a one-page stakeholder brief** for Connor + Sarah at
   `outputs/reviewer-institution-crm-linking-brief.md` (**note: `outputs/` is
   gitignored — this file is local-only, not in the repo**).

### Commits

- `ef97fcd` — fix(workbench): one-click in-place add for decline-referrals
- Session 354 stop/handoff commit follows this file (docs + memory).

## Next Items

### Owner Decision Needed

1. **Take the reviewer-institution→CRM linking brief to Connor + Sarah.**
   Evidence: `outputs/reviewer-institution-crm-linking-brief.md` (local),
   `.claude-memory/project-reviewer-affiliation-institution-linking.md`.
   Decide whether to canonicalize/de-dupe the Accounts table and attach a
   ROR/EIN + alias crosswalk (the "unlock" that makes reviewer→Account linking
   deterministic and reusable). Do NOT build the typeahead/cache before that.

2. Carryover from S353 — unchanged, still owner-blocked: reconcile the
   whack-a-mole recommendations; green-light (or not) the reviewer holistic
   redesign; staff manual-review rescue-tool location; reviewer closeout
   payability scope; desired end state for `check:types`.
   Evidence: prior SESSION_PROMPT history + the memories they cite.

### Verified Open (from S353, not started this session)

1. **Fix the policy-version `label_conflict` UX** without weakening immutability.
   Evidence: `lib/services/admin/policies-service.js:274-292`,
   `shared/components/admin/PoliciesSection.js`.

2. **Make session automation branch-aware.** `/start` pulls `origin/main`,
   `/stop` hard-codes `git push origin main`. Evidence:
   `.claude/skills/start/SKILL.md`, `.claude/skills/stop/SKILL.md`.

3. **Design the fail-closed Dataverse deployment-target/write interlock**
   (PLANNED, not built). Evidence:
   `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` §6.

### Parked

1. Reviewer institution→CRM linking build (typeahead/cache/account-creation) —
   re-open trigger: Connor + Sarah agree to the account-cleanup direction.
   Evidence: `.claude-memory/project-reviewer-affiliation-institution-linking.md`.
2. Prior parked items carry forward unchanged (reviewer holistic redesign branch;
   accepted-reviewer stand-down flow; review rendition formatting; campaign
   settings UX; prompt-cache-hit audit; reviewer ack provenance parity;
   Dependabot PR #53). Evidence: S353 SESSION_PROMPT history + cited memories.

### Verify Before Acting

1. **The affiliation-alert options (auto-link, free-text fill, alert-suppression)
   are DISCUSSED, not decided or built.** Nothing was written to Dataverse this
   session. Re-verify the probe numbers (`scripts/probe-reviewer-affiliation-account-match.js`)
   before quoting them — data drifts as reviewers accept.

### Do Not Reopen Without New Decision

1. **The decline-referral one-click add (`ef97fcd`) shipped and is verified**
   (tests + build). Don't rebuild it; the old prefill-to-Find prefill prop on
   `ReviewerFindPanel` is intentionally left dormant.
2. Two S353 broad reviews (whack-a-mole, holistic) remain complete — resolve
   their recommendations, don't re-run them.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/reviewers/ReviewersTab.js` | `addReferralCandidate` in-place add + per-row `referralActions` state |
| `shared/components/reviewers/ReviewerManagePanel.js` | `ReferralAction` / `ReferralConfirm` inline referral UI |
| `lib/services/workbench/manual-reviewer-service.js` | Server-side identity resolve (reused, unchanged) |
| `lib/services/alert-reviewer-affiliation-mismatch.js` | The affiliation-mismatch alert generator |
| `scripts/probe-reviewer-affiliation-account-match.js` | Read-only probe: reported affiliations vs Accounts |
| `outputs/reviewer-institution-crm-linking-brief.md` | Stakeholder brief (local-only; `outputs/` gitignored) |

## Testing

```bash
npx jest tests/unit/reviewers-tab-referral-add.test.js \
         tests/unit/reviewers-tab-stale-request.test.js \
         tests/unit/workbench-manual-reviewer-service.test.js \
         tests/unit/manual-reviewer-endpoint.test.js
npm run check:types
# Re-run the read-only affiliation probe (no writes):
node scripts/probe-reviewer-affiliation-account-match.js
```
