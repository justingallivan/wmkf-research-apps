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
| Publisher/API/package | No matching visible registration | Disabled publisher/API bootstrap after Windows/operator checks |
| Groups and budget control | Neither key returned | Review exact seeds before guard activation |
| Existing data | Two current Published prompt rows returned | Preserve both; use a new synthetic key |
| Solution | `wmkfResearchReviewAppSuite` exists, WMKF publisher | Confirm solution choice; do not create a competing publisher |
| App caller roles | Includes System Administrator and System Customizer | Not proof of Connor permissions or delegated/effective intersection |
| Windows parity | Offline bundle generated, not executed on Windows | Connor or supplied Windows session runs it |

## What Codex can do and still owns

Completed now: live read-only inventory, reusable restricted probe, validated
synthetic snapshot proposal and offline Windows bundle. Existing signed package
and source packet remain unchanged. The new seven-column/two-table shape is
implemented in SDK checks, but has not been provisioned in this environment.

Remaining implementation is ours to prepare, not a request for Connor to write
it: concrete additive schema/role/registration changes under the chosen solution;
a reviewed bound-release build/inspector (the preparation builder correctly
rejects actual bindings); a minimal delegated publication/readback command that
captures real IDs/ETags and retains the same UUID on uncertain outcomes; and
context evidence for the disabled main-operation bootstrap. The disabled template
rejects before SDK calls, so it cannot itself attest actual OwningExtension or
transaction context. Do not invent those values from the plug-in type ID.

The full Admin UI, all-consumer cutover and a Pre-Site publication are not needed
for this single synthetic test. Actual authorization, schema, active keys,
transaction/guard prerequisites and old-writer safety still apply. A successful
first test would not complete the race/rollback/bypass or two-client release
rehearsal.

## Inputs/actions needed from Justin or Connor

1. Confirm use of existing solution `wmkfResearchReviewAppSuite`, or Connor names
   another existing/approved solution. Its publisher is `WMKF_Publisher`, prefix
   `wmkf`; the resulting registered package name must be checked before creation.
2. Provide a Windows operator/session. The bundle requires Framework 4.8 and
   `sn.exe` from supported developer tools. Run the included `Run-WindowsChecks.ps1`
   and return `windows-check-result.json` plus the complete console output.
   Verify the supplied ZIP SHA256 before running it; internal manifest hashes
   detect drift but are not an independent authenticity signature.
   Do not install the package while running this offline check. Windows execution
   remains unverified until results are received.
3. Confirm the first human operator and their test-environment connection. Connor
   maintains the operation; initial access remains Connor and existing Admin
   superusers. The probe found enabled Connor Noda and Justin Gallivan records.
   Codex can resolve candidate IDs read-only, but names/roles alone
   do not authorize impersonation or establish the final approved actor binding.
4. Identify an approved secure key handoff/backup destination under Connor's
   control. The new key remains protected locally; it is not in this bundle,
   Git, the review prompt or package. No need to send passwords/API keys in chat.
5. Before guard activation, Connor identifies any test flows/scripts that write
   prompts, group settings or budget settings and arranges a quiet test window.
   Codex inventories repo writers; external flows cannot be assumed inactive.

These are prerequisites and concrete operator choices, not blanket approval for
unreviewed changes. The next live mutation should be a reviewed disabled bootstrap
with an exact change list, then bound rebuild/schema/guard preparation.

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

Contract-reconcile: local CLI → fixed-host GET → sanitized local evidence → owner
handoff; offline bundle → hash checks/Framework executable/strong-name checks →
result file. No live publication client or new runtime route is introduced.
Inventory partial failures are explicit; no UI async state or batch writes.
Bounded Sweep Mode A keeps the signed-package milestone unchanged as historical
local evidence and this report as the dated live prerequisite inventory. It
neither edits deployed Atlas ownership nor treats local checks as tenant proof.
[VERIFIED via local tests] SDK checks remain 1,478 passing; the new boundary
suite passes 13 tests, including a real conflicting shell-principal setup.
All seven scoped JavaScript suites pass 408 tests.
ESLint, packet checks, payload hashes and 21 relevant sequential gate/self-test
commands pass. The Windows bundle has 28 payload files and excludes private
keys/env files; actual Windows execution remains unverified.

Bundle: `dataverse/prompt-publication/artifacts/windows-handoff-02.zip` (local,
ignored). ZIP SHA256:
`50c889ef115569f108289fbb83e522abba5a9180df0707af4ae64fe82651d73a`.
Extract into a fresh folder on Windows, check this hash against the ZIP before
execution, and run `./Run-WindowsChecks.ps1` from a developer PowerShell with
`sn.exe` available. The runner records the package-source commit separately from
hashes of the preparation tooling. It does not connect to Dataverse.

Initial Fable review used OAuth session
`7e691559-d03d-46a7-9944-87ed37476cc0`, model `claude-fable-5-1` only.
Concrete fixes make explicit credential files authoritative, distinguish fixed
failure reasons, preserve Windows native error output, build checks into a fresh
output directory and reject extra Windows payload files. Direct source/packet
inspection refuted the reported missing human-candidate query (present in working
and staged source) and Checks/fixture provenance gap (all pinned in the packet
whose exact bytes match HEAD). The targeted correction review accepted all fixes and both refutations, inspected
the corrected 28-file handoff and found no remaining bounded-scope concern.
Both reviews used only Fable via subscription OAuth with no permission denials.
The tracked evidence is byte-identical to the final rerun, and local manifest
hash verification covers the copied runner too. Windows execution remains open.

Bounded reconciliation: the signed-package record remains true as local artifact
evidence; this report adds dated live test metadata and explicitly open operator/
Windows/registration gates. No live runtime ownership or production readiness
claim changed.
