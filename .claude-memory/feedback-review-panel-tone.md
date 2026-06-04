---
name: Virtual Review Panel tone calibration
description: LLM reviewers must balance critique with upside evaluation — not mimic conservative NIH/NSF study sections. Based on CSO feedback.
type: feedback
scope: prompt
status: active
last_verified: 2026-03-30 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: writing or tuning Virtual Review Panel reviewer/synthesis prompts (or any LLM-reviewer proposal-evaluation prompt for Keck).

Do:
- Evaluate upside and concerns with equal rigor; treat high risk as acceptable when payoff justifies it (Keck funds early-stage work).
- Treat applying known methods to genuinely new systems/questions as meaningful novelty.

Do not:
- Adopt a conservative NIH/NSF study-section posture or penalize lack of preliminary data.
- Treat prior work in a different system/organism/context as precedent that undermines novelty.

Ground truth: CSO feedback 2026-03-30 (quoted in body); `docs/VIRTUAL_REVIEW_PANEL.md`.

Virtual Review Panel prompts must NOT adopt a conservative NIH/NSF study-section posture.

**Why:** CSO feedback (2026-03-30): "All of the LLMs seem very focused on feasibility and require a high bar on innovation/novelty, i.e., negative about risk and lack of preliminary data for all elements of the proposed work, and overly extrapolating work in other systems that does not apply to this system as a reason to say this is not novel... Overall, the reviews read like a grumpy study section who thinks everything has been done before and expects the work to be 80% complete at time of proposal but also to be 100% different than any related idea or methodology."

**How to apply:**
- Risk is expected and acceptable for Keck — "high risk" is not negative if payoff justifies it
- Do not penalize lack of preliminary data — Keck funds early-stage work
- Prior work in a different system/organism/context is NOT the same as precedent undermining novelty
- Evaluate both upside (what if this works?) and concerns (what could prevent it?) with equal rigor
- The federal funding landscape has changed — don't assume programs still exist; NSF/NIH success rates are very low and they are conservative about risky projects
- Applying known methods to genuinely new systems or questions IS meaningful novelty
