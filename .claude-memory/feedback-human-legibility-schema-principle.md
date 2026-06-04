---
name: feedback-human-legibility-schema-principle
description: "Prefer human legibility over normalization purity when designing Dataverse schema — fewer obscure tables, expand enums on existing entities when the semantic cost is recoverable"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1e1dfc4f-ebfe-49c2-965d-23d90c70e16f
  status: active
  scope: dataverse
  last_verified: 2026-05-14 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: designing Dataverse schema — deciding between a new child entity vs. expanding an enum/discriminator on an existing entity.

Do:
- Default to expanding a choice value, lookup, or discriminator column on an existing entity, even at the cost of more enum values / downstream filter logic.
- Ask "could this be a discriminator on an existing entity?" before proposing a new entity.
- When a new entity IS right (different parent/lifecycle/shape), name the human-legibility cost explicitly in the trade-off.

Do not:
- Optimize for normalization purity at the expense of non-technical staff having to learn a proliferation of obscure tables.

Ground truth: historical-only (principle set by Justin, 2026-05-14 Connor schema-review, `docs/INTAKE_PORTAL_SCHEMA_REVIEW_2026-05-14.md` Item 1; catalog `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`). Aligns with [[project-dynamics-as-prompt-ground-truth]].

When weighing "new child entity" vs "expand an enum / add a discriminator on an existing entity", default to the latter unless the semantic cost is irrecoverable. Non-technical staff browsing Dataverse should not have to learn a proliferation of obscure tables to understand a proposal's data.

**Why:** Stated by Justin during the 2026-05-14 Connor schema-review (Item 1 of `docs/INTAKE_PORTAL_SCHEMA_REVIEW_2026-05-14.md`). I had recommended a separate `wmkf_proposalcostshare` entity to keep "WMKF spend" aggregates clean of cost-share rows; Justin chose to expand `wmkf_proposalbudgetline.wmkf_category` with `WaivedIndirect / WaivedTuition / OtherCostShare` instead — accepting the forever-filter cost in aggregate queries in exchange for a single legible budget table. The general principle he set: fewer obscure tables, even at the cost of more enum values or filter logic downstream.

**How to apply:**
- When sketching new schema, ask "could this be a choice value, lookup, or discriminator column on an existing entity?" before proposing a new entity.
- New entities are still right when they have a different parent, different lifecycle, or genuinely different shape (e.g., `wmkf_proposalbudgetline` per-amount as a new entity, vs. roster as an extension of the existing `wmkf_apprequestperson` junction — the 2026-05-14 schema review applied the principle and chose extension for roster, new entity for budget; see `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`).
- When you do recommend a new entity, name the human-legibility cost explicitly in the trade-off so it's visible in the decision.
- This principle aligns with the broader `[[project-dynamics-as-prompt-ground-truth]]` posture: Dataverse content should be browseable by non-technical staff, not just queryable by code.
