---
name: project-d26-cross-visit-sentiment-ranking-study
description: Parked owner-requested study comparing D26 staff discussion sentiment (proposal and per-PD, including silence) with individual and collective proposal rankings; read-only, memo for the owner; blocked on Codex's transcript misattribution fix and owner read authorization (S615, 2026-10-17).
metadata:
  type: project
status: active
---

## Recall Rule
Read when the owner asks about site-visit takeaways "as a collection", sentiment vs ranking, or PD participation/silence in staff discussions.

Do: treat it as a one-time read-only study (scratchpad working set, memo to the owner), not a feature; use accepted, current sentiment runs and record run id + content hash per request; keep real PD names unless the owner says otherwise.
Do not: self-authorize Production reads (the owner runs probe scripts via `! …`); pull before Codex's fix for 1003020/1003038 lands and new runs are accepted; include 1003222 (ZZTEST-03 fixture).

## Study design agreed with the owner (2026-10-17, Session 615)
Three-point comparison per proposal: room sentiment (enthusiasm, reception, disagreement, uncertainty with quoted evidence) vs each PD's individual preparation preserved at reveal (combined rank, A/B/C, confidence, reviewer-score seed) vs the group starting order and final collective recommendation. Per-PD layer: participation per proposal (turns, words, timing), stance (sentiment evidence names plus an offline per-speaker pass over the discussion transcripts), and silence (present-but-silent from Zoom attendance rows in the attribution decision vs absent). Hypotheses: silent PDs stay near the reviewer seed and report lower confidence; one-voice discussions land where that voice ranked; silence clusters by PD or by proposal.

**Why:** the owner wants cycle-level takeaways for themself, possibly staff later, not the Board; sentiment was designed out of ranking (`docs/plans/PROPOSAL_RANKING_DESIGN_2026-10-07.md` §7), so the comparison is honest.

**How to apply:** when re-opened, confirm the ranking round is final (else snapshot and label), get explicit authorization for Dataverse ranking, Postgres `staff_discussion_sentiments`, and transcript/attendance reads, then build on the S615 probe approach (bind each request as the sentiment analysis does; print names, counts, times, never wording). Related: [[feedback-never-self-authorize-prod-dataverse-reads]], [[feedback-anchor-multisession-features-to-the-original-ask]].
