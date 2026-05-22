# Atlas: `wmkf_portalmembership` (Dataverse, WMKF pilot entity)

**Last verified:** 2026-05-15 (S155) — **spec'd, NOT yet deployed.** Slice-0 entity; deploy target 2026-05-19.
**Live row count:** 0 (entity not yet created in Dataverse)
**Entity set:** `wmkf_portalmemberships`
**Schema spec:** `lib/dataverse/schema/wave4/wmkf_portalmembership.json`
**Naming:** logical name `wmkf_portalmembership` — no internal underscores, matching the sibling `wmkf_app*` convention. An earlier draft used `wmkf_portal_membership`; renamed to the no-underscore form pre-deploy (S178). Connor reviews this one entity's shape before creation.

## Source of truth

**The one new intake-portal pilot entity: a contact ↔ account (institution) join with self-service request + staff approval state.** Shape locked at `docs/INTAKE_PORTAL_DESIGN.md:98-117`. Only the *entity* is slice 0; the staff approve/reject **admin UI is a separate downstream slice** (`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md`).

One row per `(contact, account)` pair regardless of approval state (alt key) — re-applying after rejection **updates** the existing row, never duplicates. Pending vs. revoked vs. rejected are distinct states `statecode` alone cannot express; `wmkf_approvalstatus` carries the distinction, `wmkf_priordecisionstatus` snapshots the prior terminal state across a re-application.

## Fields

Identity:
- `wmkf_portalmembershipid` (PK)
- `wmkf_name` (String 200, ApplicationRequired) — synthesized `{contact} @ {account} ({role})`; display only.

Lookups (PascalCase nav-property for `@odata.bind`; lowercase logical for plain reads) — **exact bind keys to record at deploy** per `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md`:80-85:
- `wmkf_Contact` / `_wmkf_contact_value` → `contact` (ApplicationRequired)
- `wmkf_Account` / `_wmkf_account_value` → `account` (ApplicationRequired)
- `wmkf_RequestedBy` / `_wmkf_requestedby_value` → `contact` (optional) — who initiated (self-service or staff)
- `wmkf_ApprovedBy` / `_wmkf_approvedby_value` → `systemuser` (optional) — staff approver; null until decided

State:
- `wmkf_role` (Picklist, ApplicationRequired): `100000000=Submitter`, `100000001=Contributor`. Submitter = institution-wide submit authority (request-level allowed-submitters is a Phase 1 follow-up).
- `wmkf_isprimary` (Boolean, default false) — flags the official-communications contact for the pair.
- `wmkf_approvalstatus` (Picklist, ApplicationRequired): `100000000=Rejected`, `100000001=Revoked`, `100000002=Approved`, `100000003=Requested`. Approved + `statecode` active = live. **Integers deliberately aligned to `wmkf_priordecisionstatus`** (terminal states share the same values) so the build-plan §9 re-application copy is correct by label *or* integer; `Requested` (no prior-decision equivalent) takes the leftover slot. Do not "normalize" the ordering.
- `wmkf_priordecisionstatus` (Picklist, **nullable** — absence = no prior decision; no 4th value): `100000000=Rejected`, `100000001=Revoked`, `100000002=Approved`. Integers reserved 2026-05-14 (S150), do not renumber. Slice-0 addition per build plan §2 — applicant slice copies the current terminal `wmkf_approvalstatus` here before flipping back to Requested on re-application.
- `wmkf_requestedat` (DateTime) — when requested.
- `wmkf_approvedat` (DateTime) — when approved; null until approved.
- `wmkf_rejectionreason` (String 850) — optional staff note, surfaced to applicant on rejection.
- `statecode` / `statuscode` (system) — hard kill switch; approved + active = live.

Alternate key:
- `wmkf_contact_account` covers `(wmkf_contact, wmkf_account)` — one row per (person, institution) pair; authoritative dedupe / upsert key for re-application.

## Read paths

- **(Future, separate slice)** `/api/apply/admin/memberships*` GET — staff approval queue (waiting-on-approval vs. cut-off), reads `wmkf_approvalstatus` + `wmkf_priordecisionstatus` for `priorDecision.status`.
- **(Future)** Applicant-side submit-authority check — `akoya_request._wmkf_account_value` must equal an `account` for which the authenticated `contact` has an **approved + active** `wmkf_portalmembership`.

## Write paths

- **(Future, separate slice)** Admin approve/reject — sets `wmkf_approvalstatus`, `wmkf_ApprovedBy@odata.bind`, `wmkf_approvedat`, `wmkf_rejectionreason`.
- **(Future)** Applicant-side institution-claim upsert (cross-slice contract, build plan §9) — upsert on the `(contact, account)` alt key; on re-application copy current `wmkf_approvalstatus` → `wmkf_priordecisionstatus` before setting `Requested`.

## Cross-system

| Target | Mapping |
|---|---|
| `contact` | Required lookup — the claiming person; also the optional `wmkf_RequestedBy`. |
| `account` | Required lookup — the institution being claimed. |
| `systemuser` | Optional lookup — the staff approver (`wmkf_ApprovedBy`). |
| `akoya_request._wmkf_account_value` | Submit-authority gate: approved+active membership on the matching account. |

## Migration disposition

Net-new pilot entity (slice 0). No backfill — forward-only via the applicant claim flow + staff admin slice. No legacy data.

## Open questions / gotchas

- **Entity-set name confirmed at deploy.** `wmkf_portalmemberships` is the expected pluralization; verify via metadata post-deploy and correct here.
- **Naming normalized to the no-underscore form (S178).** Logical name is `wmkf_portalmembership` (not `wmkf_portal_membership`), matching the sibling `wmkf_app*` convention. The earlier underscore form was renamed pre-deploy; the admin build plan and design docs were updated in the same pass.
- **Record exact `@odata.bind` keys at deploy** (`wmkf_Contact` / `wmkf_Account` / `wmkf_RequestedBy` / `wmkf_ApprovedBy`) — the admin + applicant slices depend on them; lowercase keys produce `0x80048d19`.
- **`wmkf_priordecisionstatus` is nullable by design** — no "none" option value; absence is the fourth state. Don't add a 4th option to make queries simpler.
- **Connor shape review before `--execute`** — this is the one entity that gets design review (`project_dataverse_creator_privileges`, summary-after model).
