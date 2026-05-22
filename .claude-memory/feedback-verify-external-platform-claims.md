---
name: feedback-verify-external-platform-claims
description: "Before stating platform behavior (Dataverse, Power Automate, Azure AD, Vercel, Postgres, etc.), verify via WebFetch / WebSearch — memory is lossy on version-specific defaults, configurability, and edge cases"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1e1dfc4f-ebfe-49c2-965d-23d90c70e16f
---

When making claims about external-platform behavior — Dataverse rollup latency, PA trigger filter capability, plug-in execution limits, Azure AD token lifetimes, Vercel quota semantics, Postgres advisory-lock scope, anything outside the repo — **probe an authoritative source before writing the claim**. Default to WebFetch on Microsoft Learn / official docs; WebSearch when the URL isn't obvious. Do NOT default to training-data memory.

**Why:** Stated by Justin during S149 (2026-05-14, Item 6 discussion doc) after I produced a 5-option decision matrix with confident platform claims that were materially wrong. Codex flagged: rollup latency described as 1-hour when Microsoft default is 12 hours mass / 1 hour minimum incremental; PA trigger-level filtering described as easy when it's not established for parent-field filters on child-triggered flows; synchronous plug-in "added latency" described vaguely when Microsoft's ≤2s-per-message guidance makes a 30-row drain ~60s of plug-in time. The result was a recommendation anchored on wrong numbers — would have steered Connor wrong if the doc had reached him.

The deeper failure: my repo-state probe rules (CLAUDE.md probe-before-plan, Atlas page rule, memory hygiene) cover repo facts. When the question is external-platform shape, those rules don't fire and I fall back to lossy memory. Structure smuggles confidence — option matrices read as rigorous regardless of whether underlying claims are verified.

**How to apply:**
- Before any platform claim in user-facing or decision-driving output: WebFetch the authoritative doc page. Microsoft Learn for Dataverse / PA / Azure; Vercel docs; PostgreSQL docs; etc.
- If I find myself writing latency numbers, quota limits, capability boundaries, default behaviors — those are the high-risk claims. Verify before writing.
- **Verification must be use-case-specific, not feature-existence-specific** (v3 lesson 2026-05-14). "Microsoft Learn confirms feature X exists" is not the same as "feature X works for my specific combination of operations / events / inputs." When verification reaches only the primitive feature, downgrade the claim to `[partially verified — testing needed for {specific combination}]` and list exactly what needs to be tested.
- If verification isn't possible (deprecated docs, behind login, etc.), label the claim explicitly: `[unverified — needs Connor/Codex confirmation]`. Do not present unverified claims as facts.
- Treat Codex rescue as a *second opinion on a verified decision*, not as the verification step. If Codex's first pass finds platform claims wrong, that's a process miss, not Codex doing its job.
- Memory of platform behavior is "draft, requires verification" — never "good enough, ship it."
- This rule fires on any doc, plan, or recommendation that touches Dataverse, Power Automate, Azure AD, Vercel, Postgres, SharePoint Graph, or any external system listed in CLAUDE.md.
