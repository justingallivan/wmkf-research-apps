---
title: PR553 First Test Publication and Readback
kind: runbook
domain: ai-platform
status: active
summary: Live read-only test-environment inventory and offline Windows handoff; exact owner inputs and remaining implementation before one synthetic publication.
canonical: false
cataloged: 2026-10-30
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_PACKAGE_MILESTONE_2026-10-30.md
  - docs/plans/SHARED_PROMPT_PUBLICATION_CONTRACT_2026-10-29.md
---

# First publication and readback

[VERIFIED via read-only probes, 2026-10-30] Test host
`orgd9e66399.crm.dynamics.com` is reachable using the existing application
credentials. WhoAmI and the organization row agree on organization ID
`3d52a072-b138-ef11-8e4b-000d3a106422`. This is application access, not a
Connor delegated session. No production request, schema/role change, registration,
prompt write or model invocation was performed.

Evidence:
`evidence/pr553-test-schema-2026-10-30.json` and
`evidence/pr553-test-registration-2026-10-30.json`.
Reproduce with the existing schema probe using `--sandbox` and an explicit
`DYNAMICS_SANDBOX_URL=https://orgd9e66399.crm.dynamics.com`, then
`probe-prompt-publication-test-readiness.cjs --env-file ABS --output NEW_ABS`.
The latter pins the tracked test host and permits only GET after token exchange.
An inventory error is unverified, never converted into absence. Empty readable
inventory remains qualified by the application principal's visibility.

| Prerequisite | Observed evidence | Next action |
|---|---|---|
| Test connectivity and organization | Both read checks succeeded | Owner/operator corroborates organization in their connection |
| Existing prompt/settings tables | Both have concurrency; settings key Active | Preserve tables and existing rows |
| Prompt additions | Six metadata fields plus draft baseline absent | Prepare/review additive solution changes below |
| New head/receipt tables | Not in returned metadata | Create OrganizationOwned tables, keys and lookup protections |
| Publisher/API/package | No matching visible registration | Additive schema and receipt Create privilege first; disabled API after Windows/operator checks |
| Groups and budget control | Neither key returned | Review exact seeds before guard activation |
| Existing data | Two current Published prompt rows returned | Preserve both; use a new synthetic key |
| Solution | `wmkfResearchReviewAppSuite` exists, WMKF publisher | Owner selected this solution; preserve its publisher |
| App caller roles | Includes System Administrator and System Customizer | Not proof of Connor permissions or delegated/effective intersection |
| Windows parity | Offline bundle generated, not executed on Windows | No Windows access available yet; execution pending |

## What Codex can do and still owns

Completed locally: read-only inventory; additive schema request planner; a
validated synthetic snapshot; bound-disabled package build/inspection; a
content-free unbound bootstrap trace; request/recovery/readback contracts and an
offline request-state command. Schema and operation remain unprovisioned.
Current implementation and verification are recorded in
[the schema/client milestone](PR553_SCHEMA_AND_FIRST_CLIENT_MILESTONE_2026-10-30.md).

Remaining implementation is ours, not a request for Connor to write it: approved
metadata execution/readback, actual identity/privilege/context binding and later
enablement tooling, plus live delegated transport and draft creation. The local
client port is unwired. Its offline command prepares a request from observed
IDs/ETags but cannot authenticate or publish. The disabled/null template can
trace actual context before its original denial without SDK calls; actual
OwningExtension, transaction and trace availability remain unverified until the
approved tenant session. Do not invent values from a plug-in type ID.

The full Admin UI, all-consumer cutover and a Pre-Site publication are not needed
for this single synthetic test. Actual authorization, schema, active keys,
transaction/guard prerequisites and old-writer safety still apply. A successful
first test would not complete the race/rollback/bypass or two-client release
rehearsal.

## Owner decisions and remaining inputs

[OWNER CONFIRMED, 2026-10-30] Use the existing Research Review App Suite solution
(`wmkfResearchReviewAppSuite`) and its `WMKF_Publisher` publisher, prefix `wmkf`.
The resulting registered package name still must be checked before creation.
Windows access is not available yet. This blocks Windows execution evidence and
the subsequent registration/publication steps, but does not block local schema,
bound-package tooling or publication/readback command preparation. No substitute
runtime is accepted as actual Windows Framework proof.

1. When Windows access becomes available, provide an operator/session. The bundle requires Framework 4.8 and
   `sn.exe` from supported developer tools. Run the included `Run-WindowsChecks.ps1`
   and return `windows-check-result.json` plus the complete console output.
   Verify the supplied ZIP SHA256 before running it; internal manifest hashes
   detect drift but are not an independent authenticity signature.
   Do not install the package while running this offline check. Windows execution
   remains unverified until results are received.
2. Confirm the first human operator and their test-environment connection. Connor
   maintains the operation; initial access remains Connor and existing Admin
   superusers. The probe found enabled Connor Noda and Justin Gallivan records.
   Codex can resolve candidate IDs read-only, but names/roles alone
   do not authorize impersonation or establish the final approved actor binding.
3. Identify an approved secure key handoff/backup destination under Connor's
   control. The new key remains protected locally; it is not in this bundle,
   Git, the review prompt or package. No need to send passwords/API keys in chat.
4. Before guard activation, Connor identifies any test flows/scripts that write
   prompts, group settings or budget settings and arranges a quiet test window.
   Codex inventories repo writers; external flows cannot be assumed inactive.

These are prerequisites and concrete operator choices, not blanket approval for
unreviewed changes. The next live mutation should be reviewed additive schema preparation without
guards. Resolve the actual receipt Create privilege before registering the
disabled publisher/API; then observe context, rebuild bound-disabled, seed and
freeze old writers before guards. Windows/operator gates still apply.

## Proposed additive schema checklist

This checklist comes from `PromptSchemaPreflight` and `PublicationSchema`, not a
claim that fields exist. Solution scripts must validate existing metadata and
refuse a conflicting shape rather than overwrite it.

- Prompt: `wmkf_ai_displaytitle` String 200; `wmkf_ai_description` Memo 4000;
  `wmkf_ai_groupkey`/`wmkf_ai_sectionkey` String 80;
  `wmkf_ai_usedby` Memo 4000; `wmkf_ai_usagecategory` String 40;
  `wmkf_ai_draftbaseline` Memo 16000.
- Head `wmkf_promptpublicationhead`: OrganizationOwned, concurrency;
  `wmkf_keyhash` String 64 with one exact Active unique key;
  `wmkf_promptkey`/`wmkf_originalkey` String 850;
  `wmkf_revision` String 19; `wmkf_highwaterversion` Integer 0..2147483647;
  `wmkf_currentversion` Integer 1..2147483647;
  `wmkf_currentprompt` Lookup to prompt with reviewed restricted deletion.
- Receipt `wmkf_promptpublicationreceipt`: OrganizationOwned, concurrency;
  `wmkf_requestid` String 36 with one exact Active unique key;
  `wmkf_payload` Memo 65536.
- Preserve complete definition memo lengths, model/token/temperature ranges and
  published lifecycle choices. The current probe establishes existing types and
  lengths but does not attest every numeric range or guard behavior.
- Keep keys/status/current/version requiredness compatible with null-version
  drafts; guards enforce required control identities. No automatic head creation
  by readers and no mutation of the two existing prompts.

## Acceptance of the first synthetic publication

Proposal: `dataverse/prompt-publication/rehearsal/first-publication-proposal.json`.
Its definition passes the local v1 validator and has a snapshot hash; no draft,
request UUID, ETag or complete executable publication request has been invented.
The proposed group seed is exact and test-only, not an instruction to replace an
existing catalog. Re-read first; if one appeared since the probe, reconcile it.

After the applicable reviewed preparation and Windows proof:

1. Corroborate organization and approved human/initiating principal. Re-read
   complete history and require the proposed synthetic key is unused.
2. Create one Draft/noncurrent/null-version prompt and preserve its real ID,
   ETag and server-owned baseline. Do not reserve a version number.
3. Submit one full request with original expected state and a durable UUID through
   the shared Action. A lost response is unknown; recover/retry that same UUID.
4. Independently read receipt, head and complete exact-key prompt inventory.
   Require one current Published row, matching GUID/version/head, immutable
   receipt actor/request/snapshot and no partial lifecycle state.
5. Retry the identical request/UUID. Require the original receipt and no new
   version or second receipt. Keep exact evidence without credentials/content
   from unrelated prompts. Do not execute the synthetic prompt with a model.

## Verification boundary

The dated read-only evidence above remains unchanged as an observation of the
test environment. Local implementation has advanced; use the current
[schema/client milestone](PR553_SCHEMA_AND_FIRST_CLIENT_MILESTONE_2026-10-30.md)
for source, review, test counts and the replacement Windows artifact.

The earlier `windows-handoff-02.zip` is superseded: it omitted a registration
manifest and used a fixture layout that would fail part of the check harness.
Use only the corrected replacement. Windows tools are unchanged, but actual
Framework execution is still pending. Portable net8 execution validates the
copied bundle layout, not Windows semantics.

Contract-reconcile traces local preparation through future authenticated port,
receipt and readback; no live client, schema writer or deployment is claimed.
Current runtime/Atlas ownership and production state remain unchanged.
