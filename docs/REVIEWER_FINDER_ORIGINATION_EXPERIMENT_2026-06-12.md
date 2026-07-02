---
title: "Reviewer Finder Origination — Forward Sniff-Test Experiment (Result)"
domain: reviewer-identity
kind: history
status: active
summary: "docs/REVIEWER_FINDER_ORIGINATION_PLAN.md §4, for the D26 Phase-I cohort and the *minimal* grounded arm only (see §3 Scope)."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/REVIEWER_FINDER_ORIGINATION_PLAN.md
  - scripts/probe-grounded-origination.mjs
  - scripts/origination-sniff-sources.mjs
  - scripts/origination-sniff-tally.mjs
---

# Reviewer Finder Origination — Forward Sniff-Test Experiment (Result)

Date: 2026-06-12 (S246)

Status: RESULT — settles the practical direction question left OPEN by
`docs/REVIEWER_FINDER_ORIGINATION_PLAN.md` §4, for the D26 Phase-I cohort and the
*minimal* grounded arm only (see §3 Scope).

Relation to plan: this is a pilot run of the §3 forward decision experiment in
`docs/REVIEWER_FINDER_ORIGINATION_PLAN.md`, with two deliberate substitutions
(§1) — an expert sniff test in place of staff accept/decline outcomes, and a
minimal grounded arm in place of the ORCID-works-anchored design.

## 1. What was run

Cohort: **10 D26 Phase-I proposals** Justin selected as *not* going out for review
(so judgable without affecting live reviewer selection): `1002865, 1002878, 1002886,
1002902, 1002904, 1002913, 1002914, 1002967, 1002971, 1003019`. Each has a single
3-page `ProjectDescription.pdf` (Phase-I thin signal — no separate bibliography for
most). [VERIFIED via `tmp/origination-sniff/*.key.json` + probe run logs]

Three candidate arms per proposal:
- **Arm A — Claude-assisted (current production pipeline).** Track A (Claude names
  reviewers → PubMed verifies) + Track B (Claude keyword queries → PubMed/arXiv
  authors), ranked. Top 20.
- **Arm B — grounded retrieval (minimal).** G1 = OpenAlex topic→author aggregation
  over Claude's analyze facets; G2 = proposal cited-DOI → OpenAlex author
  resolution. This is a **bare** grounded arm — topic→author aggregation + cited-refs
  with **no ORCID-works anchoring and no field-routed expansion** — i.e. NOT the
  ORCID-works-anchored multilane design (§12). Be precise about the cross-references:
  §12 treats topic→author aggregation as a *valid* lane (with caveats), and
  `project-openalex-merge-use-orcid-works` warns specifically against using an OpenAlex
  author *cluster as a named person's / PI corpus* — a distinct hazard this arm does
  not invoke and that ORCID-works anchoring is what fixes. ~15–23.
- **Arm C — applicant recommended.** The applicant's own suggested reviewers from
  Dataverse `wmkf_potentialreviewer1..5` (5 per proposal). Ground truth, used for
  oracle calibration and as a recall benchmark.

Method: per-proposal candidate slate, judged by Justin (the PD) — **"would I have
picked this person as a reviewer for THIS proposal?"** (pick/no). This expert sniff
test **substitutes for the plan's accept/decline/referral outcome** (which would
take weeks of live invitations). 1002878 was judged fully **blind** (source hidden);
blinding was then dropped for the other 9 because it forced the judge to reconstruct
context by hand without payoff — they were scanned **source-labeled** with a
topic-anchored dossier (affiliation · field · active-year span) per candidate to
remove the manual-lookup burden.

Tooling (read-only w.r.t. live data; OpenAlex + 2 paid LLM calls/proposal; no
Dataverse writes): `scripts/probe-grounded-origination.mjs --blinded-sheet`,
`scripts/origination-sniff-sources.mjs` (source-labeled + dossiers),
`scripts/origination-sniff-tally.mjs` (per-arm pick-rate). Artifacts in
`tmp/origination-sniff/` (gitignored — real names + un-blinding keys stay local).

## 2. Results

**Claude-assisted (Arm A) clearly beats the minimal grounded arm (Arm B)** on
candidate quality and field-relevance, by every measure taken:

| Signal | Result |
|---|---|
| 1002878 blind sniff test (fully quantified) | Arm A **13/20 picked (65%)**; Arm B **8/23 (35%)**; Arm C **4/5 (80%)** |
| Arm-B quality flags (1002878) | 2 deceased (Zinder, Lederberg — via cited-refs), 1 retired (Feiss), 2 trainees (grad student, postdoc — via author-aggregation) |
| Qualitative scan, all 10 (Justin) | Claude pool clearly superior; grounded pool riddled with **completely unrelated fields** |
| Arm-C recall (objective, from keys) | Claude independently re-found the applicant's own recommended reviewers **11/50**; grounded **1/50** (partition of the 50: A-only 10, both 1, B-only 0, **neither 39**) |
| Oracle calibration | Justin picked **4/5 (80%)** of applicant recommendations *blind* → the sniff test is a meaningful yardstick, not noise |

**Disconfirming caveat (do not over-read the recall win):** Claude beats grounded on
applicant-recommendation recall (11 vs 1), but in **absolute** terms **39 of 50
(78%) of the applicant's own recommended reviewers were surfaced by neither arm.**
So neither origination path has strong absolute recall against the applicant's mental
model — which is itself an argument for the direction-independent **recall sampling**
and **referral capture** ships (§4), not for either arm being "good enough." [VERIFIED
via re-derivation over `tmp/origination-sniff/*.key.json`: denominator summed from
keys = 50; A∩C = 11, B∩C = 1, neither = 39, partition sums to 50]

Root cause (visible in 1002878 probe output): Claude's niche Phase-I facets, fed to
OpenAlex topic→author aggregation, hit **tiny corpora** (facet corpora 0–8 works) →
off-field noise authors; cited-reference resolution surfaces **historical/deceased**
figures (old foundational citations); author-aggregation by output count **cannot
distinguish a PI from a trainee** on the same paper.

## 3. Interpretation — what is and isn't settled

**Settled (the practical D26 question):** do **not** cut over to this grounded arm.
Keep **Claude-assisted origination as the spine.** This maps to the plan's
**"Claude-assisted wins"** decision gate (`REVIEWER_FINDER_ORIGINATION_PLAN.md`
§3 Decision Gates).

**NOT settled (the precision that matters — avoid overclaiming):**
- The grounded arm tested was a **bare, minimal** one — topic→author aggregation
  over niche Phase-I facets + cited-refs, with **no ORCID-works anchoring and no
  field-routed expansion**. The **ORCID-works-anchored multilane design** (S239,
  `REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md` §12) was **not** tested as a
  candidate source with outcomes. Be precise about the cross-references (do not
  overclaim): §12 treats topic→author aggregation as a *valid* lane for pivot
  proposals (with caveats), and `project-openalex-merge-use-orcid-works` warns
  specifically against using an OpenAlex author *cluster as a named-person/PI corpus*
  — a different thing this arm did not do. So this result does **not** refute §12's
  topic→author lane or the multilane direction; it shows that the **bare** grounded
  arm underperforms here.
- The metric is an **expert sniff test, not live accept/decline** — strong and
  internally consistent here, but a substitution.
- **Phase-I thin-signal cohort** specifically (which *is* the live D26 condition, so
  it is the right cohort for the D26 decision — but not "all proposals").
- One proposal (1002878) fully quantified + blind; the other nine qualitatively
  scanned (source-labeled).
- **Dossier-method caveat:** the source-labeled dossiers (affiliation/field/active-span,
  added to spare the judge manual lookups on the 9 scanned proposals) derive each
  candidate's field anchor from the **Arm-B OpenAlex topics**, which is **biased if Arm
  B is itself off-field.** This did not drive the headline — 1002878 was judged *blind*
  with no dossiers, and the qualitative wrong-field finding is the PD's own — but the
  dossiers are a convenience layer, not an independent signal.

## 4. Decision and next steps

Direction for D26: **keep Claude-assisted origination; defer the retrieval-first
inversion.** Invest in the **direction-independent** ships that actually help D26
(these were already direction-independent in the plan):
- **Recall sampling** — more `analyze` draws / higher candidate count (real people
  are lost to undersampling regardless of arm).
- **Referral capture** (`project-reviewer-referral-capture`).
- **SerpAPI → free-stack migration** (`project-serpapi-capability-erosion`).

If the grounded direction is revisited, it must be the **ORCID-works-anchored**
multilane build (per §12) with field-routed expansion — not *bare* topic→author
aggregation over niche facets — and ideally judged against real accept/decline
outcomes. (Topic→author aggregation remains a *valid supporting lane* per §12; what
failed here is using it bare, without ORCID-works anchoring.) This experiment does
not license cutover *against* a properly-built grounded arm, only against the minimal
one.
