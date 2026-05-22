---
name: Red CI gates are P0 blockers, not side-notes
description: When npm run check:* is red on main, it's a rubric violation right now — fix before any data-layer commits, regardless of who broke it.
type: feedback
originSessionId: 0e402398-f829-45ec-a781-e624832c86e6
---
A red `npm run check:atlas`, `:atlas:self-test`, or `:api-routes` gate on `main` means the ground-truth rubric (CLAUDE.md "Ground-truth requirement" + `docs/CLAUDE_REMEDIATION_PLAN.md`) is being violated *right now*. Treat it as a P0 blocker for any commits to data-layer surfaces (`pages/api/**`, `lib/dataverse/**`, `lib/db/**`, services, atlas docs).

**Why:** On 2026-05-08 Justin called out a specific failure mode: I ran `check:atlas` during a Codex-review task, saw it red on `wmkf_apprequestpersons`, asked "is this my regression?", got "no — pre-existing from S139", and demoted the violation to a side-note at the end of the response. The gate had been red for ~2 days because the session that broke it (S139, also me) shipped a new Dataverse entity without an Atlas page, and S140 didn't catch it until the user pointed it out. The remediation plan exists *because* this kind of drift is invisible in normal review; the gates are the only mechanical enforcement, and treating them as informational defeats the whole rubric.

**How to apply:**
- At session start, the `/start` skill runs `npm run check:atlas` and `npm run check:api-routes` automatically (Step 2 of the skill). If either is red, report it as the FIRST item in the session summary, before recapping the prior session.
- During a session: if you run a `check:*` gate for any reason and it's red, stop and surface it. Don't ask "did I cause this?" — ask "is the rubric currently being violated?" If yes, fix it (or escalate) before moving on.
- "Pre-existing on main" / "out of scope for current task" / "side-note for follow-up" are NOT valid reasons to proceed past a red gate. They are the exact rationalizations that produced the failure.
- Fixing the gate is the default. Adding to `ALLOWED_UNDOCUMENTED_*` requires written justification and is a last resort.
- Codified in CLAUDE.md "Ground-truth requirement" section under "Red gates are P0 blockers, not side-notes."
