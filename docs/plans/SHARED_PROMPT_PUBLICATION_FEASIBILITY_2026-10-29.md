---
title: Shared Dataverse Prompt Publication Feasibility
domain: ai-platform
kind: audit
status: active
summary: Platform documentation supports a two-client Dataverse publication Action; tenant deployment and concurrency rehearsal remain explicit implementation gates.
canonical: false
cataloged: 2026-10-29
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md
  - docs/plans/SHARED_PROMPT_PUBLICATION_CONTRACT_2026-10-29.md
---

# Shared Dataverse publication feasibility

## Verdict and evidence boundary

**READY WITH NAMED GATES for a separately authorized sandbox spike; not approved
for Production implementation/deployment.** A shared Dataverse Custom API Action
is practical at the documented platform level. It can be called by both Admin's
server and Connor's tools without requiring Connor to use Admin. This assessment
is based on Microsoft documentation and repository inspection on 2026-10-29;
the initial assessment performed no tenant probe, schema write, plug-in
registration, identity grant, sandbox execution or model call. The later
authorized read-only example probe is recorded separately in the technical
preflight and does not establish deployed publication behavior.

Owner direction: future prompts share the existing table and group field;
versioned publication is accessible through both routes. At the initial assessment, existing Power Automate
flows/definitions had not been inspected; the subsequent authorized discovery
result is recorded in the linked technical preflight. The user-supplied historical AI-run
form was accessible read-only but did not identify its source prompt/flow.
**[OWNER CONFIRMED, per Justin]** Connor agrees to adopt the existing stored app
prompt format in future PA flows. Library construction/rehearsal/release does
not depend on locating the historical flow. Do not infer universal runtime
feature support or tenant deployment readiness from this agreement.

## Platform evidence

| Capability | Primary source and bounded conclusion | Status |
|---|---|---|
| Shared server operation | [Custom APIs](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/custom-api): code and Power Automate can call an Action with plug-in main-operation logic. Use a mutating Action, not a Function/event-only endpoint. | VERIFIED, documented capability |
| Atomic work | [Database transactions](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/scalable-customization-design/database-transactions): synchronous in-context organization-service requests participate in the transaction; same-org Web API calls do not preserve that context. [Microsoft Custom API example](https://www.microsoft.com/en-us/power-platform/blog/2026/10/26/custom-apis-just-landed-in-the-dataverse-mcp-server-agents-just-got-smarter/) explicitly describes one transaction and rollback. Require `IsInTransaction` and prove the deployed message's behavior. | VERIFIED platform; tenant NOT TESTED |
| Concurrency | [Optimistic concurrency](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/optimistic-concurrency): SDK conditional updates use `IfRowVersionMatches`. A transaction alone is insufficient to serialize simultaneous first publications; use a unique per-key head plus conditional revision update. | VERIFIED primitive; proposed composition NOT TESTED |
| Unique identity/receipts | [Alternate keys](https://learn.microsoft.com/en-us/power-apps/maker/common-data-service/define-alternate-keys-reference-records): uniqueness excludes null keys; indexes must be Active; size limited to 900 bytes. Required bounded digest/request keys avoid the existing 850-character name-size issue. Compare original names to reject digest collisions. | VERIFIED constraints; new tables NOT PROVISIONED |
| Reader identity | [Dataverse string filtering](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/query/filter-rows) is case insensitive. Head identity must match reader equivalence; canonical lowercase ASCII keys, direct-alias rejection and legacy collision audit prevent separate heads for the same reader identity. Unsupported collation cases block cutover pending explicit mapping. | VERIFIED platform; mapping/races NOT TESTED |
| Client authentication | [OAuth](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/authenticate-oauth): delegated user access through Entra/MSAL is supported. Existing/new registration consent and roles still require tenant verification. | VERIFIED platform; tool/roles NOT TESTED |
| Authorization and actor | [Custom API security](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/custom-api): use an existing execution privilege; arbitrary new privileges cannot simply be invented. `IsPrivate` is discoverability, not security. [Plug-in identity](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/impersonate-a-user) and [Web API impersonation](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/impersonate-another-user-web-api) support caller contexts subject to privileges. | VERIFIED platform; exact role/attribution NOT TESTED |
| Deployment/support | [Custom API solution authoring](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/custom-api) supports solution components; [plug-in authoring](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/write-plug-in) requires .NET plug-in code. Versioned source/solution, managed deployment and operational ownership are additional work. | VERIFIED requirement; owner Connor DECIDED; toolchain UNKNOWN |

## Repository prerequisites and disconfirming checks

| Recommendation | Current prerequisite / execution point | Evidence tested | Disconfirming check / remaining gate | Status |
|---|---|---|---|---|
| Move publication authority to Dataverse | Admin currently uses `lib/services/admin/prompts-publish-service.js`; adapter `lib/dataverse/adapters/ai-prompt.js` reads/writes current/version rows | Read publisher and adapter: fresh publication creates then clears prior, not one transaction; first publication currently requires a current row | Attempt two first publications against the proposed head guard; exactly one expected-state winner, no orphaned current rows | PLANNED; platform-feasible |
| Use synchronous SDK transaction | `lib/services/dynamics/changeset.js` proves an existing app-side atomic batch seam, but is not a server plug-in or cross-client authority | Read source; do not equate an HTTP/parser throw with proven rollback (lost response is unknown) | Inject failure after head/draft/prior writes and before receipt commit; independently read rows and prove all rolled back | NOT TESTED in tenant |
| Keep existing readers compatible | `ai-prompt.js` `getCurrentForExecutor` filters current, rejects zero/duplicates, does not require Published status | Read complete adapter; raw `wmkf_ai_iscurrent`, `wmkf_promptversion`, status, seed and publication searches identify fan-out scope | Add status guard; enumerate every raw reader/writer, projection, cache and fallback before cutover | PARTIAL; migration required |
| Assign version on publication | Existing numeric `wmkf_promptversion`; retained 2026-10-29 schema snapshot has existing rows/history and no alternate key | Existing read-only snapshot retained unchanged; no new live requiredness/write test | Save/reload a null-version draft, prove non-execution; if schema rejects it stop for additive adjustment | PARTIAL: platform supports API null; tenant NOT TESTED |
| Support Connor's independent command | Authenticated Dataverse endpoint with trusted actor, same policy/receipt as Admin | Official OAuth/Custom API documentation, no credential or role mutation | Publish from actual delegated Connor identity, deny an unauthorized user and prove initiating/effective actor; no Admin cookie | PLANNED; NOT TESTED |
| Separate shared lifecycle and common-format checks | Existing publisher uses JS model/output/template/budget checks and `loadAvailableModels` | Read logical validation region and existing Executor contract | Both clients must pass shared rules plus common app-format checks; parity in JS/.NET, unknown-format rejection and budget races; no flow-discovery dependency | NEEDS DESIGN before build |

Repository inspection used CodeGraph first; it returned unrelated symbols for
these named files, so exact source was read directly. `git ls-files '*.csproj'
'*.sln'` found no tracked .NET build project. `command -v dotnet` and `command -v
pac` returned no executable in this session's PATH; this is not proof that no
other host/machine can build/deploy. No package installation was attempted.
The existing tracked `lib/dataverse/schema/solution.json` is schema metadata, not
evidence that the proposed plug-in/API exists or is deployable by this identity.

## Proposed end-to-end contract

Admin / Connor command → OAuth + role enforcement → shared Action → conditional
head revision → shared-state plus common-format validation → version assignment and
conditional lifecycle writes → receipt in same transaction → both clients receive
receipt/current separately → apps/flows resolve sole current Published row.

Two new small tables (head and receipts) provide shared coordination/audit;
a seventh prompt column stores the draft metadata baseline durably.
Prompt content remains in the existing table. Dataverse guards protect lifecycle,
content immutability, heads/receipts and direct draft invariants. This is additional
schema/solution work compared with the prior six-column proposal. Table names,
roles are not yet provisioned; Connor is the owner-confirmed solution maintainer. Postgres audit is legacy
history/optional mirror, not a required shared publication dependency.

The head+CAS composition is a design inference from documented primitives, not a
sandbox-proved guarantee. Do not use a Vercel/Postgres lock to claim protection
for external direct writers. No draft reserves a published number. Atomicity and
serialization, replay and authorization are separate obligations.

A content hash and request fingerprint are distinct. The versioned canonical
request fingerprint binds operation, canonical/original key, authenticated actor,
draft GUID/ETag, expected head revision and active GUID/version/ETag, metadata
baseline, complete staged content/catalog hash, and submitted wire-contract,
definition-format and policy versions. Store both hashes in the receipt. Reusing a UUID with ANY changed
request field is rejected, even for identical text in a different draft. An
unchanged successful replay returns its original receipt before checking newer
state or policy; authorization is still required. A fresh request must use the
currently accepted policy. Never rebuild the replay fingerprint from today's
active row, generated publication time or latest policy.

## Seven contract audits

1. Whole flow: entry points, auth, head/draft/current/receipt persistence and
   consumers named above. No implementation claimed.
2. Partial success: new operation is one transaction; timeout resolves by unique
   receipt, never a fabricated failure or blind resend. Legacy torn states block.
3. Async/stale state: expected head/current/draft plus metadata baseline; replay
   before freshness; UI generation/abort guards and cache semantics are build gates.
4. Helper semantics: one Dataverse authority, two clients; Admin session guard
   and delegated backend identity remain distinct; no .NET helper yet exists.
5. Durable surfaces: new Dataverse tables/solution/roles/guards need schema/Atlas,
   service/security catalog, policy fixtures, rollout and retention documentation
   during build. No SQL migration is required merely to publish from Connor's tool;
   any optional mirror change must preserve old pending/final constraints.
6. Doc reconciliation: bounded Sweep Mode A for changed target architecture;
   existing-runtime docs remain current until implementation. Two proposal docs
   rewritten structurally; PR description updated. No concurrent main handoff edit.
7. Symbol fan-out: raw current/version/status readers and all seed/upsert writers
   remain migration scope; complete paging and status checks are required. A
   library plan cannot prove existing flow selection/caching semantics.

## Required sandbox acceptance, ownership and release boundary

- Connor is the owner-confirmed maintainer; initial human publishers are Connor
  and existing Admin superusers. Verify tooling, mapped identities and actual
  sandbox deployment privileges before build.
- Prove transaction context and rollback at every write boundary, unique-key
  activation, simultaneous first/later publications, stale head/draft/current,
  duplicate UUID retry and lost response after commit followed by later publish.
- Prove direct/bulk bypass denial, metadata ETag conflicts, delegated and Admin
  identity attribution, and least-privilege execute-role behavior. No broad app
  impersonation fallback is acceptable.
- Agree nullable draft storage, legacy head high-water initialization, explicit
  recovery for corrupt states, and seed/raw-writer cutover under writer freeze.
- Finalize the agreed common app-format validation policy, JS/.NET parity,
  model/budget freshness and unknown-format/policy rejection. Keep shared
  lifecycle rules distinct from definition checks; both are mandatory in the
  publication transaction. Flow-specific execution remains separately verified.
- Use a new common-format fixture to rehearse both publication clients. Finding
  the old Power Automate flow, publishing its legacy definition unchanged, or
  migrating it is not a prerequisite for library construction or release.
- Only then authorize Production additive provisioning/cutover separately. The
  first publication release must include both clients; no Admin-only substitution.

## Reconciliation and verification record

Sweep Mode A; domain is this PR's changed target publication architecture.
Searches: shared-library filenames, shared publisher, Admin-only publishing,
reserved draft/version, Postgres lock, PR #553 and coordination-decision phrases
across docs, memory/wiki, session instructions, runtime/scripts and tests.
Proposal restatements occur in the two plan/contract documents and PR body;
those are rewritten. Runtime/Atlas/memory describe the existing implementation
and are AGREE for current state; dated old implementation evidence stays
HISTORICAL. Concurrent main SESSION_PROMPT handoff is outside this branch edit
ownership; this report/PR body provide the new resume boundary.

Claims: documented platform primitives VERIFIED; head+CAS design PLANNED;
tenant permissions/tooling and sandbox correctness UNKNOWN; prior Admin-first
and reserved-draft target STALE and replaced. Remaining live stale target claims
in the two proposal documents/PR body must be zero before closeout. This is not
a whole-repository runtime migration audit or a new live-schema verification.

Final verification: doc-currency, fact-consistency, canonical-pointers,
doc-symbol-refs, build-claim-freshness, docs-catalog, secret-scan and
scaffolding-tokens passed; every available paired self-test ran sequentially
and passed (15 commands total). `git diff --check` passed. Catalog regeneration
produced no tracked change because these documents are nested plan files.
No runtime test/build or tenant rehearsal was run for this docs-only revision.

Independent read-only contract review (`/root/review_pr553`) identified four
findings: case-sensitive head identity mismatched Dataverse reader identity;
stale app-only authority remained; draft baseline/catalog audit storage was
underspecified; replay fingerprint omitted complete request identity. All four
were corrected and independently rechecked with no residual blocker from those
findings. Sandbox/role/draft-schema/policy prerequisites remain open; see the subsequent
[technical preflight](SHARED_PROMPT_PUBLICATION_PREFLIGHT_2026-10-29.md) for
approved ownership/access, ApplicationRequired semantics, source findings and
307 passing baseline tests.

Final targeted searches found zero remaining live superseded instructions in
the proposal documents; references to former app-only/reserved-draft behavior
are explicitly historical or prohibited alternatives. Verdict: RECONCILED for
the bounded changed target; tenant feasibility remains UNKNOWN until the named
sandbox spike. No current runtime/governance behavior was relabeled as shipped.
