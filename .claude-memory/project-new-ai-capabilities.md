---
name: New AI Capabilities (Compliance + Matching)
description: Two new capabilities planned — compliance screening against Foundation criteria, and three-tier staff/consultant/board proposal matching
type: project
---

Two new AI capabilities to develop via batch evaluation → production deployment:

**1. Compliance Screening**
- Foundation has written criteria for what research they support/exclude
- Criteria exist as documents (can be fed to Claude as prompt context)
- AI evaluates proposals against criteria, flags non-fits with reasoning
- Full PDFs required (not just abstracts), but text-only extraction (strip images) for cost at scale

**2. Staff-Proposal Matching** (three tiers)
- **Staff lead:** Coarse matching (~16 staff, by program area)
- **Consultant flag:** Domain expertise, flag when specialist input would help
- **Board member expertise:** Identify board members with relevant knowledge
- A colleague has made a first attempt at matching rules — starting point for prompts

**Development approach:** Batch evaluation against historical Phase I proposals in Dynamics. Compare AI decisions against actual outcomes + staff judgment. Iterate on prompts until accuracy is acceptable, then deploy as automatic PowerAutomate triggers for new proposals.

**Why:** Neither capability exists today. Both should ultimately be automatic (Tier 1). Building web UI would be wasted effort — develop via batch scripts, deploy to PowerAutomate pipeline.

**How to apply:** These share infrastructure with the service processing endpoints (Phase 2). Same auth, same prompt system, same Dynamics/SharePoint data access. The batch evaluation endpoint is the key new piece.
