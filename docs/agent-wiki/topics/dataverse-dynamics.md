---
agent_wiki: topic
status: active
last_verified: 2026-09-14
stale_after_days: 60
owner: dynamics-platform
source_files:
  - lib/services/dynamics-service.js
  - lib/services/dynamics/email.js
  - lib/services/dynamics-context.js
  - lib/services/dynamics-odata-validator.js
  - lib/services/dynamics-identity-service.js
  - lib/services/dynamics-explorer-taxonomy.js
  - lib/services/dataverse-app-access-service.js
  - lib/utils/auth.js
  - lib/dataverse/client.js
  - lib/dataverse/schema-apply.js
  - pages/dynamics-explorer.js
canonical_docs:
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/
  - docs/DYNAMICS_SCHEMA_ANNOTATION.md
  - docs/DATAVERSE_POWER_TOOLS_DESIGN.md
  - docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md
watch_paths:
  - lib/services/dynamics-service.js
  - lib/services/dynamics/**
  - lib/services/dynamics-context.js
  - lib/services/dynamics-odata-validator.js
  - lib/services/dynamics-identity-service.js
  - lib/services/dynamics-explorer-taxonomy.js
  - lib/services/dataverse-app-access-service.js
  - lib/utils/auth.js
  - lib/dataverse/**
  - pages/dynamics-explorer.js
  - pages/api/dynamics-explorer/**
update_triggers:
  - Dataverse / Dynamics schema, probe, or OData query changes
  - Dynamics Explorer or Power Tools surface changes
  - Dynamics identity reconciliation / impersonation changes
  - Q9 app-access transport or DATAVERSE_DAL_UNIVERSAL posture changes
---

# Dataverse & Dynamics

Use this page before Dynamics/Dataverse work: schema deploys, OData queries,
probes, Dynamics Explorer, Power Tools, identity reconciliation, CRM lifecycle
fields, and sandbox/prod assumptions. The Atlas adjudicates live data state.

## Ground Rules

- Use explicit Dynamics restriction context and preserve fail-closed auth.
  Since Stage 7 (S329): post-auth entry points establish it via
  `lib/dataverse/core/context.js` `withDalContext(scopeLabel, fn)` — a
  DAL-labeled wrapper over the same ALS machinery `[VERIFIED via
  lib/dataverse/core/context.js:46]`; entity WRITES
  (create/update/delete/disassociate/executeChangeset) are fail-closed outside
  a trusted context under `DATAVERSE_DAL_ENFORCEMENT` — explicit `on`/`off`,
  unset = on outside production `[VERIFIED via
  lib/services/dynamics-context.js:124 isDalEnforcementOn + 8
  assertTrustedDalContext call sites across the DynamicsService facade and its
  write-core module — 5 entity-write + 3 email-write (the latter added S330).
  Since S345 (Checkpoint C) the 4 entity mutators
  (createRecord/updateRecord/deleteRecord/disassociate) live in
  lib/services/dynamics/write-core.js; executeChangeset + the 3 email-write
  asserts remain in lib/services/dynamics-service.js. VERIFIED S345. A 9th
  site lives in lib/dataverse/core/changeset.js]`.
  **Prod flipped 2026-07-04 (S330):** `DATAVERSE_DAL_ENFORCEMENT=on` set as an explicit
  Vercel production env var and redeployed (aliased `reviews.wmkeck.org`) — enforcement is
  live in ALL environments; initial runtime-log scan clean.
- Write attribution: `DYNAMICS_IMPERSONATION_ENABLED=true` in Production
  (verified S271; re-verified S466 by owner env pull), so user-driven writes
  send `MSCRMCallerID` and land as the staff member — but only where the
  staff security role has privileges: an impersonated write that 403s is
  silently retried as the service principal
  (`lib/services/dynamics/write-core.js` `_writeFetch`). S466 owner-run
  census (`scripts/probe-write-attribution-census.js`): `wmkf_ai_run` rows
  attribute to staff; `wmkf_requestdocument` rows all fell back — inferred
  missing role privilege on that post-audit table (open item in
  `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` §Status). Don't read
  service-principal `createdby` as "the app had no acting user."
  **This flag fails OPEN in production — the interlock does not (S414).** Only the
  literal `'on'` enables it; any *other* value (a stray quote, `'on\n'` from an
  `echo`-piped write) is neither `'on'` nor `'off'`, so it falls through to
  `NODE_ENV !== 'production'` = `false` and enforcement is silently **off**
  `[VERIFIED via lib/services/dynamics-context.js:124-129]`. Compare
  `resolveInterlockMode`, where an invalid value fails closed to `'on'`
  `[VERIFIED via lib/dataverse/core/interlock.js:77-85]`. Do not describe the two
  flags as sharing a failure posture. The var was Sensitive (write-only,
  unverifiable) until S414 made it **non-sensitive**; keep it readable, and set it
  with `vercel env add --value on`, never `echo`. The S414 conversion rewrote it to
  `on` blind, since the prior value could not be read — so "production enforcement
  was continuously on since 2026-07-04" is **[ASSUMED]**, not verified.
  **Resolved (Session 330, 2026-07-04):** the email-write helpers
  `createEmailActivity`/`addEmailAttachment`/`sendEmail` in
  `lib/services/dynamics/email.js` call `assertTrustedDalContext` as their first
  statement; `dynamics-service.js` remains the public facade that delegates to them. This matches
  entity-write enforcement (Codex post-impl review,
  2026-07-05, flagged this gap; closed same session per stage log). Stage 8's
  gate still exempts their method names as `non-entity-transport` — that
  exemption is unchanged and intentional (they're guarded at runtime instead
  of by the static gate); see `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`
  stage log Session 330 entry.
- Validate OData before issuing it.
- **Route→Service layout is law (Route→Service consolidation Stage 7,
  2026-07-05):** `pages/api` routes are thin shells and may not import
  `lib/dataverse/adapters/*` or `lib/services/dynamics-service` — business
  logic lives in per-domain `lib/services/<domain>/` services (only the
  services touch adapters/`DynamicsService`). Enforced by
  `check:route-service-boundary` in law mode (no baseline, no ratchet)
  `[VERIFIED via scripts/check-route-service-boundary.js checkLaw + the live
  gate run at census 0, 2026-07-05]`; the sole remaining exempt dir is
  `pages/api/dataverse-export/` — `pages/api/dynamics-explorer/` lost its
  exemption at S9 of `docs/plans/DYNAMICS_EXPLORER_CHAT_SERVICE_EXTRACTION_PLAN_2026-09-18.md`
  (2026-09-19) now that its route is a thin shell over
  `lib/services/dynamics-explorer/`. See `docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md`.
- Entity/table schemas, read/write paths, source-of-truth, and drop status live in the Atlas.
- Existing databases use `node scripts/apply-migrations.js`; `scripts/setup-database.js` is fresh-install-only.

## Durable Memory

- Schema/OData/taxonomy: `project-dataverse-schema-deploy-gotchas`, `project-dataverse-odata-null-filter`, `project-living-taxonomy-principle`.
- CRM users/email/limitations/writeback: `project-dynamics-crm-users`, `project-dynamics-email`, `project-dynamics-crm-limitations`, `project-dynamics-ai-writeback`.
- Identity reconciliation and sandbox state: `project-dynamics-identity-reconciliation`, `project-dynamics-sandbox-state`.
- Explorer and Power Tools: `project-dynamics-explorer-details`, `project-dynamics-explorer-schema-diff`, `project-dynamics-explorer-reuse-power-tools`, `project-dynamics-feedback-admin-shipped`, `project-dataverse-power-tools`.
- Export and lifecycle facts: `dataverse-export-floor-scoping`, `project-akoya-request-pd-fields`, `project-grant-lifecycle-states-confirmed`, `akoya-temporal-axis-encodings`.
- Research award scope (special grants, Keck Court Biomedical Initiative, `wmkf_type = Program` filter hazard): `project-research-special-grants-in-cohorts`.
- SharePoint package-promotion samples and governed DOCX hash coverage (routed here from the memory router 2026-10-05): `project-sharepoint-property-promotion-rewrites-docx`.
- Explorer behavior campaign (SoCal vernacular; plan `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md`): `project-dynamics-explorer-socal-campaign`.

## Operating Notes

- **Scripts that find a request's cycle from its meeting date may be out of
  date (owner, 2026-10-29).** The apps are moving to read a request's cycle
  only from its Grant Cycle link (`akoya_request.wmkf_grantcycle`) and cycle
  dates from that linked calendar row, with no meeting-date fallback
  (`docs/plans/MEETING_DATE_RETIREMENT_PLAN_2026-10-29.md`; status there).
  Scripts still in use move with the app code. Finished one-offs and probes
  are left as written, as a record of what was run, so they may still derive
  cycles from `wmkf_meetingdate` (`meetingDateToCycleCode`,
  `cycleCodeToOdataFilter`, or their own month logic). For those, cycle
  membership can differ from the apps': the link places requests the
  meeting date cannot (off-month dates, e.g. July 2017 → J18), and about 140
  older Research requests (mostly 2010–2014) have a June/December date but no
  link. Before reusing such a script, or quoting its old output as current,
  check which source it uses: `rg -n "wmkf_meetingdate|meetingDateToCycleCode|cycleCodeToOdataFilter" scripts`.
  `scripts/probe-request-grant-cycle-lookup.cjs` compares link and date on
  purpose. Coverage numbers: the plan's §7 Q1. Step 6 (branch
  `claude/meeting-date-guard-explorer-scripts`, not merged) moved the
  current-use scripts to the link: Staff Deliberations drafts
  (`generate-pre-site-drafts-cycle.mjs`) and preflight
  (`probe-pre-site-generation-preflight.mjs`), the deliberations cohort review,
  the Proposal Ranking access script (its roster hash now carries the linked
  code), the reminder-liveness audit and the honorarium backfill (cycle requests
  by link, then their suggestions by request id). The My Candidates and My
  Proposals smoke scripts move with those services.
- **App code may not add request meeting-date reads
  (`check:request-meeting-date-reads`, step 6, not merged).** The gate records
  every `lib/`, `pages/`, `shared/` file that mentions `wmkf_meetingdate` or
  calls the old helpers, with its count; a new file or a higher count fails,
  and a lower count fails until the record is lowered. Readers still to convert
  are kind `pending-reader`; remove each record as its reader converts.
- **Factory test requests and the Grant Cycle link (step 5, PR #556, deployed
  2026-10-30).** A clone is in a
  cycle only if the Factory bound `wmkf_GrantCycle` when it created it: the
  admin form's operator picks a row from the destination calendar (Production:
  real cycles only; sandbox: J26/D26/J27 plus test rows D97/D99), and the clone
  takes its meeting date and fiscal year from that row's Board date. Test
  requests made before step 5 carry no link, show "No cycle", and the IA and
  review recipe steps refuse them; re-create rather than patch them. The CLI
  needs `--cycle=<code>` for `--reserve`.
- **Audit history and the operations Grant Cycle table (2026-10-28, D43 cycle
  calendar).** For downstream apps reading who changed a record:
  `RetrieveRecordChangeHistory` (per record, GET) is the only audit read open
  to this app — `/audits` filtered to one object is **403**, as is the bulk
  aggregate. Entries carry `AuditRecord.createdon` and the formatted
  `_userid_value`; a cleared column appears only in `OldValue`; results can
  page (`MoreRecords`). A new audit entry becomes readable **a few seconds
  after the write**, so a read straight after a save will not see it.
  Impersonated writes (`MSCRMCallerID`, `noFallback`) are recorded under the
  staff member. `wmkf_grantcycle` dates are DateOnly / TimeZoneIndependent
  (`YYYY-MM-DDT00:00:00Z`): never time-zone convert them. Evidence:
  `docs/audits/audit-history-shape-2026-10-28-evidence.json`,
  `docs/plans/CYCLE_CALENDAR_DATAVERSE_PLAN_2026-10-28.md` §4 and §6; Atlas
  `docs/atlas/dataverse-wmkf-grantcycle.md`.
- **Expertise roster Contact links are reference-only** **[PRODUCTION-LIVE
  2026-09-14; Postgres migration 050 applied and read back].** The roster keeps its
  Postgres `id` as the durable attendee identity and may hold one optional
  `dataverse_contact_id`; a partial unique index permits only one active roster
  row per Contact. Linked Board/Consultant directory rows read the active
  Contact's current `emailaddress1` and never fall back to the manual roster
  email when the Contact is missing, inactive, or email-less. The roster editor
  can search existing Contacts but cannot create or edit them; its route is
  bounded, wrapped in `withDalContext`, and guarded by the `expertise-finder`
  app grant. The owner backfill is dry-run by default; only exact unique active
  email-bearing ORCID matches are automatic, while name matches require an
  explicit `rosterId=contactId` confirmation. Apply mode additionally requires
  `--actor-profile-id` and records that profile in `updated_by`. The initial
  owner-reviewed production reconciliation linked ten active Board/Consultant
  rows. Five Board rows intentionally remain unlinked for this cycle and are a
  non-blocking future-cycle reconciliation; see the roster Contact-link plan F5.

- **SharePoint package-promotion behavior is supported by specific samples, not a universal Office-file guarantee.** In a sandbox DOCX upload sample (Request 1000342, 2026-09-24), promotion added SharePoint `customXml`, rewrote package metadata and document relationships, and added `[trash]` entries; the governed content matched after normalization of the document-relationship rewrite. A second sandbox sample (Pre-Site v6 template into `akoya_request`, Request 1000348, 2026-09-27) showed some pre-existing SharePoint `customXml` parts rewritten for the destination library. A production XLSX copy sample (Request 1003308, 2026-10-02) differed in `docProps/custom.xml`; unpromoted XLSX and PPTX behavior is uncharacterized. One Word-edited DOCX sample (Request 1002903, 2026-09-17) was byte-identical across its observed round-trip; that does not establish a guarantee for all Word-edited packages. `hashGovernedDocxContent` covers all `word/` parts plus relationship-reachable parts outside `word/` and their relationship parts. The DOCX attestation applies characterized package normalizations, while `allowSharePointRewrites` permits rewrites to pre-existing SharePoint-shaped `customXml` parts only for app renders; uploader-supplied source `customXml` must remain byte-identical. Use the relevant attestation for governed DOCX package checks and do not generalize these samples to PPTX or other workflows. These Office samples establish no universal byte-stability guarantee for other formats. The frozen-distribution Word snapshot reuse (`validateReadySnapshot`) and briefing `writeup-docx` member compare `hashGovernedDocxContent` (Pre-RP Brief plan §12 Finding A). First observed on the Cycle Dossier production smoke, 2026-09-12.

- **Dynamics Explorer restriction management lives in Admin, not on the Explorer page
  (Codex PR #151, `3fc0a936`, production 2026-09-05).** The Explorer page's inline "Admin
  Panel" toggle was removed; `pages/admin.js` gained a **Dynamics safeguards** section
  (`shared/components/admin/DynamicsExplorerRestrictionsSection.js`) that lists, adds and
  removes table/field restrictions through the unchanged `/api/dynamics-explorer/restrictions`
  route, and the Explorer page links to it ("Manage in Admin"). Example queries are grouped
  and responses carry copy/helpful controls. Enforcement (`checkRestriction` at the injection
  boundary) did not move.
- **An `ifMatch` ETag on a PARENT record does not detect a new CHILD row (S423).**
  Creating a row that carries a lookup to a record does not bump that record's
  `versionnumber`, so optimistic concurrency on the parent is blind to child
  creation. Any guard of the shape "hold the parent's ETag, then act on the
  assumption that its references are unchanged" is unsound — re-read the
  references instead. Live cost: `executeMerge` enumerated a loser's suggestion
  rows once and deactivated under the loser PERSON's ETag, so a suggestion row
  created mid-merge survived pointing at an inactive reviewer, and the merge
  still reported success. `[VERIFIED 2026-08-13 via
  scripts/probe-etag-parent-bump.js against production — 4 of 99 parents sit at a
  lower version than a never-updated child of their own]`
  Two facts that probe established and any future ETag reasoning should reuse:
  `@odata.etag` is exactly `W/"<versionnumber>"`, and versionnumber is org-wide
  monotonic **in write order** — it agrees 100% with `modifiedon` ordering across
  entities but only ~50% with `createdon`, because a rowversion tracks writes,
  not creations. A row's current version equals its creation version only when
  `createdon == modifiedon`. Slot binding
  (`wmkf_PotentialReviewerN@odata.bind` on `akoya_request`) is NOT covered — no
  binding timestamp exists, so it needs a controlled sandbox write.

- **`queryRecords` returns ONE PAGE (25 rows) plus `hasMore` — a sweep that ignores it
  reports a vacuous clean result (S387).** `DynamicsService.queryRecords` (and every
  adapter passthrough over it, e.g. `potential-reviewer.queryReviewers`) is page-at-a-time;
  `DynamicsService.queryAllRecords` is the auto-paginating form, exposed for the person
  entity as `potential-reviewer.queryAllReviewers`. Live cost of getting this wrong: a
  maintenance backfill scanned 25 of 385 person rows and printed "0 rows pinned below
  available evidence" — indistinguishable from a genuinely clean population, and it had
  survived three adversarial reviews plus a Codex fix pass because none of them ran it.
  Rule: whenever the ANSWER depends on having seen every row, use the `All` variant, and
  print the DENOMINATOR (rows scanned) next to the numerator so a broken read cannot look
  like an empty result set. `[VERIFIED 2026-07-29 — probe returned records=25,
  hasMore=true against a 385-row filtered population]`

- **Data-access layer migration is COMPLETE as of Stage 8 (S329): all 9
  stages executed in one session.** `lib/dataverse/core/` (odata / entity-registry
  / errors / changeset / context) + 21 adapter files `[VERIFIED via
  2026-08-23 directory inventory]`. `entity-registry.js`
  `entitySet()` throws on any entity-set name outside the Stage-0 census
  (never guess names — the S328 `wmkf_prompts`/`wmkf_aiprompts` 404s are the
  motivating case); `odata.js` owns escape/eq/eqGuid filter builders;
  `core/changeset.js` is the registry-validated batch path. The gate
  (`check:dataverse-access-layer`) is now LAW, not a ratchet — the allowlist
  file was deleted at Stage 8; any raw `DynamicsService` call (direct,
  aliased, via `executeChangeset`, or via exported/source-expression
  indirection) in `pages/`+`lib/`+`shared/`+`modules/` that isn't behind an
  adapter or on the closed `non-entity-transport` method list fails closed,
  including unrecognized method names and `unattributable-use:*` reference
  shapes. Plan + full stage log: `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md`.
  See the resolved email-helper note above for the runtime guard layered under
  the static gate exemption.
- **Dataverse target/write interlock: ENFORCED
  (S355 wiring; Production `on` 2026-07-22).** `lib/dataverse/core/interlock.js` + `target-registry.js`
  (tracked hostname registry: prod `wmkf.crm.dynamics.com`, sandbox
  `orgd9e66399.crm.dynamics.com`) implement the deployment×target×op policy
  from `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md`; the three hook
  families (dynamics/http.js `fetchWithTimeout`, dataverse/client.js `call()`,
  dataverse-export) call `assertDataverseOperationAllowed` unconditionally
  (merge 8067de3a). `DATAVERSE_TARGET_INTERLOCK=on` is live in `.env.local` +
  Vercel Production/Preview since 2026-07-22. The production flip followed a
  positive warn-mode observation; the post-flip signed-in Workbench smoke
  loaded normally and logged `mode=on` with no denial. A denied
  `[dataverse-interlock]` line in prod logs means env misconfig or an
  unregistered target — investigate, don't extend the registry blindly.
  Set-but-invalid
  flag values fail closed to `on`. Hardened by four Codex adversarial rounds
  (rehearsal grants: GUID-only recordIds, exact-collection creates, `$batch`
  never coverable; denials never reclassified as transient/FetchXml network
  errors). Hazard facts settled by probe:
  `akoyago.crm.dynamics.com` is NOT an org (akoyaGO is the prod org's display
  name); the app registration sees exactly two instances via Global Discovery;
  `.api.crm.dynamics.com` host forms are deliberately unregistered (fail
  closed).
- **Q9 app-access transport is ready for Stage 4 (verified 2026-07-27).**
  Preferences use the 19th DynamicsService adapter, while
  `lib/services/dataverse-app-access-service.js` still uses
  `lib/dataverse/client.js` for `wmkf_appuserappaccesses`. Current Vercel
  Preview and Production project configuration omit
  `DATAVERSE_DAL_UNIVERSAL`, which source defaults to `off`. The owner accepted
  that observability posture and replaced the passive soak with deterministic
  `on`-mode acceptance across the ordinary-user auth lookup, admin
  list/grant/revoke, fresh-profile default grant, and partial-failure UI
  refresh. All 33 focused assertions
  passed; the read-only live inventory found six mapped ordinary users with
  three to five grants each. Current auth behavior is fail-closed but
  retryable: `requireAppAccess` returns 503 on grant-lookup failure and does not
  cache an empty grant set. Admin grant-list failures are also fail-loud, and
  partial writes report only completed identifiers. Stage 2 is satisfied;
  Stage 4 requires a deliberately designated ordinary-user Preview smoke,
  reversible grant/revoke restoration check, authenticated reviewer-finder
  `analyze`/`discover` check with a known prompt override, and production log
  watch before release. See
  `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md`.
- OData null filters do not behave like SQL.
- The sandbox is not drop-in prod parity.
- **Production `akoya_request` automation facts for the Test Request Factory** [VERIFIED 2026-09-27/28, owner-run `scripts/probe-test-request-factory-production-readiness.js`]: the production app user cannot read audit rows (403, no `ReadAuditSummary`), so audit evidence comes from the owner's AkoyaGO Audit History; `AkoyaGo.CalculatedFieldsAsync` and the platform rollup trigger fire on **any** Request column, `AsyncRequestGoApplyRequirementsUpdate` only on `akoya_creategoapplyrequirementstrigger`, `RequestSetGrantAndStatus` (update) only on `akoya_amendment`/`akoya_originalgrantamount`/`akoya_specialrequeststatus`; the Foundation account carries eight rollup columns that aggregate Requests (`akoya_countofrequests` and seven award/grant sums), contact none; production has no *WMKF_Set Meeting Date* business rule (the sandbox's rewrites the meeting date on create). wave29's marker columns exist in production since 2026-09-28 UTC. Details: `docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md` open questions 5 and 7.
- **The sandbox org runs with background processing disabled** [VERIFIED 2026-09-27 via sandbox `asyncoperations`]: every background classic workflow is queued and then Canceled ("skipped because the org is in Disable Background Processing mode"). Real-time workflows and sync plug-ins do run. A sandbox proof therefore says nothing about background automation. The sandbox's automation definitions also differ from production's: on 2026-09-27, 12 create-triggered workflows were activated in the sandbox and 8 in production, with only partial overlap. Production also has four AkoyaGo plug-ins and two Bill.com flows the sandbox lacks. Re-list production's own registrations (`scripts/probe-test-request-factory-production-readiness.js`, owner-run) rather than inferring from the sandbox [RECHECKED after scripts/probe-test-request-factory-production-readiness.js change: its `--history` mode is additive, the registration listing is unchanged]; see `docs/plans/TEST_REQUEST_FACTORY_PRODUCTION_PLAN_2026-09-27.md` *Sandbox automation census*.
- Do not rebuild Explorer behavior when the Power Tools surface should be reused.
- Treat any Dataverse/Power Automate/Azure claim as external-platform state; verify before asserting.
- **Frozen Pre-Site email uses granular Dynamics steps, not the composed helper
  (Production-proved 2026-08-24).** Request `1002379`, PDF-only operation
  `85f52fc5-fb48-4ceb-84d6-0f246af0b6fb`, retained exact Ready/Board Ready
  DOCX and PDF rows, persisted one `sent` migration-034 ledger row, and created
  Dynamics activity `33ce6346-d89f-f111-b8db-6045bd07a06d`. Fresh readback
  showed Sent with `senton=2026-08-24T16:25:01Z`, sender/To
  `jgallivan@wmkeck.org`, `createdBy` matching the authenticated actor, and one
  133,265-byte PDF attachment matching SHA-256
  `574ac7b833801866c370a8056b7197933addfe3ea5dd535dcf4d29803c18f0c9`.
  Workbench history surfaced the receipt and a bounded Production error-log
  scan was clean. Dynamics appended its CRM tracking token after acceptance;
  inbox delivery remains unverified.
  `createEmailActivity` accepts an
  optional bounded correlation key in `email.subcategory`; the distribution
  service persists the returned activity ID, reconciles each deterministic
  filename, records `send_requested` before `SendEmail`, and queries email
  status before retrying an ambiguous response. To/Cc are known staff/
  consultant addresses carried as `addressused`; staff entry is authoritative,
  with syntax/dedupe/To-Cc conflict validation rather than identity scoring.
- **`wmkf_potentialreviewers.wmkf_name` whitespace is stored, not display-only; the adapter does NOT trim it.** [VERIFIED via `lib/dataverse/adapters/potential-reviewer.js:148` (create) and `:284` (update)] both write `wmkf_name = name` raw; only `splitName` (`:35`) trims the derived `wmkf_firstname`/`wmkf_lastname`. No central trim, so each caller's whitespace hygiene leaks to storage. [VERIFIED via Explorer length probe 2026-06-30] a manual-add row stored `wmkf_name = " Test 3 Reviewer "` (leading+trailing pad, len 17) while `wmkf_firstname`="Test"(4)/`wmkf_lastname`="3 Reviewer"(10) were clean; a 14-row sample showed non-uniform `nameLen−(firstLen+lastLen)` deltas (0,1,2,3) incl. double internal spaces and trailing spaces baked into `wmkf_firstname`. [VERIFIED via attribute-metadata probe 2026-06-30] `wmkf_name` is a plain WRITABLE field, NOT computed: `SourceType=0` (0=simple, 1=calculated, 2=rollup), `IsValidForCreate=true`, `IsValidForUpdate=true`, `FormulaDefinition=""`. ~~So writes stick — the padding came from write paths, not a Dynamics recompute.~~ **[STALE/CONFLICT — corrected 2026-09-26 by the Test Request Factory reviews live proof, sandbox Request 1000343]** a server-side process (a plugin or real-time workflow, not a calculated attribute — `SourceType=0` only rules out the calculated kind) REWRITES `wmkf_name` as `" <firstname> <lastname> "` on create AND on update: a POST carrying `wmkf_name: "TEST · Martha Cat"` read back as `" Martha Cat "`, and a later PATCH of `wmkf_firstname` alone re-derived `" TEST · Martha Cat "`. That derivation is the source of the uniform leading/trailing padding on all 4,368 rows; the adapter's own `wmkf_name` writes are overwritten. Consequence: never rely on a written `wmkf_name`; put anything that must persist (the factory's `TEST · ` prefix) in `wmkf_firstname` (`lib/services/reviewer-engagement/seed-synthetic-review.js` `syntheticPersonProjection`). [VERIFIED via grep] the potential-reviewer adapter is the ONLY writer of this field (discovery/save → `upsertByEmail`; no direct `wmkf_name` write to this entity elsewhere), and a full-table dry-run found 4368/4368 rows padded — i.e. the historical write path systematically stored `" first last "` (leading+trailing, plus a double space where a middle slot was empty). NOT re-verified: whether a Power Automate FLOW re-pads on write (metadata can't see flows; the write-stick test was deferred). Render-time defense exists ([VERIFIED] `ContactParser.normalizeDisplayName`, commit 3a359cc5, strips it in emails/UI). [VERIFIED — implemented] the adapter now normalizes `wmkf_name` on every write via `cleanName()` (= `normalizeDisplayName`) in `create`/`upsertByEmail`/`update` (`potential-reviewer.js`), so no NEW padding is stored. CAVEAT: `update`'s no-op guard (`fieldsEqual`, `:331`, trim+lowercase compare) treats a padded-vs-clean name as equal and SKIPS the write, so `update` does NOT self-heal already-padded rows — existing rows need a one-time cleanup that force-writes `wmkf_name` (bypassing the guard), not a plain `update()`.

## Standard Probe

```bash
rg -n "odata|\\$filter|RetrieveMultiple|restrictionContext|impersonat|publisherPrefix" lib/services lib/dataverse pages/api/dynamics-explorer docs
```

Then read `dynamics-service.js` plus the relevant Atlas entity page before
issuing a query or deploying schema.
