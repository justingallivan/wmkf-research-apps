# Workbench Onboarding Decks

Two PowerPoint onboarding decks for the **Request Workbench**, generated from a single
script so they stay in sync and can be regenerated when the UI changes.

| File | Audience | Slides |
|---|---|---|
| `Workbench_Onboarding_PD.pptx` | Program Directors — task/workflow voice | ~33 |
| `Workbench_Onboarding_Technical.pptx` | Engineers (Connor) — same spine + implementation detail | ~31 |
| `build_workbench_decks.py` | The generator for both decks | — |

**Status: DRAFT v1** (marked on both title slides). Text-only — screenshots are a parked
follow-up (see below).

## Shared step spine

Both decks walk the **same 15-step spine in the same order**, so "Step 8" means the same
thing in each. The decks diverge only in the depth layer under each step (PD = what you do;
Technical = what's under the hood).

1. What the Workbench is
2. Getting in & opening a request
3. The tab strip
4. Overview tab — the command center
5. Proposal tab
6. Reviewers · Find
7. Reviewers · Invite Reviewers
8. Campaign settings
9. Sending the invitation
10. What the reviewer sees (external portal)
11. Reviewers · Track Reviewers
12. Quota & winding down
13. Reviewers · Track Reviewers (completion)
14. Status tab
15. Awardee tab — grantee deliverables

## Regenerating the decks

The script uses [`python-pptx`](https://python-pptx.readthedocs.io/), which is **not** a
project dependency. Use a throwaway venv:

```bash
python3 -m venv /tmp/pptxvenv
/tmp/pptxvenv/bin/pip install python-pptx
/tmp/pptxvenv/bin/python docs/onboarding/build_workbench_decks.py
```

The script writes both `.pptx` files next to itself (in `docs/onboarding/`), overwriting in
place. Close the files in PowerPoint first, or the write can collide with the open session.

## Grounding / source of truth

Deck content was read from source during the authoring session (S277), not memory; refreshed
2026-09-01 for the reviewer-reminder incident hold as well as the S280 3-sub-tab collapse
(Find · Invite Reviewers · Track Reviewers) and the now-live Reviews tab:

- Shell + tab strip: `pages/workbench/[requestId].js` — live tabs are **Overview, Proposal,
  Reviewers, Reviews, Status, Awardee**; the other four lifecycle tabs render a "coming in a later
  update" card.
- Reviewers sub-tabs: `shared/components/reviewers/ReviewersTab.js` — Find · Invite
  Reviewers · Track Reviewers (collapsed S280 from 5: Find · Candidates · Invite · Track ·
  Completed).
- Tab components: `OverviewTab.js`, `ProposalTab.js`, `ReviewsTab.js`, `StatusTab.js`, `AwardeeTab.js`.
- Reviewer engagement (campaign config, reminders, token TTL, quota, withdraw):
  `docs/REVIEWER_ENGAGEMENT_SPEC.md` (Phases 1, 2, and 4 live; Phase 3 mechanism
  implemented but its Vercel schedule paused 2026-09-01) and the
  `docs/atlas/dataverse-*` pages.

When Workbench behavior changes, update the spec / Atlas / agent-wiki first, then regenerate
these decks so they don't drift.

## Parked follow-up — screenshots

The PD deck is text-only. To add screenshots we chose **synthetic / mocked** capture (no real
grantee/PI/reviewer PII; deterministic; re-runnable) over driving real production data. Plan
when resumed:

1. Extend the safe rehearsal harness (`scripts/rehearse-pd-invite-browser.mjs` + Playwright)
   to mock the not-yet-covered tab endpoints — Overview (`/api/workbench/reviewer-rollup`),
   Proposal (`/api/workbench/proposal-documents`), Status, Awardee
   (`/api/workbench/grantee-deliverables/*`). The Reviewers→Invite Reviewers flow and the reviewer
   portal are already mocked.
2. Navigate each tab/sub-tab and capture PNGs.
3. Replace the text-only step slides in the PD deck with screenshot + caption (decide whether
   the technical deck gets the same images).
