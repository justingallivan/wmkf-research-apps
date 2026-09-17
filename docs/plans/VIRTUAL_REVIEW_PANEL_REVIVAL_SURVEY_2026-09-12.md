---
title: Virtual Review Panel Revival — Survey and Build Direction (2026-09-12)
domain: virtual-review-panel
kind: plan
status: proposal
summary: "What the original VRP did, which of its uploads the platform now supplies internally, and a proposed admin-only rebuild on the Cycle Dossier scaffolding. Decisions D1–D6 were made 2026-09-12; see the Phase A build plan, which supersedes §3, §5 and §6 here."
cataloged: 2026-09-12
owner: product-engineering
last_verified: 2026-09-17
related:
  - docs/VIRTUAL_REVIEW_PANEL.md
  - docs/CYCLE_DOSSIER_PILOT_DESIGN.md
  - docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md
  - docs/EXECUTOR_CONTRACT.md
  - lib/services/panel-review-service.js
  - lib/services/cycle-dossier-generation.js
---

# Virtual Review Panel Revival — Survey and Build Direction

> Survey, not a commitment. Every claim about the current code is `[VERIFIED 2026-09-12 via source]`
> unless labelled otherwise; the build direction is `[PROPOSED]`. Owner asked for an admin-only
> feature "like the dossier".

## 1. What the original VRP does today

**Flow** (`pages/virtual-review-panel.js`): upload one proposal PDF → tick at least two "LLM
reviewers" (Claude, GPT, Gemini, Perplexity; greyed when no key) → optional Stage 0 intelligence
pass, Stage 1 claim verification, devil's advocate → "Run Virtual Review Panel" → live progress
via SSE → results: rating matrix, panel summary, devil's advocate review, individual reviewer
assessments, claim-verification details, cost breakdown → export Markdown or DOCX.

**Inputs:** exactly one PDF, text-extracted server-side with `pdf-parse` (`pages/api/virtual-review-panel.js:94-149`);
provider list and the three stage toggles. No personas, no reviewer count, no rubric upload: the
rubric is the WMKF reviewer form hard-coded in `shared/config/prompts/virtual-review-panel.js:418-432`.

**AI design** (`lib/services/panel-review-service.js`): "panelists" are distinct vendors given the
same system prompt ("thoughtful scientific peer reviewer for the W. M. Keck Foundation", :34), run
in parallel (`Promise.allSettled`, :362). Stage 0 extracts claims with Claude Haiku, searches
literature (`LiteratureSearchService`), collates with Claude; Stage 1 verifies claims per provider
(Perplexity gets a search-enabled prompt); Stage 2 writes the structured review per provider with
impact/risk/overall ratings plus narratives, validated against
`shared/config/virtual-review-panel-output-schema.js`; devil's advocate is one provider chosen at
random (:508); synthesis is Claude as "chair" (:633) producing `ratingMatrix`, `consensus`,
`disagreements`, `keyStrengths`, `keyConcerns`, `questionsForPI`, `resolvableVsFundamental`,
`claimVerificationHighlights`, `devilsAdvocateSummary`, `panelRecommendation`, `confidenceNote`.
There is no discussion round between reviewers; the debate design (Optimist/Skeptic/Arbiter) is a
wishlist item only (`docs/WISHLIST.md:226-236`).

**Persistence:** Postgres `panel_reviews` / `panel_review_items` (migration 003), proposal text kept
only as a SHA-256; 35 runs and 278 items exist (`docs/atlas/postgres-infra-tables.md:118`). No
Dataverse writes. `getPanelReviewHistory` exists with no caller: results are not retrievable in
the UI after the session.

**Governance gap:** it does not use the Executor. All calls go through `MultiLLMService` with its own
fetches and its own usage logging (`multi-llm-service.js:276-402`), outside prompt-store
governance, `promptSnapshot`, the A7 payload boundary, budgets, and the `wmkf_ai_run` audit trail
(`docs/STRATEGY.md:128` lists it as a "direct LLM path"). Model choice is asymmetric: synthesis
resolves through `getModelForApp`, provider stages through `MultiLLMService.getDefaultModel`.

**Status:** live in the registry (category phase-ii), admin-assigned only, not deprecated anywhere;
`VRP_ALLOWED_PROVIDERS` must include `claude` and production fails closed without it. Last
VRP-specific change 2026-05-22 (A7 hardening).

## 2. What the platform now supplies without an upload

| Original input | Internal source today | Resolver | Gap |
|---|---|---|---|
| Proposal PDF text | `AI Materials/ProposalNarrative_{n}.pdf`, identity-pinned, hashed, 100k-char bound | `prepareRequestInput` → `getAiProposalNarrativeText` (`cycle-dossier-generation.js:75-115`; `workbench-proposal-documents.js:264-270`) | none |
| Bibliography / materials | `AI Materials` companion text | `getAiProposalMaterialsText` (`workbench-proposal-documents.js:278-290`) | none |
| Phase I documents (project description, biosketches, budget PDF, budget xlsx) | request folder slots (`shared/config/workbenchProposalDocuments.js:20-25`) | listing/download only; full reviewer package via `loadProposal` (`reviewer-finder/load-proposal-service.js:103`) | **no text resolvers** for biosketches or budget; structured budget lines exist via `proposal-budget-line.js` adapter |
| "Other information as context" | four allowlisted `akoya_request` AI memos, 10k chars each: fit rationale, summary, data extract, field primer | `parseAiContext` (`cycle-dossier-generation.js:66-72`) | none |
| — (new) | review synthesis JSON, submitted human reviews (11-question form) with reviewer affiliations | `loadReviewSynthesisContext` (`synthesize-reviews-service.js:156-197`), `getReviewers` (`reviewers-service.js:180`) | none, but see decision D3 |
| — (new) | Initial Assessment DOCX, Final Writeup, pre-site core memos | identity readers exist; **no text extraction** for the DOCX bytes | resolvers needed if used |
| — (new) | Cycle Dossier entry (five-section briefing with retrieved literature) | `cycle_dossier_entries` payload via `readDossierJSON` | none; shared across superusers |

## 3. Proposed rebuild `[PROPOSED]`

**Shape:** a request-scoped, admin-only app on the Cycle Dossier scaffolding. Pick requests from the
same server-scoped roster; the server resolves every input; nothing is uploaded. Each run produces a
panel report per request (DOCX + PDF) in the private Blob store and, optionally, the request's
`AI Artifacts/Virtual Review Panel/` SharePoint folder, mirroring the dossier's publication and
structural verification.

**Panel composition:** personas on the governed Claude Executor rather than vendor diversity:
- three reviewer personas (e.g. disciplinary expert, methodologist/feasibility, translational impact),
  each a governed prompt row with the WMKF reviewer form as its output schema, run blind to each other;
- one devil's advocate prompt (strongest case not to fund), deterministic not random;
- one chair prompt producing the existing synthesis shape (rating matrix, consensus, disagreements,
  questions for PI, resolvable vs fundamental, recommendation, confidence note).
Persona diversity can also come from tier and effort (Fable for the chair, Opus for reviewers, a
Sonnet skeptic) since the tier picker now includes Fable. Multi-vendor is deferred (D1).

**Claim verification:** reuse the dossier's research stage as-is (research-plan prompt → OpenAlex +
PubMed retrieval → bounded evidence) and hand the evidence to every reviewer, replacing the old
Stage 0/1 and Perplexity dependence. Same cost profile as a dossier entry (~$0.09 per plan call).

**Governance and operations, all reused from the dossier:** rollout gates (`*_ENABLED`, durable
operator stop, request allowlist, smoke→pilot), governed prompt seeds with `snapshotConfiguration`
pinning prompt rows + budgets + pricing per run, `executePrompt` with `promptSnapshot`,
`requireNoPersistence`, `deadlineMs`, `signal`; A7 boundary on every proposal variable; worker lease +
drain cron with per-stage checkpoints (the dossier cadence changed from per-minute to every five
minutes in the 2026-09-16 ops decision); entry-timeout budget in the executor-budgets
registry; per-call `api_usage_log`; cost estimate + optional cap; plain-language failure copy;
superuser gate via `requireAppAccess` + a service-level actor assertion. New tables mirror
`cycle_dossier_*` (`vrp_panels`, `vrp_runs`, `vrp_reviews`, `vrp_control`) with per-request revision
numbers from day one.

**What is genuinely new:** (a) the persona prompt family and chair schema as governed rows; (b) a
"panel vs. humans" comparison stage that runs only after the blind panel, contrasting the chair's
matrix with the review-synthesis ratings and naming divergences (D3); (c) text resolvers for
biosketches/budget if D2 includes them.

## 4. Decisions for the owner

> **Decided 2026-09-12 (Session 510).** Outcomes are recorded in
> `docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md` §1, which supersedes the
> persona-based composition in §3, the persona phasing in §5, and the "Executor is Anthropic-only by
> design" constraint in §6 (A0 adds a provider seam). Those sections stay as the historical survey. In brief: D1 hybrid (vendor seats Claude + OpenAI on a
> governed Executor provider seam, Claude chair starting on Opus, all models selectable in the admin
> model panel, seat list extensible); D2 narrative only; D3 and D4 deferred; D5 unchanged; D6 no
> typical-cost figure until a small-subset smoke yields actuals.


- **D1 Vendors.** Claude-only personas under the Executor (governed, audited, cheaper to build) vs
  keeping multi-vendor via the ungoverned `MultiLLMService` (the old app's differentiator). Recommendation:
  Claude personas now; revisit multi-vendor only if the panel's value proves to hinge on it.
- **D2 Inputs.** Narrative + materials + four AI memos (all resolvable today) vs also biosketches and
  budget (needs two text resolvers plus A7 declarations and larger context). Recommendation: start with
  what resolves today; add the field primer and dossier entry as optional context toggles.
- **D3 Human reviews.** Include as input (contaminates independence) vs blind panel then a comparison
  stage (keeps the panel independent and yields a new signal: where AI and humans diverge).
  Recommendation: blind, then compare.
- **D4 Publication.** Private editions only vs also SharePoint `AI Artifacts` per request (the dossier
  pattern, with the Word Online caveat). Recommendation: private first; publish once the report shape settles.
- **D5 Old app.** Keep the upload-based page alive until parity, then retire it and archive
  `panel_reviews` (35 runs) or migrate them as read-only history. No action until the new app runs.
- **D6 Cost posture.** The dossier's reservation bound overstates ~40×; decide whether the VRP shows a
  "typical from real runs" figure from the start. A five-call panel is roughly 2–3× a dossier entry
  (est. $0.80–$1.20 per request at today's actuals) `[ASSUMED from dossier actuals]`.

## 5. Phasing `[PROPOSED]`

1. **Phase A (foundation):** registry entry + app key + security-matrix rows; roster + rollout gates
   cloned from the dossier; three reviewer personas + chair as governed prompts; request-scoped input
   (narrative, materials, four memos); worker/drain/lease; private editions with DOCX/PDF; page with the
   dossier's hardened affordances (inline errors, per-row links, include-all). Smoke on one request.
2. **Phase B (rigor):** claim verification via the dossier research stage; devil's advocate; SharePoint
   publication with structural verification; executor-budget entries per stage.
3. **Phase C (insight):** panel-vs-human comparison stage; optional field primer / dossier entry context;
   history and cross-request views; decide multi-vendor.
4. **Retire** the upload-based VRP after Phase B parity (D5).

## 6. Risks and constraints

- Superuser-only means the same actor-assertion discipline as the dossier on every service entry.
- The Executor is Anthropic-only by design; D1 is the fork in the road.
- Reviewer-form output schema must stay in lockstep with `lib/external/review-form-schema.js` (11 keys,
  two ratings, one multiselect) if the comparison stage is to line up with human answers.
- Every new route lands in the security matrix and `check:api-routes`; every table in the Atlas; every
  prompt family in the budgets registry; per-request revision numbers from the first migration.
