---
name: project-d26-cross-visit-sentiment-ranking-study
description: Parked owner-requested study comparing cycle staff discussion sentiment with individual and collective rankings; the scoped attribution cleanup is complete, but the read-only study still needs owner authorization and scope confirmation.
metadata:
  type: project
status: active
last_verified: 2026-10-18 via Session 617 production readback recorded in the discussion attribution correction brief; historical verification, not a fresh probe
---

## Recall Rule
Read when the owner asks about site-visit takeaways as a collection, sentiment versus ranking, or staff participation and silence in discussions.

Do: treat this as a one-time read-only study with a private working set and memo for the owner, not a new application feature. Use accepted, current sentiment runs and privately record source identity/content hashes for reproducibility. The existing owner preference is to retain real participant names in the private memo unless the owner changes it.

Do not: self-authorize production reads, treat completion of the correction as authorization to start the study, or include synthetic/test proposals.

## Current prerequisites — 2026-10-18

**[VERIFIED via production readback in Session 617, 2026-10-18]** The two scoped attribution corrections and their accepted current sentiment analyses are complete. This closes the earlier cleanup prerequisite; do not repeat the repair. Summary regeneration/review/publication is also complete. Historical verification is recorded in `docs/plans/DISCUSSION_MISATTRIBUTION_BRIEF_2026-10-17.md` under Current disposition; this note does not assert a fresh production readback.

**Parked / owner decision needed:** confirm read-only authorization and scope for ranking records, accepted sentiment rows, transcripts and attendance; confirm the ranking round is final (otherwise use a dated snapshot); reconfirm the memo audience before extraction. Earlier tooling/permission limitations must be checked afresh rather than assumed to still apply.

## Study design agreed in Session 615

Compare room sentiment with each participant's individual preparation preserved at reveal and with the group's starting order and final recommendation. Include participation, stance and silence, distinguishing present-but-silent from absent using attendance evidence. Possible questions include whether silent participants stay near the reviewer seed, whether one-voice discussions follow that participant's ranking, and whether silence clusters by participant or proposal.

The owner wants cycle-level takeaways for personal use first, potentially staff later, not a Board artifact. Sentiment is excluded from ranking calculations by design (`docs/plans/PROPOSAL_RANKING_DESIGN_2026-10-07.md` §7). Keep source evidence and memo private; do not publish source excerpts or operational extraction details.

The original dated design is preserved in existing repository history at `6d6fb0740:.claude-memory/project-d26-cross-visit-sentiment-ranking-study.md`; its cleanup blocker is superseded by the verified disposition above.
