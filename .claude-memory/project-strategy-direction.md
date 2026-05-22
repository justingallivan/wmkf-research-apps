---
name: Strategy direction established with Connor
description: Key strategic decisions from Session 86 — AkoyaGO posture, Dynamics as ground truth, backend triggers, Connor collaboration
type: project
---

Strategy document revised with input from Connor (Foundation colleague, knows AkoyaGO/Dynamics best). Key decisions:

- **AkoyaGO**: Minimize reliance, not replace. Vendor provides Dynamics license; dependency on their workflows unclear.
- **Dynamics is ground truth** for all organizational data long-term (including researcher/reviewer data currently in Postgres).
- **Backend triggers are the future**: Same API calls but initiated by status changes, not user uploads. Requires collaboration with Connor on PowerAutomate flows.
- **Connor partnership**: established. Backend vision being built collaboratively (started March 2026). **Posture reaffirmed 2026-05-14:** "minimize reliance, not replace." `AkoyaGO going away` is shorthand only — not a settled decision. The Foundation uses a fraction of AkoyaGO's functionality; the goal is to recreate the functions they use and minimize dependence, while accepting that the vendor solution works "all of the time" in ways a custom replacement may not initially match.
- **Postgres role**: Development substrate + operational store until Dynamics write access is established. Write access expected soon.
- **Researcher data**: Belongs in CRM — paid API calls, reusable expertise. Not just app-operational data.
- **Freshness metadata**: Future feature — "current as of [date]" fields to enable automated refresh of stale records.

**Why:** The app suite started bottom-up; now has leadership buy-in and read access to Dynamics/SharePoint. Direction needs to align with Foundation's broader systems strategy, not just developer convenience.

**How to apply:** When making database/architecture decisions, prefer Dynamics-first designs. Use Postgres for staging and app-operational data. Don't build features that assume AkoyaGO replacement.
