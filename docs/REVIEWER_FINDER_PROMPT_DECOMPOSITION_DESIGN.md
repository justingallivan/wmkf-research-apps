# Reviewer-Finder: Field Primer + Prompt-Decomposition — Design Sketch

> **Status:** DRAFT / iterating (S237). Not built. **This EXTENDS — does not duplicate —
> `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`**, which already specifies the
> retrieval-first decomposition (Stage 0 extract-&-plan with *no parametric names*,
> field-routed retrieval, the hypothesis-builder/mosaic layer, the provenance model,
> typed failure outcomes, COI parity, and a shadow-run-before-cutover). The **new**
> contribution here is the **field primer** and the decision to **pre-compute it
> asynchronously at submission**. Codex pre-impl review (S237) folded in.

## What's already decided (in the redesign plan — reuse, don't re-spec)

`REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` already covers the decomposition itself:
- **Stage 0** — Claude extracts topical facts + `grantScreening` + `proposalPeople` +
  `referenceIds` + `sourcePlan` + `qualityChecks`, **no background-knowledge candidate
  names**; identity facts (PI/institution) come from Dataverse (§4.1, §4.4).
- **Stage 1** — candidates *originate from grounded retrieval*, field-routed (§4.1).
- **Stage 2** — hypothesis-builder/mosaic clusters author-instances → person hypotheses (§4.3).
- **Stage 3** — adjudicate via `ReviewerIdentityResolver` + recency rank (§4.1, §4.3).
- Typed failures (`analysis_invalid`, `reviewers_not_required`, `retrieval_failed`),
  COI parity across lanes, structured-JSON output + retry/repair, fan-out time budgets,
  prompt rewrite, and §7 sequencing incl. a shadow run.

**My earlier sketch's "Step 2 = reviewer suggestion" was wrong** (Codex): if it means Claude
*names people*, it contradicts the retrieval-first rule. Candidates must originate from
retrieval; Claude parametric names are **barred or grounded-seed-only (ground-or-drop)**.
Treat that decomposition as settled by the plan; this doc only adds the primer + staging.

## The new piece: the field primer

**Intent.** Start from Claude's knowledge, then point it at the wider internet and have it
write a **structured, cited review of the research field** for a proposal: what the field is,
its sub-areas, key methods, current frontiers/open questions, the landscape of active
research communities, and notable venues — each claim tied to a real, resolvable source.

**Two roles:**
1. **Standalone PD deliverable.** A non-specialist program director gets an orienting field
   map — valuable *on its own*, even when reviewer yield is thin (e.g. a thin Phase-I
   narrative, or a proposal whose best peers were all self-excluded). Degrades gracefully.
2. **Scaffold** for the redesign's Stage 0/1: its sub-areas/methods/venues become inputs to
   the **`sourcePlan`** and field-routing and to query seeds — *not* a candidate source.

**KEY DECISION — pre-compute it asynchronously at submission (latency non-issue).**
The primer is generated **soon after proposal submission**, as a **standalone, cached,
durable artifact** — NOT part of the synchronous reviewer-finder run. This removes it from
the latency budget entirely (Codex's top concern; the synchronous path is already ~50s+50s
before enrichment per `project-serpapi-budget-latency`). When a PD later runs discovery, the
primer is already there to read and to seed Stage 0/1.

## The hard boundary — the primer can NOT create candidates (Codex: non-negotiable)

The real risk isn't only "the primer names someone and we treat them as a candidate." It's
**framing contamination**: the web-sourced primer frames the field around certain
communities/people, then a downstream prompt regenerates the same fabricated-affiliation
failure through that framing, and grounded verification confirms the nearest real namesake
(the exact failure class in the redesign plan §1, §5.1, and `project-reviewer-web-discovery-abandoned`).

So the boundary is **machine-readable and code-enforced**, not prose:
- Primer output is partitioned into:
  - **`fieldMap`** — `subAreas[]`, `methods[]`, `frontiers[]`, `venues[]`, `searchTerms[]`.
    These may seed `sourcePlan` / queries (they carry no person identity).
  - **`unverifiedLeads[]`** — any named groups/people, each with its provenance URL and a
    flag. A lead is *never* a candidate field.
- **Only the grounded lanes** (cited-reference / literature-retrieved → hypothesis-builder →
  resolver, per the plan) may create candidate **identity / affiliation / contact /
  eligibility** fields. A primer lead may at most become a *grounded-seed query* that must
  ground-or-drop through PubMed/ORCID/OpenAlex — affiliation/contact always from the verified
  record, never the primer.
- The primer's prose is **never** the source of an email, affiliation, or "confirmed" reviewer.

**Citations ≠ grounding.** Web content is UNTRUSTED (A7) — wrap it. Treat each citation as a
claim to validate (URL resolves, source is the type claimed, claim is supported), and never
let a citation become identity evidence.

## Staging (your "smaller steps / more focused tasks")

The primer is itself one **decoupled** stage; break it further so each task is small:
- **P1 — knowledge draft:** Claude writes a structured field map from its own knowledge (no web).
- **P2 — web-grounded revision:** web search → revise/cite the field map; emit `fieldMap`.
- **P3 — leads partition:** extract any named groups/people into `unverifiedLeads[]` with URLs
  (kept strictly out of `fieldMap`).
Each is independently promptable/versionable. The synchronous decomposition (Stage 0–3)
follows the plan's §7 sequencing; the primer slots in *ahead of and beside* it as a cached input.

## Open decisions (primer-specific — add to the plan's §8 open items)

1. **Web tooling:** Claude-native web search vs a separate retrieval layer (the abandoned attempt
   used Perplexity `sonar` *for reviewers* — a different, higher-risk use).
2. **Primer scope:** people-agnostic field map only, vs the partitioned `unverifiedLeads[]`
   above. Recommend the partition (keeps leads, enforces the boundary structurally).
3. **Caching / scope / freshness:** request-scoped? proposal-version-scoped? regenerate on
   resubmission? where stored (Blob? Dataverse?)?
4. **PD UX:** present it explicitly as an *orienting field review, not verified reviewer
   evidence* — mirroring the old web panel's deliberate isolation from ranking/COI/save.
5. **Prompt-version migration:** new prompt names (`reviewer-finder.field-primer.*`,
   `reviewer-finder.extract`, …) break the resolver/override/validator wiring keyed to
   `reviewer-finder.analyze`/`.score-candidates` — plan names, validators, fallbacks, and
   stale-override handling up front.
6. **Evaluation before build:** does a people-agnostic primer measurably improve Stage-0/1
   `sourcePlan`/query quality (yield, false-affiliation rate, field coverage) in a shadow run?
   Is the primer itself useful to PDs (acceptance/usefulness)? Define metrics first.

## First step (de-risk — Codex + plan §7.7)

A **shadow, non-candidate-producing prototype** on a small set of prior proposals: structured
extraction + **people-agnostic** primer + query/`sourcePlan` generation → feed **only the
generated queries** into the existing retrieval → compare yield / latency / false-positives
against the current path. **Do not** prototype "primer names people" first — that tests the most
dangerous behavior before the safe scaffold is proven. Pair with rebuilding the parameterized
analyze-evaluation harness the plan calls for (§Artifacts).

## Relationship to existing work
Extends `REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` (the decomposition + hypothesis layer +
typed failures + sequencing). Respects `project-reviewer-web-discovery-abandoned` (web stays out
of naming/verification; enforced by the machine-readable boundary). Pairs with
`project-reviewer-finder-proposal-doc-context` (the PA-assembled doc improves the *input*; the
primer + decomposition improve how we *use* it). Aligns with `project-reviewer-finder-retrieval-redesign`.
