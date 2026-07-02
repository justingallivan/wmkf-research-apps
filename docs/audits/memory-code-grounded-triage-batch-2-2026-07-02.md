# Memory Code-Grounded Triage Batch 2 - 2026-07-02

Status: complete for reviewer identity memory cluster.

## Scope

Read and classified:

- `.claude-memory/reviewer-identity-fragmentation.md`
- `.claude-memory/project-reviewer-identity-resolution.md`
- `.claude-memory/project-reviewer-identity-resolution-phase1.md`
- `docs/agent-wiki/topics/reviewer-identity.md`

## Code-Grounded Checks

- [VERIFIED] The shared resolver exists and gates persistence through `mayPersistIdentity`: `lib/services/reviewer-identity-resolver.js`.
- [VERIFIED] `save-candidates` gates ORCID/Scholar/metric writes, writes resolver decisions, and clears resolver-sourced fields on downgrade: `pages/api/reviewer-finder/save-candidates.js`.
- [VERIFIED] `workbench/enrich-recommended` applies the same gate and back-propagates eligible ORCID values to linked contacts: `pages/api/workbench/enrich-recommended.js`.
- [VERIFIED] `researcher.writeIdentityDecision` and `researcher.clearIdentityFields` preserve confirmed human attestations and fail closed before downgrades/clears: `lib/dataverse/adapters/researcher.js`.
- [VERIFIED] ORCID back-propagation is a shared helper, gated on valid ORCID plus confirmed/probable identity status: `lib/services/backprop-reviewer-orcid.js`.
- [VERIFIED] Contact ORCID writes are fill-only/conflict-aware and duplicate-email resolution is ambiguity-aware: `lib/dataverse/adapters/contact.js`.
- [VERIFIED] Unit tests cover the persist gate and ORCID backprop conflict/skip behavior: `tests/unit/reviewer-identity-resolver.test.js`, `tests/unit/backprop-reviewer-orcid.test.js`, `tests/unit/reviewer-route-identity-gate.test.js`.

## Classification

| Memory | Classification | Action |
|---|---|---|
| `project-reviewer-identity-resolution.md` | `CLOSE_HISTORICAL` | Demoted from active to closed. It is now original false-match rationale; current behavior is in source, enforcement docs, and phase1 memory. |
| `project-reviewer-identity-resolution-phase1.md` | `KEEP_ACTIVE` | Still earns active status for resolver/write-gate/Scholar audit invariants. Refreshed `last_verified` and removed the stale pre-shipping tail. |
| `reviewer-identity-fragmentation.md` | `KEEP_ACTIVE` | Still earns active status for the sample-based cross-store fragmentation finding, no-banking-PII warning, and ORCID-as-flow posture. Refreshed source-backed routing and dropped-table wording. |

## Reconciliation

- Removed `project-reviewer-identity-resolution` from active identity routing in the reviewer identity wiki and memory reorganization plan; left it explicitly historical.
- Marked the reviewer-identity-fragmentation candidate as triaged in the pending plan/control audit.
- No memory files were deleted.

## Residual Risk

This batch did not re-run live Dataverse probes for the historical ORCID counts. The edits avoid refreshing those counts and only assert current code/source contracts.
