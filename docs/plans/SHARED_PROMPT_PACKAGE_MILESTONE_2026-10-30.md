---
title: Shared Prompt Signed Package and Registration Preparation
kind: implementation-record
domain: ai-platform
status: historical
summary: Signed disabled dependent-assembly package and offline registration plan exist; key handoff, Windows execution, solution construction and tenant registration remain pending.
canonical: false
cataloged: 2026-10-30
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_LIBRARY_PLAN_2026-10-29.md
  - docs/plans/SHARED_PROMPT_PRODUCTION_RULES_MILESTONE_2026-10-30.md
---

# Signed package and registration preparation

Historical checkpoint at 617ad8150. Current bootstrap order, bound-disabled
inspection and corrected Windows handoff supersede this checkpoint; see
[the schema/client milestone](PR553_SCHEMA_AND_FIRST_CLIENT_MILESTONE_2026-10-30.md).

[VERIFIED via local build and offline inspector] A dependent-assembly NuGet
package contains only the net48 publication assembly and approved Newtonsoft.Json
13.0.3 assembly under `lib/net48`. Microsoft SDK assemblies are server supplied
and excluded. Both included assemblies have cryptographically verified full
strong-name signatures. The archive has no NuGet certificate signature. Its package hash identifies
the exact archive bytes; it is not a reproducible build identity because NuGet
entry timestamps and generated metadata names can change. Strong
naming identifies assemblies; it does not establish certificate trust.

[OWNER DECIDED] Use a new signing key that Connor will retain. The key was created
locally with private directory/file permissions (0700/0600), outside tracked
source and excluded from Git. Only its public identity is tracked. Secure
transfer and a retained backup under Connor's control remain pending; do not
send key bytes in chat, source control, package contents or agent reviews.
Public key token: `e1c3ac684f7d4e11`. Public-key SHA256:
`5300ed32f2de9e08f15c6853102d2c7fae64115ad1199e8f36a8cb2ed6b425ed`.

Microsoft supports the dependent-assembly package model and makes strong naming
optional for that model. Signing is retained here per owner direction. Signed
assembly dependencies must also be signed; SDK assemblies must not be bundled.
Package name/version cannot be changed after registration. See
[Microsoft build/package guidance](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/build-and-package).
Keep package `WMKF.PromptPublication` version `1.0.0`, assembly identity and the
retained key stable through the disabled bootstrap and bound rebuild.

| Invariant | Enforcement | Evidence |
|---|---|---|
| Preparation cannot authorize live operations | No deployment/login/execute command; disabled embedded bindings; all plan phases unapproved | Inspector and preparation script |
| Artifact matches reviewed source | Signed assembly metadata binds the source packet; packet checks all source hashes | Source drift negative and packet check |
| Artifact contains no accidental build/key/SDK output | Exact archive-entry allowlist and exactly two expected assemblies | Extra key, SDK, framework and duplicate-entry negatives |
| Signatures are real, not public-sign placeholders | Independent PE strong-name verification of plug-in and vendor dependency | Changed signature/body and zero-signature negatives |
| Receipt describes exact artifact | Reinspect archive and compare complete receipt | Hash and embedded resource checks |
| Keys cannot be silently replaced | Create-new files and pinned public identity; builder checks private-file permissions | Overwrite denial and permission checks |

Microsoft's current [supported customizations guidance](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/supported-customizations#support-for-net-framework-versions)
explicitly supports plug-in assemblies targeting Framework 4.6.2 through 4.8 and
recommends 4.8. The older net462 packaging example does not establish a 4.8
prohibition. Actual registration tooling/tenant acceptance and Windows execution
remain gates; no package is uploaded to infer support.

## Local flow and limits

`build-prompt-publication-package.cjs` checks the rehearsal packet, builds net48
with the retained key, packs an explicit two-assembly allowlist and runs the
standalone metadata inspector. Transport itself is locked-restored before build.
The signed source-packet hash is the provenance anchor; automatic Git revision
metadata is disabled, since local builds can include uncommitted reviewed source.
The inspector rejects misleading revision metadata. The inspector does not load or execute the plug-in.
It bounds archive/entry sizes, rejects unexpected entries/dependencies, verifies
signatures, exact identities and embedded resources, and recomputes the receipt.
`prepare-prompt-publication-registration.cjs` verifies the receipt and writes a
reviewable plan with sandbox host `orgd9e66399.crm.dynamics.com`, null actual
organization/extension/privilege IDs and empty approved-principal lists.
The preparer locked-restores and rebuilds the inspector without incremental
reuse before verifying the receipt. Neither script connects to Dataverse. A failed build leaves an incomplete local
output directory; use a new directory after correcting the failure. No generated
package, binary, private key or build cache is tracked.

The source policy remains revision 5/hash
`50bcb07a28fd786b1000e6527bd1b06c34170e0088ede2bc35228ebba1f76c5b`.
The packaged tenant bindings are disabled and unbound. This preparation builder
intentionally rejects populated live bindings; a separately reviewed release
build is required for that later step. A signed package is not a managed solution,
registered Custom API, proof of actual Framework execution or tenant rollback.

## Connor's registration handoff

[PLANNED; no live steps approved] Before registration, securely transfer/retain
the signing key, confirm the public pin and inventory existing package/assembly
identities to avoid an accidental collision. Review the solution unique name,
publisher prefix and resulting registered package name as separate unresolved
bindings; the NuGet ID alone is not the platform registration name. Independently establish the exact
sandbox organization identity, operator privileges and supported registration
tool versions. No guessed GUID, role grant or bypass permission is acceptable.

1. Run actual Windows Framework checks, including numeric/definition/wire goldens,
   and independently verify the strong name with supported Windows tooling.
2. Review and authorize the concrete disabled publisher/API bootstrap. Defer
   guards. Observe the actual main-operation OwningExtension and transaction
   context; never infer its GUID or entity type from a plug-in type ID.
3. Populate reviewed bindings with `enabled=false`, actual organization/extension,
   exact execute privilege, human publishers and initiating principals. Rebuild
   with the same retained key/package identity and review a distinct receipt.
4. Separately approve additive schema/Active keys, lookup protections, exact
   roles and seed records. Seed groups/budget control before guards. Freeze or
   migrate existing prompt/seed/budget/catalog writers before guard activation.
5. Review registration images, individual/merged bulk paths and settings alternate
   coverage. Prove calling-user identity, original RowVersion, parent permits,
   same-value CAS advance, uniqueness and whole-transaction rollback. Do not
   install blanket settings denials that block unrelated settings writers.
6. Only after applicable proofs, authorize enabled bindings and both-client
   rehearsal. Retain same-UUID recovery and exact receipt/current readback;
   preserve the coordinated Pre-Site reader/prompt transition and writer drain.

Connor owns the operation/solution. Initial human publication access remains
Connor and existing Admin superusers; this is intent, not a role grant. No
registration, solution import, provisioning, live write, merge or deployment
was performed for this milestone.

## Contract and reconciliation boundary

Contract-reconcile Mode B traces local CLI arguments → source/key inputs → signed
assembly → bounded package inspector → immutable preparation receipt → offline
registration plan. No client state, asynchronous UI, runtime publication batch,
new persisted Dataverse field/status or route exists in this change; those audits
are N/A. Build failures propagate; no partial output authorizes registration.
Existing runtime publication/Atlas ownership and database schema are unchanged.

Bounded Sweep Mode A covers the changed packaging fact. Source, actual archive
and receipt establish local existence independently of docs. Current plan and
both READMEs describe the signed preparation package; the preceding production
rules record is explicitly historical. Earlier SDK/publisher records retain
historical boundaries. Tenant registration, actual bindings, Windows execution
and secure key handoff remain unproved release gates.

## Final verification

[VERIFIED via local commands] Framework/net8 builds have zero warnings/errors;
the SDK harness passes 1,478 checks. Six scoped Jest suites pass 395 tests.
The packaging harness passes 13 checks; the actual receipt-verification command rejects a changed artifact hash. Eight
additional CLI negative shapes
reject deployment/invalid/overwrite arguments before tool execution. Policy,
golden and independent Python fingerprints, packet/receipt checks, ESLint,
whitespace and 29 sequential relevant repository gates/self-tests pass.

Local artifact: `dataverse/prompt-publication/artifacts/preparation-06/WMKF.PromptPublication.1.0.0.nupkg`
(ignored, not committed). Package SHA256:
`8347c6f2255b72a21f165046dbda5b0ed9a50ecb5fc26970a72ae2a0a1bc5f67`.
Source packet SHA256:
`a5b20da71f65b10e527cd26e4342ae6a7340b47b8ca59180c645c8e52d221122`.
The adjacent receipt and registration preparation JSON record the exact artifact
and unresolved/unapproved live steps. Any source-packet change requires a new
signed artifact and receipt; reuse the retained key, never regenerate it.

Fable's initial review (OAuth session `996a0bd1-40c7-4208-b472-46278b79bead`,
model `claude-fable-5-1` only) identified the missing Transport restore, misleading
Git metadata, stale inspector reuse and archive-hash ambiguity. Those corrections
are implemented as described above; reference/attribute identity checks are also
tighter. Two no-incremental builds produce identical assembly hashes and distinct
archive hashes. The targeted correction review accepted all five fixes and found no remaining
blocker for this disabled offline milestone. Both reviews used only Fable through
subscription OAuth, with no reported permission denials, helper models or
metered products. Fable independently checked the final archive metadata,
matching staged/source packet and identical assembly hashes. Secure key transfer,
Windows execution and bound-release/tenant gates remain open.

Bounded reconciliation result: current plan/READMEs and this record agree with
source and actual archive/receipt evidence. Repeated packaging-state searches
leave no live stale claim in those surfaces. The prior production-rules record
is historical. No runtime/Atlas deployment fact was changed. The exact commit
containing this packet must accompany any later handoff; the artifact deliberately
does not assert a Git commit.
