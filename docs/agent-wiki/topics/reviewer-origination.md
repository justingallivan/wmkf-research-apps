---
agent_wiki: topic
status: active
last_verified: 2026-06-12
stale_after_days: 60
owner: reviewer-finder
source_files:
  - pages/api/reviewer-finder/discover.js
  - pages/api/reviewer-finder/analyze.js
  - lib/services/discovery-service.js
  - lib/services/openalex-service.js
  - lib/services/orcid-service.js
  - lib/services/pubmed-service.js
  - lib/services/deduplication-service.js
  - lib/utils/reviewer-provenance.js
canonical_docs:
  - docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md
  - docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md
  - docs/REVIEWER_FINDER.md
  - docs/APPLICATION_STATE_ATLAS.md
watch_paths:
  - pages/api/reviewer-finder/discover.js
  - pages/api/reviewer-finder/analyze.js
  - lib/services/discovery-service.js
  - lib/services/openalex-service.js
  - lib/services/orcid-service.js
  - lib/services/pubmed-service.js
  - lib/services/deduplication-service.js
  - lib/utils/reviewer-provenance.js
update_triggers:
  - reviewer origination / retrieval lane changes
  - ranking signal weight changes
  - provenance model changes
  - dedup / union-coverage behavior changes
---

# Reviewer Origination & Retrieval

Use this page before work on how reviewer candidates are *generated* — retrieval
lanes, provenance, ranking, and the recall-vs-precision posture. For who a
candidate *is* (identity, contact, COI, PI identity), use the
[Reviewer Identity](reviewer-identity.md) page instead.

## Direction (validated, mostly NOT BUILT)

- **Multi-lane origination is the validated direction (S239), not yet built.**
  Lanes: cited-DOI, PI-trail (ORCID works list), peer-groups, topic→author
  aggregation. **Coverage = union of lanes; confidence = convergence ON IDENTITY,
  not on name.** The keyword *mechanism* was the disease, not keywords per se.
  Canonical: `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md` §12; memory
  `project-reviewer-origination-multilane`.
- **Retrieval-redesign framing (S231):** demote the Claude generator to a
  field-routed retrieval/fan-out over an OpenAlex+ORCID spine, reusing the existing
  resolver + ranker. Canonical: `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`;
  memory `project-reviewer-finder-retrieval-redesign`.
- **Recall-over-precision reframe (S238):** review is a floor/gate, not a ranker.
  Optimize coverage/spread, surface-don't-silently-drop, grade COI rather than hard
  hide where policy doesn't require it. Canonical: redesign plan Part C; memory
  `project-reviewer-recall-over-precision`.
- **Forward sniff-test experiment RESULT (S246):** a pilot of the plan's forward
  decision experiment ran on 10 D26 Phase-I proposals (PD sniff test substituting
  for accept/decline). **Claude-assisted origination beat the *minimal* grounded arm**
  (OpenAlex topic→author aggregation + cited-refs) — 65% vs 35% pick-rate where
  quantified; grounded full of wrong-field/deceased/trainee candidates; it re-found
  the applicant's own recommended reviewers 1/50 vs Claude's 11/50. **Keep Claude as
  the origination spine; defer retrieval-first cutover.** Crucial precision (avoid
  overclaim): the arm that lost was a **bare** topic→author aggregation (no ORCID-works
  anchoring, no field-routed expansion), NOT the ORCID-works-anchored multilane design.
  §12 itself treats topic→author aggregation as a *valid* lane, and the OpenAlex-merge
  hazard below is specifically about an author *cluster as a named-person/PI corpus* —
  so this does NOT refute the multilane direction or that lane. Canonical:
  `docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md`; memory
  `project-reviewer-origination-experiment-result`.

## Recurring Hazards

- **Web-discovery via an ungrounded LLM was EVALUATED and ABANDONED (S230).**
  The Perplexity reviewer-agent verifiably hallucinated reviewers and affiliations.
  Do NOT re-attempt ungrounded web discovery. Memory
  `project-reviewer-web-discovery-abandoned`.
- **Ranking: recency must outweigh citations / h-index.** A high-citation but
  inactive author is the wrong pick. Memory `project-reviewer-ranking-recency-over-citations`.
- **Coverage is a union; don't silently drop.** When a lane or filter removes a
  candidate the PD might expect, surface it (excluded-summary) rather than hiding it.
  Count invariants live in memory `project-reviewer-count-invariant`.
- **Proposal-doc context is thin in Phase I (no bibliography).** Phase I under-delivers
  on signal; the next cycle combines Phase I+II with a bibliography assembled by a
  Power Automate flow. Memory `project-reviewer-finder-proposal-doc-context`.
- **OpenAlex MERGES same-name authors.** Use the ORCID works list as the corpus, not
  a name lookup. Memory `project-openalex-merge-use-orcid-works`.

## Standard Probe

```bash
rg -n "provenanceKind|coverage|union|recencyScore|h_index|citationCount|lane" lib/services lib/utils pages/api/reviewer-finder docs
```

Then read `discovery-service.js` and `discover.js` in full enough to trace lane →
dedup → ranking → provenance before changing origination behavior.
