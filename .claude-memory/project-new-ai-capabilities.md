---
name: New AI Capabilities (Compliance + Matching)
description: Expertise Finder shipped the staff/consultant/board matching capability; Compliance Screening is a planned capability whose current implementation status has not been freshly checked.
type: project
status: active
scope: strategy
last_verified: 2026-10-12 for Expertise Finder source; Compliance Screening absence was last checked 2026-07-27 only and current absence is unknown
---

## Recall Rule

Read this when: scoping the Compliance Screening capability, or someone asks about staff/consultant/board proposal matching.

Do:
- Treat Staff-Proposal Matching as SHIPPED with a UI as Expertise Finder
  (`pages/api/expertise-finder/{match,batch-match,roster,history}.js` +
  `expertise-finder.js`; production prompt rules in the Dataverse
  `expertise-finder.match` row, seeded from
  `shared/config/prompts/expertise-finder-dynamics.js`).
- Compliance Screening was a proposed capability, and code absence was checked only on 2026-07-27. Its current implementation/status is unknown; confirm owner priority and current architecture before planning or building it. The batch-evaluation, full-PDF/text-only, and PowerAutomate sequence below is historical proposal, not a current build instruction.

Do not:
- Rebuild matching or assume it has "no UI" — that original framing was overtaken (S209).
- Apply the old "no-UI, batch-only, PA-deploy" proposal to matching or treat it as an approved current compliance implementation plan.
- Treat `modules/expertise_matching` as the production implementation; it is an
  isolated reference/demo with no production caller.

Ground truth: `pages/api/expertise-finder/*.js`, `expertise-finder.js`, and
`shared/config/prompts/expertise-finder-dynamics.js` (row definition; live text
is edited in Admin → Prompt Templates); production-call-path search found
no caller from the app/API into `modules/expertise_matching`. Compliance-screen
code was not found in the S209 source search (2026-07-27); that dated search does not
establish current absence.

Historical capability framing (S209): two areas were discussed for development; the current state differs, with Expertise Finder shipped and Compliance Screening status unknown:

**1. Compliance Screening**
- Foundation has written criteria for what research they support/exclude
- Criteria exist as documents (can be fed to Claude as prompt context)
- AI evaluates proposals against criteria, flags non-fits with reasoning
- Full PDFs required (not just abstracts), but text-only extraction (strip images) for cost at scale

**2. Staff-Proposal Matching** (three tiers) — **SHIPPED as Expertise Finder
(S209 update)**: `pages/api/expertise-finder/{match,batch-match,roster,history}.js`
+ `expertise-finder.js` page (a real web UI, contra the "no UI" note below);
production rules live in the `expertise-finder.match` prompt row
(`shared/config/prompts/expertise-finder-dynamics.js`, resolved via
`lib/services/tool-prompt-resolver.js`).
`modules/expertise_matching` remains a non-production reference/demo. The
staff/consultant/board tiers are all covered.
- **Staff lead:** Coarse matching (~16 staff, by program area)
- **Consultant flag:** Domain expertise, flag when specialist input would help
- **Board member expertise:** Identify board members with relevant knowledge
- A colleague has made a first attempt at matching rules — starting point for prompts

**Historical proposed development approach (not current authorization):** batch evaluation against historical Phase I proposals in Dynamics, compare with outcomes and staff judgment, then consider PowerAutomate triggers. Confirm current owner priority, data contract, and architecture before adopting this sequence.

**Why:** The original framing is partly overtaken — matching shipped with a UI as Expertise Finder (see section 2). Compliance Screening absence was checked only in a 2026-07-27 source search; present status is unknown. The original batch/no-UI/PowerAutomate wording records a proposal, not evidence that the capability remains unbuilt or that this is its current delivery plan.

**How to apply:** Treat the shipped Expertise Finder path and the proposed Compliance Screening capability separately. Any new compliance endpoint or batch workflow needs its own current contract, caller/auth review, and owner priority; the old proposal does not establish shared endpoint architecture or a required batch-evaluation endpoint.
