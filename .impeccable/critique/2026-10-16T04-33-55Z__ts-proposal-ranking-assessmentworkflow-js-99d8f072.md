---
target: Proposal Ranking re-review after Oct 14-15 changes
total_score: 31
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/Users/gallivan/Code/WMKF_Apps/shared/components/proposal-ranking/AssessmentWorkflow.js"
target_fingerprint: "sha256:98cfe96e287d2724ced2da5e8399da1cfe834bf45eebfe9048c1bd96f6c3681e"
target_path: /Users/gallivan/Code/WMKF_Apps/shared/components/proposal-ranking/AssessmentWorkflow.js
timestamp: 2026-10-16T04-33-55Z
slug: ts-proposal-ranking-assessmentworkflow-js-99d8f072
---
Method: dual-agent (A: design review · B: detector + browser evidence)

Re-review of the 2026-10-13 critique after ~20 commits (Oct 14–15). Fictional memory-only rehearsal, 100-proposal/12-PD fixture; no production or hosted round.

## Prior findings status

| Prior finding | Status | Evidence |
|---|---|---|
| P1 Invalid divider positions silent | FIXED | Both: entering 99 shows a role=alert error and aria-invalid; min/max bounded by the other divider (:133-144, :526-543). Error repeats help text. |
| P1 Selected program not exposed to AT | FIXED | Both: program buttons aria-pressed (:1277); view nav aria-current="page" (:1092). |
| P1 Group decision context scrolls away | PARTLY FIXED | Per-card recommendation badges added (:496-498); sticky bar (:1330) keeps save status/Refresh. Funding total, count and East/West tally still on the divider (:243-249) and scroll away (both verified). |
| P2 Preparation next step unclear | PARTLY FIXED | Per-program status words, single changing primary action (:938-962), hint line, Needs rebuild; first card y600→y441. No per-program counts; header not sticky. |
| P2 Find silent | FIXED | Both: no-match message in aria-live region; hit focuses and highlights card; search scoped to current list (:963-980). Message off-screen after scroll; 1px highlight. |
| P2 PD comparison alignment | PARTLY FIXED | Equal-width cells (:311), but lead PD sorted first per card (:185-189) moves columns; localeCompare without numeric gives PD 1,10,11,12,2. Cards ~780px tall at 386px. |
| P2 Small touch targets | MOSTLY FIXED | Drag handles 44x44, labels/buttons min-h-11. Remaining: Refresh link 51x20; position button 32x44. |
| P2 Technical recovery wording | FIXED (source) | Outcome-based button copy (:1113-1150); one technical sentence left at :1115. |

## Design health

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 3 | Group bar sticky; preparation header scrolls away |
| 2 | Real-world match | 4 | PDs' own vocabulary |
| 3 | User control | 3 | Program buttons disable during save without reason |
| 4 | Consistency | 3 | Refresh is a link in preparation, a button in group view |
| 5 | Error prevention | 4 | Bounded dividers, missing confidence outlined |
| 6 | Recognition over recall | 2 | Total scrolls away; PD columns move per card |
| 7 | Efficiency | 3 | Find + Continue good; return trips to the top |
| 8 | Minimalist design | 3 | 50 amber "Choose one" boxes on arrival |
| 9 | Error recovery | 3 | Error duplicates help text |
| 10 | Help | 3 | Starting order and combined list unexplained |
| **Total** | | **31/40** | **Good (was 25/40)** |

Detector: CLI 0 findings. Browser scan: placeholder contrast 2.5:1 (real, minor; field is labelled); Inter-only font and em-dash separators (style preferences, not defects); text-occlusion was the browser extension's overlay (false positive).

## Priority issues

1. [P1] Keep the recommended total, count and East/West tally in the sticky group bar (sectionTotals already computed). layout.
2. [P2] Fixed PD column order on every card (lead marked by underline only) and numeric name sort. layout.
3. [P2] Sticky preparation header (status, Continue, save state), matching the group bar. layout, polish.
4. [P2] Calmer first view: neutral confidence boxes until the PD tries to finish; "0 of 50" counts per program. clarify, distill.
5. [P3] Narrow PD grid: 12 PDs make ~780px cards on a phone. adapt.

## Persona red flags

- First-time PD: 50 amber boxes read as errors; starting order unexplained; dividers first appear ~17 cards down.
- Facilitator on shared screen: total disappears while discussing lower cards; text-xs labels small at distance (inferred).
- Observer (source only): sees "All changes saved" and Refresh despite auto-update note (:1076, :1334).

## Minor observations

Empty border-t row under preparation cards; "Not sure" radio wraps at narrow width; Find message off-screen after scroll; Refresh 51x20; one technical sentence at :1115.

Not exercised: screen reader, touch, 200% zoom, network failures, Facilitate group run with a facilitator actor, observer view in browser.
