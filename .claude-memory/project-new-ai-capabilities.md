---
name: New AI Capabilities (Compliance + Matching)
description: Two new capabilities planned — compliance screening against Foundation criteria, and three-tier staff/consultant/board proposal matching
type: project
status: active
scope: strategy
last_verified: S209 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: scoping the Compliance Screening capability, or someone asks about staff/consultant/board proposal matching.

Do:
- Treat Staff-Proposal Matching as SHIPPED with a UI as Expertise Finder (`pages/api/expertise-finder/{match,batch-match,roster,history}.js` + `expertise-finder.js`; rules in `modules/expertise_matching/CLAUDE.md`).
- Build Compliance Screening (still unbuilt) via batch eval against historical Phase I proposals → iterate prompts → deploy as PA triggers; full PDFs but text-only extraction for cost at scale.

Do not:
- Rebuild matching or assume it has "no UI" — that original framing was overtaken (S209).
- Apply the "no-UI, batch-only, PA-deploy" framing to matching; it applies only to the still-unbuilt compliance piece.

Ground truth: `pages/api/expertise-finder/*.js`, `expertise-finder.js`, `modules/expertise_matching/CLAUDE.md`; compliance-screen code confirmed absent (`git grep`/`find` return nothing, S209).

Two new AI capabilities to develop via batch evaluation → production deployment:

**1. Compliance Screening**
- Foundation has written criteria for what research they support/exclude
- Criteria exist as documents (can be fed to Claude as prompt context)
- AI evaluates proposals against criteria, flags non-fits with reasoning
- Full PDFs required (not just abstracts), but text-only extraction (strip images) for cost at scale

**2. Staff-Proposal Matching** (three tiers) — **SHIPPED as Expertise Finder (S209 update)**: `pages/api/expertise-finder/{match,batch-match,roster,history}.js` + `expertise-finder.js` page (a real web UI, contra the "no UI" note below); rules in `modules/expertise_matching/CLAUDE.md`. Staff/consultant/board tiers all covered.
- **Staff lead:** Coarse matching (~16 staff, by program area)
- **Consultant flag:** Domain expertise, flag when specialist input would help
- **Board member expertise:** Identify board members with relevant knowledge
- A colleague has made a first attempt at matching rules — starting point for prompts

**Development approach:** Batch evaluation against historical Phase I proposals in Dynamics. Compare AI decisions against actual outcomes + staff judgment. Iterate on prompts until accuracy is acceptable, then deploy as automatic PowerAutomate triggers for new proposals.

**Why:** (Original framing, partly overtaken — S209.) Matching has since shipped *with* a UI as Expertise Finder (see section 2); **Compliance Screening is still unbuilt** (no compliance-screen code exists — `git grep`/`find` return nothing). The original "build via batch scripts, no UI, deploy to PowerAutomate" framing applies to the still-unbuilt compliance piece; it was NOT how matching actually shipped.

**How to apply:** These share infrastructure with the service processing endpoints (Phase 2). Same auth, same prompt system, same Dynamics/SharePoint data access. The batch evaluation endpoint is the key new piece.
