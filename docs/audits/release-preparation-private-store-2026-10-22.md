---
title: Private Store and Release Preparation Receipt
domain: engineering-process
kind: audit
status: active
summary: "Evidence receipt for the 2026-10-22 private Blob store investigation and unreleased campaign-runtime candidate."
canonical: false
cataloged: 2026-10-22
last_verified: 2026-10-22
owner: product-engineering
related:
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/REVIEWER_E2E_REHEARSAL_RUNBOOK.md
  - docs/audits/historical-impact-concurrency-followup-2026-10-22.md
  - docs/audits/blob-store-binding-evidence-2026-10-22.json
  - docs/audits/blob-retention-metadata-evidence-2026-10-22.json
---

# Private Store and Release Preparation Receipt

**Assessment date:** 2026-10-22 (America/Los_Angeles)  
**Status:** LOCAL PREPARATION COMPLETE — release authorization, Node 22/Linux parity, hosted rehearsal, and private-store binding remain incomplete.  
**Release candidate:** `4720980ed` (`codex/memory-audit-followups`).

This receipt records the evidence available for the local release candidate and
the private Dataverse-export Blob store question. It does not authorize or record
a push, deployment, production test, secret retrieval, data write, or cleanup.
Evidence from earlier audits remains historical where indicated; it is linked
rather than recast as a result of this assessment.

## Release candidate and local evidence

**[VERIFIED via candidate repository comparison supplied for this receipt]** The
candidate is based on local commit `4720980ed`. Compared with `origin/main` at
`23d09e48235c1e5a7aea61e5f76715933d3701a1`, it is 28 commits ahead: 23 commits
from local main containing documentation, comments, or bootstrap-warning work,
plus five candidate commits (three documentation and two runtime). No migration,
migration-manifest, package/lock, Next.js, Vercel, or CI configuration changes
are in the candidate.

**[VERIFIED via isolated release workspace]** The candidate was exported to a
temporary directory with copy-on-write dependencies. It contains no `.env.local`
or inherited credentials; only the tracked `.env.example` is present. A Node-level
network guard rejects non-loopback connections, and telemetry is disabled; this
is not a comprehensive network sandbox for native build tools. The repository's
normal dependency tree and environment were not changed by this isolated setup.

| Evidence | Result | Limit |
|---|---|---|
| Initial Turbopack production build | Passed with the pre-existing install | That install had Next.js 16.3.8, Blob SDK 2.8.0, and Playwright 1.63.0, while the lockfile specifies 16.4.2, 2.8.2, and 1.64.1. This is not locked-dependency evidence. |
| Clean locked install | `npm ci --offline --ignore-scripts` passed in the isolated workspace; locked versions were confirmed | This confirms installability from the available cache, not runtime or deployment behavior. |
| Locked-dependency production build | Passed: canonical Turbopack build on Node 24.19.0, Next.js 16.4.2 | Migration-manifest bytes remained identical to candidate HEAD; Node 22/Linux parity is not established. |
| Jest full run plus focused reruns | 1,431 distinct suites and 24,751 tests passed; 17 suites / 215 tests skipped | Initial full run had 38 failed suites: 30 from over-strict test interlock / mismatched auth origin, three from missing archive Git metadata, five from stale test contracts. All 38 passed together after fixture corrections and test repairs (631 tests). This is consolidated evidence, not a claim that the initial full invocation was green. |
| Mode A browser rehearsal | 36 tests passed with locked Playwright 1.64.1 and matching temporary Chromium | Node 24.19.0/macOS, route mocks, isolated credential-free app; sandbox Chromium launch was blocked, host rerun passed on port 3101. |
| Existing local test/type/gate checkpoint | Historical checkpoint reported as passing: 1,269 tests plus type and gate checks | This predates the clean locked install and is not the candidate's final verification. |
| Node version comparison | Host has Node 26 and a bundled Node 24; Node 22 is unavailable | CI and Production pin Node 22. No Node 22 parity is claimed. |

The candidate includes runtime repairs and is therefore held to the campaign
release controls in the [release strategy](../CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md).
Parent review and independent Sol review found no unresolved issue in the local
preparation changes. Five stale tests were repaired without runtime changes: guarded
identity upsert, enriched-person options, identity select fields, partial materials
availability, and required request binding. The private probe passed 11 mocked tests.
Sequential documentation/safety gates and available self-tests passed. A targeted human rehearsal and owner release
decision remain separate gates; neither is implied by passing automation.

## Private Blob store investigation

**[VERIFIED via prior bounded account-metadata inspection, retained in the linked
evidence]** The account metadata exposed an unlinked export-store name candidate
with fingerprint `ffb75e44e30e` and cached count 2. A different store with
fingerprint `6060259031fd` is linked to the current project and matches the
locally configured public token, with cached count 347. These are metadata facts;
the name-only candidate does not establish the runtime DVX store or credential
binding.

**[VERIFIED via prior read-only prefix inventory]** The local public-token
inventory covered `reviewer-finder/`: 335 objects, 230,987,633 bytes, oldest
110 days, with 224 objects in the 90–179 day bucket. One SDK list invocation
was used. No content was fetched. The private store was not listed because the
local DVX credential was unavailable. There was no additional private listing
in this assessment; the earlier owner-authorized budget was at most 10 logical
list operations, of which the public inventory used one.

**[VERIFIED via inspected SDK authentication path]** Tokenless SDK resolution
checks project OIDC and `BLOB_STORE_ID` before the public Blob token. That order
does not prove that a maintenance invocation resolves to the intended private
store. Without an authorized credential-bearing runtime context, the effective
store identity and private object population remain **UNKNOWN**.

The private-only probe and its safeguards are prepared but have not been run
against a live store. Their intended bounds are: at most five SDK pages, zero
retries, a fixed private prefix, separate candidate/public-store guards, and an
aggregate-only receipt. No credential was available locally, no production
environment values were pulled or exported, and no private object was read,
listed, changed, or deleted. No retention decision follows from token expiry,
public inventory age, or cached whole-store counts.

The prior history remains in
[the historical impact and concurrency follow-up](historical-impact-concurrency-followup-2026-10-22.md),
including its earlier public inventory and private-credential limitation. The
machine-readable source records the public inventory and failed private listing
in [Blob retention evidence](blob-retention-metadata-evidence-2026-10-22.json)
and store metadata in [binding evidence](blob-store-binding-evidence-2026-10-22.json).
The credentials runbook has a corresponding tokenless-resolution clarification;
that documentation does not establish the runtime binding.

## Deployment metadata and rollback reference

**[VERIFIED via Vercel project/deployment metadata inspection]** The project
metadata identifies project `prj_56SJKzNer1aV38kKVoP8tl3X0lf3` in scope
`justin-gallivans-projects`. Its latest Production deployment reported READY is
`dpl_5S7ja8vpsdqNW2L6bk9AhXNrN8e6`, attached to commit
`23d09e48235c1e5a7aea61e5f76715933d3701a1`. The deployment metadata lists these
aliases: `reviews.wmkeck.org`, `grantees.wmkeck.org`,
`submissions.wmkeck.org`, and `applications.wmkeck.org`.

This deployment is a **rollback reference only**, not a verified functional
known-good: no hosted request, sign-in, application smoke, or Dataverse smoke
was performed. No alias change, rollback, or other deployment action was made.
If a later authorized promotion needs rollback, first verify the target
deployment and alias behavior, then restore the recorded deployment through the
approved Vercel procedure and reconcile any durable side effects. Code rollback
does not reverse data or email effects.

## Bounded action and evidence matrix

| Action | Status | Next evidence or boundary |
|---|---|---|
| Candidate source review | Local preparation reviewed | Parent and Sol checked the documentation, safe probe, and five test repairs; hosted behavior remains unverified. |
| Clean locked install | Complete | Completed offline in the isolated workspace. |
| Locked production build | Complete | Passed on Node 24.19.0; configured Node 22 parity remains separate. |
| Full Jest suite | Reconciled | 1,431 suites / 24,751 tests passed across full run and focused reruns; 17 suites / 215 tests skipped. |
| Mode A browser rehearsal | Complete | 36 route-mocked tests passed; no hosted/live-data proof. |
| Node 22 parity | Unavailable here | Use the configured CI/runtime evidence when accessible; do not label Node 24/26 results as Node 22. |
| Private-store binding | Unknown | Requires a separately authorized credential-bearing context; metadata alone is insufficient. |
| Private object inventory | Not run | Keep within the existing bounded authorization and prepared fixed-prefix safeguards. |
| Targeted human rehearsal | Pending | Name the target, controlled identities, expected writes, and cleanup owner before any live rehearsal. |
| Release owner decision | Pending | Decide only after candidate checks, target evidence, and required human rehearsal are concrete. |
| Push, deployment, live mutation, cleanup | Not authorized/performed | No such action is part of this receipt. |

## Exit conditions

Local preparation is complete. This is not a release approval: Node 22/Linux
verification, targeted human rehearsal on a named authorized target, and the
applicable owner release decision remain outstanding. The private-store question remains a separate evidence
item: do not mark its identity or contents verified until an authorized probe
measures the intended private target. Any resulting live object or retention
action requires its own explicit scope and receipt.
