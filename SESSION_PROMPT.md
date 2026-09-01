# Session 472 Prompt: Final Writeup Persona and Coordinator Matrix

## Session 471 Summary

Session 471 (2026-08-31) shipped and Production-proved the Final Writeup
acknowledgement foundation and Request Document explicit-actor architecture.
The September 4, 2026 deadline remains the governing priority: finish the
staff/executive Final Writeup visibility needed for real use without a dramatic
Workbench redesign.

### Completed

1. **Final Writeup acknowledgement and dashboard foundation.** Wave 23 is exact
   and Production readiness is `on`. Signed-in reads proved responsible-PD
   exclusion. After the dedicated role reached all 11 audience members, an
   eligible colleague successfully marked Request `1002788` reviewed; it
   appeared in review history and independent readback found exactly one
   complete acknowledgement row.
2. **Request Document attribution decision.** The owner selected Option B:
   retain service-principal writes and add explicit, server-controlled business
   actors. No broad staff Request Document role is needed. The earlier Connor
   privilege brief was never sent and is withdrawn.
3. **Wave 24 implementation and promotion.** OAuth Claude adversarial review
   found no Blocker/High issue after reconciliation. Production schema is 3
   exact / 0 absent / 0 divergent, the Production-only readiness flag is `on`,
   signed-in health passed, and commit
   `8ff4205a0ad43337cd987a4fc76639f936bab4bc` first reached Ready deployment
   `dpl_D94J9aRcfLfK81iBDsVYARVhZFPb`.
4. **First natural Wave 24 proof.** Request `1002874` created Ready/Draft
   Pre-Site row `103b9a0f-86a5-f111-b8dd-6045bd03ed63`. Explicit
   `InitiatedBy`/`InitiatedAt` identified enabled user Justin Gallivan and the
   exact create time; built-in creator/modifier remained the application. The
   request pointer matched, no missing-attribution event existed, and the
   deployment-boundary census was 1 attributed / 0 event-backed unattributed /
   0 violations.
5. **Release reconciliation.** Current Atlas, route/security, credential,
   lifecycle, queue, service-catalog, audit, identity, milestone, and handoff
   surfaces now distinguish the proved Pre-Site path from still-opportunistic
   producer-specific proof.

### Commits already on `main`

- `b5eeda7b` — Add explicit Request Document actor tracking
- `a543a45b` — Document Wave 24 source implementation
- `c9e915c1` — Harden Wave 24 after adversarial review
- `0396b187` — Record exact Wave 24 Production schema
- `8ff4205a` — Clean Wave 24 review receipt / first active runtime commit
- `b4615362` — Record Wave 24 Production activation

## Current Deadline-Critical Order

1. **[COMPLETE 2026-08-31] Read-only persona/access preflight.** The exact
   enabled `WMKF Final Writeup Reviewer` roster is the intended 11-person
   audience. Request relationships positively identify the active PD/PC
   assignments. Owner confirmation establishes Allison Keller as President and
   Beth Pruitt as CSO; Beth also has responsible-PD requests. John Sader is
   owner-confirmed as a Program Director. All three owner-confirmed persona
   facts remain rollout intent until the reviewed v2 staffing configuration is
   published and access proof is complete.
2. **[PRODUCTION-LIVE + SIGNED-IN READ SMOKE PASSED 2026-08-31]
   Superuser coordinator matrix.** Commit `52575761` is live in Ready Production
   deployment `dpl_Frc6fAonyFFYwiWyFJCzzE3UNune`. The index projects every current Final row ×
   exact enabled reviewer-role member with neutral Reviewed, Updated, Not
   reviewed, and Responsible PD states plus direct focused-review/Word links.
   Signed-in Production DOM proof showed the exact 11-person roster and Request
   `1002788`, with Duncan Spore Reviewed, Justin Gallivan Responsible PD, all
   other cells Not reviewed, both direct actions present, and zero browser-console
   errors. Prior local desktop and 390px browser QA also passed against Production
   read data. The matrix has no approval, compliance, deadline, count, or order meaning.
3. **[PRODUCTION-LIVE + SIGNED-IN READ/WRITE PROVED 2026-08-31]
   Program-specific matrix audiences.** Commit `5573bca3` is live in Ready
   Production deployment `dpl_5DNuc2BV76RihwuWu8ZFYBgxBXE7`. Role eligibility
   and matrix assignment are explicitly separate. Production readback now
   proves the stored v1 setting contains a nine-person Research audience and a
   six-person Southern California audience; Anneli Stone and Saskia Pallais are
   excluded from Research and included in Southern California.
   Signed-in Admin publication/readback survived a full reload; the coordinator
   dashboard then rendered Request `1002788` under Research with exactly those
   nine reviewer columns and zero application-console errors.
   Publishes round-trip the loaded Dataverse ETag and reject stale Admin drafts
   with `409`; unconfigured programs remain explicit and stale references fail
   closed.
4. **[PRODUCTION-DEPLOYED V2-CAPABLE / STORED V1 / ROLLOUT DISABLED]
   Staff/executive lenses.** The owner
   rejected a second Dataverse-team onboarding layer. The reviewed replacement
   extends the existing versioned Final Writeup Admin setting and its one
   editor/Publish action with explicit PD, PC, Leadership, overlap, and **No
   persona lens** assignments keyed only by stable reviewer GUID. The source now
   implements strict v1/v2 reads, v2-only atomic publication, safe stale-reference
   pruning, explicit no-lens rows, rollout-off no-read behavior, a dry-run-first
   ETag upgrade/repair/downgrade command, and the consolidated one-panel editor.
   The superseded team constants, adapter path, schema, and scripts are removed.
   Commit `84bf465b` is live in Ready Production deployment
   `dpl_41SybgPYfJXGarf7UqcMGCLMy4KS`, establishing the v2-capable rollback
   floor. Production still stores v1 with the proved Research and Southern
   California audiences, and ordinary behavior is unchanged because the
   persona flag is still false. Next: under explicit write authorization,
   dry-run and migrate/read back both unchanged audiences as v2, prove
   representative PC/leadership Word access, then enable and smoke the lenses.
   No elevated Dataverse team privilege or outside administrator is part of
   the selected path.

## Opportunistic Production Proof — Do Not Block the Deadline

- On the next naturally needed Site Visit handoff, verify
  `MilestoneCreatedBy`. Other producer-specific first writes, guarded reopen,
  and Board snapshot remain their own approval-gated checks.
- Do not manufacture Request Documents merely to test attribution.

## Scheduled Follow-up

- Monday, September 7, 2026: send Connor only the confirmation question asking
  whether compliance, audit, or a CRM consumer specifically requires staff in
  built-in Dataverse `createdby`/`modifiedby`. If the answer is no, no privilege
  work is requested. The reminder is already scheduled.

## Owner Decisions Still Open

- First Executor budget publication remains an explicit owner action; current
  Production behavior safely uses the reviewed code fallback.
- Initial Assessment restore and Board-snapshot Production writes remain
  owner-deferred until the pre-J27-scale checkpoint.

## Do Not Reopen

- In-Workbench document editing; Word remains in its own browser or desktop
  window.
- A broad staff Request Document role or the unsent Connor privilege request.
- Metered or credit-consuming review products without explicit authorization.
- A global Workbench redesign before the September 4 deadline.

## Key Files

| File | Current purpose |
|---|---|
| `docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md` | Final acknowledgement/dashboard contract and rollout status |
| `docs/REQUEST_DOCUMENT_EXPLICIT_ACTOR_PLAN.md` | Wave 24 Option B architecture, promotion, and proof |
| `docs/CURRENT_WORK_QUEUE.md` | Deadline order and verified open work |
| `docs/API_ROUTE_SECURITY_MATRIX.md` | Current route/auth/write contracts |
| `docs/APPLICATION_STATE_ATLAS.md` | Current live state and ownership routing |
| `docs/atlas/dataverse-wmkf-requestdocument.md` | Request Document schema/producer truth |
| `lib/services/final-writeup/matrix-audience-service.js` | Production-deployed v1/v2 staffing contract; Production still stores v1 |

## Verification Receipt

- Wave 24 focused implementation receipt: 12 suites / 229 tests plus relevant
  route/data/doc gates and canonical Next.js build passed before promotion.
- Production schema readback: 3 exact / 0 absent / 0 divergent.
- Request `1002874` read-only proof and census: 1 attributed / 0 event-backed
  unattributed / 0 violations.
- Claim-evidence pilot report was unavailable because local observation state
  could not be read; no pilot row was added.
