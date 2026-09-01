---
title: Final Writeup Persona Configuration — V2-Capable Production Deployment Receipt
domain: workbench
kind: audit
status: complete
canonical: false
last_verified: 2026-08-31
owner: product-engineering
related:
  - docs/FINAL_WRITEUP_PERSONA_CONFIGURATION_PLAN.md
  - docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md
  - docs/audits/final-writeup-persona-implementation-claude-review-2026-08-31.md
---

# Final Writeup Persona Configuration — V2-Capable Production Deployment Receipt

## Outcome

Commit `84bf465b63226e6950fedfa9c56386ecbf07092d` is live in Ready Production
deployment `dpl_41SybgPYfJXGarf7UqcMGCLMy4KS`. This establishes the first
v2-capable Production floor for `final_writeup.matrix_audiences` while retaining
version-1 read compatibility.

The deployment did not publish a Dataverse setting, run the migration command,
change a schema, or enable persona lenses. Production still stores version 1,
and the tracked persona flag remains false.

## Release evidence

| Evidence | Result |
| --- | --- |
| Pre-release Production rollback point | Ready deployment `dpl_D6ozmLDTy5jDaUx276fVN4RcrtMY` |
| Preview | Ready deployment `dpl_CkKvg83BZhf3jb6A36gvQ4kkk4gn` |
| Production | Ready deployment `dpl_41SybgPYfJXGarf7UqcMGCLMy4KS` |
| Production alias | `applications.wmkeck.org` resolved to the new deployment |
| Public auth boundary | `/api/health` and `/admin` redirected to sign-in and completed on the sign-in page |
| Signed-in Admin | **Workflows → Final Writeups** loaded the consolidated **Final Writeup staffing** panel without an application console error |
| Signed-in Workbench | `/workbench/final-writeups` rendered the existing Research matrix and Request `1002788` without an application failure |

## Read-only Production state proof

The signed-in Admin GET generated an unpublished v2 migration draft from the
stored v1 setting. No Publish action or write route was invoked.

The stored v1 program audiences read back as:

- **Research — 9:** Allison Keller, Beth Pruitt, Connor Noda, Duncan Spore,
  Jean Kim, John Sader, Justin Gallivan, Kevin Moses, and Sarah Hibler.
- **Southern California — 6:** Allison Keller, Anneli Stone, Connor Noda,
  Duncan Spore, Sarah Hibler, and Saskia Pallais.

The generated staffing draft covered all 11 current direct members of `WMKF
Final Writeup Reviewer`: Allison Keller — Leadership; Anneli Stone — Program
Director; Beth Pruitt — Program Director + Leadership; Connor Noda — Program
Coordinator; Duncan Spore — Program Coordinator; Jean Kim — Program
Director; John Sader — Program Director; Justin Gallivan — Program Director;
Kevin Moses — Program Director; Sarah Hibler — Program Coordinator; and Saskia
Pallais — Program Director. The panel reported 11 assigned, one overlapping,
zero no-lens, and zero incomplete rows.

The Research matrix retained its expected nine columns. Request `1002788`
showed Justin Gallivan as Responsible PD, Duncan Spore as Reviewed, and the
remaining expected reviewers as Not reviewed. The current request set exposed
no Southern California Final Writeup row, so this smoke proved that audience by
configuration readback rather than matrix rendering.

Chrome emitted three identical extension-origin message-channel errors on the
Workbench page. They were not application-origin errors and did not coincide
with a failed request or UI failure.

## Sweep classification

- **Implemented and Production-deployed:** strict v1/v2 reads, v2-only atomic
  publication, explicit multi-valued/no-lens staffing, stale-reference pruning,
  consolidated Admin editing, and ETag upgrade/repair/downgrade tooling.
- **Live durable state:** version 1 with the exact Research and Southern
  California audiences above.
- **Disabled:** persona lens resolution and persona-specific dashboard queues.
- **Not executed:** Production dry-run, v2 publication, post-write ETag/value
  readback, representative PC/Leadership Word-access proof, and persona
  enablement.

## Next authorized sequence

After explicit Production-write authorization: run the migration command in
dry-run mode, verify both program-audience GUID sets remain exact, publish once
through the ETag-guarded setting seam, and read back version 2 plus the new
ETag. Keep the persona flag false until representative Program Coordinator and
Leadership users prove canonical Word access; only then deploy enablement and
smoke each persona and overlap case.
