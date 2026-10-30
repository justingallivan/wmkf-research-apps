---
title: Shared Prompt SDK and Sandbox Rehearsal Preparation
domain: ai-platform
kind: implementation-record
status: active
summary: Historical SDK transport checkpoint at ab19098f7; subsequent lifecycle/authorization work is recorded in the publisher milestone and remains local only.
canonical: false
cataloged: 2026-10-30
owner: product-engineering
related:
  - docs/plans/SHARED_PROMPT_TRANSACTION_MILESTONE_2026-10-30.md
  - docs/plans/PRE_SITE_PROMPT_READER_TRANSITION_2026-10-30.md
---

# SDK milestone and rehearsal preparation

Historical checkpoint at `ab19098f7`. The subsequent compiled lifecycle and guard
composition is recorded in [publisher milestone](SHARED_PROMPT_PUBLISHER_MILESTONE_2026-10-30.md);
production rules and registered entry remain pending.

[PARTIAL / LOCAL ONLY] Source is in `dataverse/prompt-publication`. No registered
IPlugin/Custom API, live client authentication, roles, schema or tenant writes.
This milestone starts the SDK implementation; it does not complete the shared
publisher or satisfy the sandbox deployment gates.

| Invariant | Enforcement | Verification |
|---|---|---|
| SDK writes use the platform transaction and effective actor | Context identity/organization/mode/transaction checks before each operation; platform factory uses UserId, never null/SYSTEM | Fake SDK request and changed-context negatives |
| Original row version is conditional and lossless | Exact weak-ETag grammar to decimal string; UpdateRequest IfRowVersionMatches; no retries/fallback/batch | Large token, wildcard/leading-zero/newline and fault tests |
| Complete inventory cannot silently truncate | No TopCount/distinct/joins/partial-start queries; ordered paging; cookie/duplicate/row-version/limit failures abort | Multiple pages plus malformed/missing/repeated pages |
| Published history content is never rewritten by activation | Explicit existing-table promotion/previous-clear attribute sets; draft baseline cleared | SDK request shape tests |
| Read-only preflight is not permission | WhoAmI organization match; published metadata requests only; no provision or mutation | Fake SDK message allowlist and unknown-read failure |
| Cross-language primitives preserve v1 fingerprints | Strict JSON parser, ordinal UTF16 ordering, binary64 tags and ASCII quoting | Existing shared canonical/snapshot/request goldens on .NET8; net48 compilation only |
| Rehearsal remains prepared, not executable | Source-hashed packet, null approved live bindings and authority=false | Deterministic drift check; no live execution mode |

## Scope and remaining proof

Transport compiles against the real Dataverse SDK for net48 and net8.0. The local
harness runs net8.0 on macOS; compiling net48 does NOT execute Framework runtime
parity. Canonical primitives pass the existing fingerprint vectors; complete
.NET definition/template/model/budget/request/receipt validators and their full
parity suite remain unimplemented. A hash result is not validation/authorization.

TransactionSdk is not a transaction manager or publisher-role check. It needs a
trusted platform context/factory and server-owned expected organization. The
caller must authorize publishers, prove organization-wide Read (security-filtered
results cannot attest complete history), and verify the target/release binding before
construction. It never establishes a transaction or retries a fault. The SDK
port still needs head/receipt table mappings, live group/removal coordination,
full validation, receipt replay and trusted-parent/raw-write guards before any
IPlugin is exposed. Table/API logical names and actual role/privilege bindings
remain unprovisioned; packet nulls deliberately prevent calling them.

PromptRows reads every status/current state of the canonical name and uses
explicit conditional promotion/clear writes on the existing prompt table. Its
new draft-baseline field is proposed source, NOT live-schema evidence. The
read-only preflight currently inspects basic lifecycle, publication datetime and all three status values, plus the seven proposed
catalog/baseline columns; head/receipt metadata, full Executor projection,
actual null-version draft behavior, permissions, Active indexes and rollback
must still be proved. Metadata faults remain unknown; no mutation follows.

The SDK inventory is not yet the complete reference-core DTO: it still needs
all six catalog projections and mapping through the tested exact weak-ETag
reconstruction helper after metadata proof. Framework parsing is not assumed equal to net8. The same harness now
compiles for net48 with 17-digit, half-even and subnormal numeric vectors; actual
Windows Framework execution remains a blocking parity gate. Newtonsoft requires
the supported dependent-assembly plug-in package model, not a lone DLL upload.

The packet contains 21 concrete rehearsal cases, the approved sandbox hostname,
source/lock/golden/policy hashes and explicit preparation-only authority. It does
not infer a sandbox organization GUID, granted role, Custom API or table name.
No command logs in, registers a plug-in, creates a draft or cleans tenant state.
Use the Pre-Site runbook's separate old-reader pause-only commit, original actor
UUID recovery and queue cleanup procedure; main remains merge-blocked.

Contract-reconcile Mode B: SDK caller → trusted execution context → explicit
IOrganizationService message → fake SDK response → test. SDK faults propagate;
no partial-success translation or async/background work. Helpers preserve
original row versions and prompt fields. No database/schema/route/status change.
Source headers, local README/packet and this record define boundaries; previous
SDK-unavailable checkpoint is historical. Tenant atomicity and deployed-state
claims remain PLANNED, not inferred from local tests.

## Verification and review disposition

[VERIFIED via local commands] The isolated SDK runner restored locked public
packages, built Transport and Checks for net48/net8 with zero warnings/errors,
passed 126 offline net8 checks and verified the preparation packet. All 384
publication Jest tests passed; the packet test also passed independently (8/8).
Policy/golden drift and independent Python fingerprints passed. ESLint, shell
syntax, diff whitespace and 29 sequential repository gate/self-test commands
passed. No tenant connection or provider call was made by these checks.

[VERIFIED via Claude Fable OAuth review] Session
`6fa92462-8e21-4aac-8ca2-4e39040e35d3`, actual model
`claude-fable-5-1`, accepted this scope after rechecking all seven findings:
metadata timestamp/options, packet target/source binding, composition boundary,
hard numeric vectors, paging/write-shape coverage, dependent packaging and
null/empty input rejection. No new blocking defect or permission denial remained.
The reviewer reran 126 SDK checks, eight packet tests and the dual-target build.
This was an ordinary subscription/OAuth model review, not a metered review product.

[PLANNED] Actual Windows Framework execution, catalog/baseline metadata proof,
organization-wide Read, live concurrency/transaction rollback (including row
versions after earlier same-transaction writes), full publisher/validators,
head/receipt mappings, registration, roles/raw-write guards and packaging remain
release gates. No deployment or live rehearsal has occurred. The packet checker
requires the repository's full development dependency install (Babel parser).
