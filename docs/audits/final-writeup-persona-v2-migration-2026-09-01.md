---
title: Final Writeup Persona Configuration — Production V2 Migration Receipt
domain: workbench
kind: audit
status: complete
canonical: false
last_verified: 2026-09-01
owner: product-engineering
related:
  - docs/FINAL_WRITEUP_PERSONA_CONFIGURATION_PLAN.md
  - docs/audits/final-writeup-persona-v2-capable-deployment-2026-08-31.md
---

# Final Writeup Persona Configuration — Production V2 Migration Receipt

## Outcome

On 2026-08-31 PT / 2026-09-01 UTC, the owner authorized the Production
`final_writeup.matrix_audiences` migration. The dry-run-first operator command
upgraded the one existing Dataverse setting from version 1 to version 2 through
the normal optimistic setting seam. Persona lenses remained disabled.

## Contract evidence

| Claim | Producer / entry point | Persistence | Consumer | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| Dry-run issued no write | `manage-final-writeup-staffing-config.mjs --mode=upgrade` | none | operator output | Reported `Action: DRY RUN`, v2 replacement, and “no Dataverse write was issued” | VERIFIED |
| Exactly one optimistic upgrade committed | same command with `--execute --expected-revision='W/"96930393"'` | `wmkf_appsystemsettings` row `final_writeup.matrix_audiences` | matrix-audience service | Interlock logged one allowed Production PATCH; Dataverse returned success | VERIFIED |
| Repeat upgrade fails closed | a fresh post-write `--mode=upgrade` dry run | same setting, read only | operator | Refused with “Upgrade mode requires one valid stored version-1 setting” before any writer | VERIFIED |
| Exact v2 readback | `writeFinalWriteupMatrixAudienceConfig` post-write Admin-state read | same setting | Admin | `storedVersion: 2`, `migrationRequired: false`, revision `W/"96944113"` | VERIFIED |
| Program memberships unchanged | v1→v2 draft preserves `programs` | same setting | coordinator matrix | Southern California remained 6; Research remained 9 | VERIFIED |
| Staffing is complete | reviewed GUID manifest intersected with current direct role roster | v2 `personas` | later persona resolver | 11 assignments, one overlap, zero stale references, zero unassigned reviewers | VERIFIED |
| Rollout remains off | tracked source constant | deployed code | dashboard/persona resolver | `FINAL_WRITEUP_PERSONA_LENSES_ENABLED = false`; post-write dashboard remained neutral | VERIFIED |
| Existing matrix remains usable | `/api/workbench/final-writeups` | Dataverse + Graph reads | signed-in Workbench | Request `1002788` retained the nine Research columns and prior Responsible PD/Reviewed/Not reviewed states | VERIFIED |

## Published configuration

Responsibilities:

- Allison Keller — Leadership
- Anneli Stone — Program Director
- Beth Pruitt — Program Director + Leadership
- Connor Noda — Program Coordinator
- Duncan Spore — Program Coordinator
- Jean Kim — Program Director
- John Sader — Program Director
- Justin Gallivan — Program Director
- Kevin Moses — Program Director
- Sarah Hibler — Program Coordinator
- Saskia Pallais — Program Director

Program audiences:

- **Southern California — 6:** Allison Keller, Anneli Stone, Connor Noda,
  Duncan Spore, Sarah Hibler, and Saskia Pallais.
- **Research — 9:** Allison Keller, Beth Pruitt, Connor Noda, Duncan Spore,
  Jean Kim, John Sader, Justin Gallivan, Kevin Moses, and Sarah Hibler.

## Partial-success and rollback analysis

The unit of success was one setting PATCH guarded by the freshly loaded ETag;
there was no batch or per-row partial-success surface. A changed ETag would have
failed before the writer. The successful write was followed by service readback
and then an independent signed-in Admin reload showing **Published revision
loaded** with Publish disabled.

Because Production now stores v2, no pre-v2 deployment may be promoted directly.
Rollback below the v2-capable floor requires: keep/restore the lens flag to
false, publish the audited version-1 `{version, programs}` projection through
the exact-current-ETag downgrade mode, verify v1 readback, and only then promote
a pre-v2 build. Deployment `dpl_41SybgPYfJXGarf7UqcMGCLMy4KS` on commit
`84bf465b` is the recorded v2-capable floor.

## Remaining rollout gate

No access entitlement was inferred from this configuration write. A
representative Program Coordinator and representative Leadership user must
still open the canonical Word item through the signed-in experience. Only after
those proofs may the tracked persona lens flag be enabled and the PD, PC,
Leadership, overlap, ineligible/unassigned, and superuser cases be smoked.
