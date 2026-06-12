---
name: project-reviewer-origination-experiment-result
description: S246 forward sniff-test — Claude-assisted origination BEAT the minimal grounded arm on D26 Phase-I (keep Claude spine, defer retrieval-first cutover); the ORCID-works multilane design was NOT what lost, so it's not refuted.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-06-12 via S246 experiment (Justin = PD oracle, 10 D26 Phase-I proposals)
---

## Recall Rule
Read this when: deciding whether to build/cut over to grounded ("retrieval-first")
reviewer origination, or weighing Claude-assisted vs grounded candidate sources.
Pair with [[project-reviewer-origination-multilane]] and the OpenAlex-merge hazard
[[project-openalex-merge-use-orcid-works]].

## What was settled (and what wasn't)
S244 left origination direction **genuinely OPEN**. S246 ran a pilot of the plan's
§3 forward decision experiment to settle it. **Result: Claude-assisted origination
clearly beat the minimal grounded arm** on the D26 Phase-I cohort → the
"Claude-assisted wins" gate fires: **keep Claude as the origination spine; defer the
retrieval-first inversion.**

- Cohort: 10 D26 **Phase-I** proposals Justin chose (not going to real review).
- Judge: **Justin (the PD) sniff test** — "would I pick this person for THIS
  proposal?" — **substituting for live accept/decline outcomes**.
- Numbers (verified over `tmp/origination-sniff/*.key.json`): 1002878 blind —
  Claude **13/20 (65%)** vs grounded **8/23 (35%)**; grounded had 2 deceased / 1
  retired / 2 trainees. Across all 10, grounded re-found the applicant's OWN
  recommended reviewers **1/50** vs Claude **11/50** (but **39/50 found by neither** —
  both arms have weak absolute recall, which argues for recall-sampling + referral
  capture, not for either arm being "enough").

## Crucial precision (do NOT overclaim)
The grounded arm that lost was a **bare** OpenAlex topic→author aggregation +
cited-reference resolution — **no ORCID-works anchoring, no field-routed expansion**.
It was **NOT** the ORCID-works-anchored multilane design (§12 /
[[project-reviewer-origination-multilane]]). Be precise — do NOT conflate two distinct
§12 points: §12 treats topic→author aggregation as a **valid lane** (with caveats),
and the separate [[project-openalex-merge-use-orcid-works]] hazard is about using an
OpenAlex author **cluster as a named-person/PI corpus** (which this arm did not do, and
which ORCID-works anchoring fixes). So the result does **not** refute the multilane
direction or §12's topic→author lane — it only shows the *bare* arm underperforms on
this cohort. The multilane design remains validated-but-unbuilt and untested as a
candidate source with outcomes. Scope: Phase-I thin-signal cohort (the live D26 condition); sniff test
≠ accept/decline; 1 proposal fully quantified + blind, 9 qualitatively scanned.

## How to apply
- For D26: stop weighing a retrieval-first rebuild; invest in the
  **direction-independent** ships — recall sampling (more analyze draws),
  [[project-reviewer-referral-capture]], SerpAPI→free-stack
  ([[project-serpapi-capability-erosion]]).
- If grounded is revisited, build the **ORCID-works-anchored** lanes (not OpenAlex
  aggregation) and judge against **real accept/decline**, not a sniff test.
- Tooling (reusable): `scripts/probe-grounded-origination.mjs --blinded-sheet`,
  `scripts/origination-sniff-sources.mjs`, `scripts/origination-sniff-tally.mjs`.
  Full write-up: `docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md`.
