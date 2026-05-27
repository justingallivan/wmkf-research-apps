---
name: project-reviewer-apps-redesign-direction
description: Reviewer Finder + Reviewer Manager are slated to be replaced by a unified Reviewer Workbench (request-scoped) + standalone Reviewer Pool (request-agnostic). Direction set S194; build deferred.
metadata:
  type: project
---

S194 conversation with Justin established that the existing Reviewer Finder + Reviewer Manager apps are archaeological — they were built across different constraint regimes (no Dataverse access → Dataverse access; one user → multi-user; ad-hoc cycle tracking → Dataverse cycle entity; .eml downloads → in-app sends via Dynamics) and the seams show. Not a cleanup job, a redesign.

**Why:** Today's prod demo of Reviewer Finder failed twice (model resolver 404, then parser format drift). Both fixed today, but they exposed a deeper problem: Reviewer Finder is blind to the request entity (no request number on the page), the two apps don't link properly, and the workflow shape no longer matches what the apps were built for.

**How to apply:** Don't propose incremental cleanup to either app as "the path forward." When asked to fix something in Finder/Manager, fix it, but flag that the redesign is the real fix.

**Architecture decisions locked S194:**
- Two surfaces, not one:
  - **Reviewer Workbench** (request-scoped, URL `/reviewer-workbench/[requestId]/...`) replaces Finder + Manager as a unified per-request lifecycle view (find candidates → invite → track responses → manage review → honorarium kickoff). Every sub-view operates in request context. Title/PI/institution/status/cycle/PD visible on every screen.
  - **Reviewer Pool** (request-agnostic) — browse the reviewer roster with richer Dataverse context than the W6-retired Database tab had (past invitation history, honorarium state, contact-promotion status, affiliation history, conflicts/institution overlap, PD notes).
- `akoya_request` is the spine. Most existing UI panels can be repurposed as request-scoped views; the parts that fought against that model get replaced.
- API routes become request-scoped (`requestId` param everywhere).

**Landing dashboard (PD entry point) — locked decisions:**
- PD identity from session (`dynamics_systemuser_id` already resolved), no PD picker.
- Cycle dropdown, defaults to current open cycle.
- Scope dropdown with three options, defaults to "My (lead PD)":
  - My proposals (lead PD)
  - My proposals (lead or backup) — concrete use case: PD retiring mid-cycle, secondary PD takes over
  - All proposals (any PD)
- Status filter implemented as `isActionableForPD(request)` policy function, NOT a raw `akoya_requeststatus = X` equality. Rules deferred — Justin flagged that internal-recommendation state (acted on before board signoff) needs to be honored alongside official status.
- Strict cycle filter on the dashboard; deferred-from-prior-cycle work handled at the data layer (new request created, or backend re-attach), not as a UI filter.

**Still open (not yet discussed):**
- Row content on the dashboard (bare title/PI/institution vs. richer at-a-glance lifecycle state).
- Workbench tab layout (how Find/Invite/Track/Honorarium fit together).
- Reviewer Pool surface design + which Dataverse fields it shows.
- Status policy function rules.

**Timeline:** No build commitment. Justin will think more at home (S194 close); next session likely continues the design conversation. Goal before any code is a scoping doc shareable with Connor / Sarah.

**Honorarium integration** fits naturally as a Workbench tab — relevant to BILL build per [[project-bill-honorarium-integration]] (chunk 5 Stage 2a UI work that's currently pending could pivot into Workbench scope if the redesign starts soon).

Related: [[reviewer-identity-fragmentation]], [[project-reviewer-finder-dataverse-entry-path]], [[project-reviewer-institution-match]], [[project-w6-table-drop-pending]], [[project-app-roadmap-2026-04-25]].
