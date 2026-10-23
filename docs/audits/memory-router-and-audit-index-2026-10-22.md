# Memory Router Diet and Audit Index — 2026-10-22

**Status: AUDIT INCOMPLETE — router and active whole-read inventory reviewed; all-claim verification remains incomplete.**
This index covers the router changes and subsequent active-memory audits. All
272 active and 32 non-active leaves now have a recorded whole read; source verification remains selective.
It does not certify every memory claim or current live state.

## Router change

The router dropped from 8,124 to 7,029 bytes, 72 to 66 lines, and 63 to 44 unique
direct leaf references. All 19 removed direct references remain reachable from
`docs/agent-wiki/topics/dev-environment.md` under Durable Memory: 11 audit/review/test
evidence notes, three CI/toolchain/deploy environment notes, three delegated Codex
review notes, and two Git handoff/merge notes. The owner-review-burden rule and the
direct routes for destructive carryover, production data access, production smoke
residue, and shared-worktree stash safety remain in the router. The wiki is an
existing domain hub for these development and review practices.

The 7,029-byte landing point is below the 8,192-byte early-warning trigger and retains
direct leaf recall at 44 references. The aspirational ~6 KiB size was not forced by
shortening route meaning or sending domain-specific work to an unrelated hub.

## Bounded verification and status

| Check | Result | Scope |
|---|---|---|
| Router leaf references resolve | 44/44 present | Local documentation files |
| Moved references resolve in the Dev Environment Durable Memory groups | 19/19 present | The moved review, test, delegation, toolchain, and Git routes |
| Memory leaf census | 304 leaves; 272 marked active | Read-only local census; not a claim that all 304 leaf claims were audited |
| Health flags | 16, final parent-run check | Eight shadow-atlas, six weak-basis, two oversize-routed; dispositions and historical/current-state limits are recorded in the remainder audit |
| Drift report | Stale, Aug 24; read-only | Not refreshed by this bounded task |
| Parent review | Complete for bounded repairs | Reviewed router/history extraction and 44 repaired active memories plus linked guidance; selective source proof and remaining gaps are recorded in the linked reports |

The Luna editing agent ran no tests, gates, external probes, environment reads, or commits. The parent ran the checks and created the local commits recorded below. No health flags were removed or silenced. The runbook
records the observed router and census metrics; its health count is identified as
parent-reported rather than independently recalculated here.

## Related repair reports

These dated reports cover separate documentation scopes. Each report's own status
and verification limits apply:

- [Historical Impact and Concurrency Follow-up](historical-impact-concurrency-followup-2026-10-22.md) — bounded historical/configuration/retention evidence, non-active memory repairs and three accepted behavior decisions implemented and verified locally; unreleased.
- [Non-active Memory Coverage](nonactive-memory-review-coverage-2026-10-22.csv) — 32 whole-read leaves, preserving 25 closed, three stale and four superseded statuses.
- [Autonomous Cleanup Follow-ups](autonomous-memory-cleanup-2026-10-22.md) — current local repair/evidence status and remaining release limits.
- [Reviewer Communications Guidance Repair](reviewer-communications-guidance-repair-2026-10-22.md) — local commit `85dbe6cd0`.
- [Roadmap Reader Guidance Repair](roadmap-reader-guidance-repair-2026-10-22.md) — local commit `9500fdb8b`.
- [Strategy Wiki Compression](strategy-wiki-compression-2026-10-22.md) — byte-preserving historical extraction.
- [Prompt and Memory Authority Repair](prompt-memory-authority-repair-2026-10-22.md)
- [Scheduled Email and Reader Guidance Repair](scheduled-email-and-reader-guidance-repair-2026-10-22.md)
- [Upload Cleanup Authority Repair](upload-cleanup-authority-repair-2026-10-22.md)
- [Dynamics, Temporal, and Product-Direction Memory Repairs](dynamics-identity-temporal-memory-repair-2026-10-22.md) — five Sol findings repaired by Luna and parent-reviewed.
- [Active Memory Safety and Write Audit](active-memory-safety-write-audit-2026-10-22.md) — 59 additional active leaves whole-read, 25 memory leaves repaired, source evidence and review limits recorded.
- [Remaining Active Memory Audit](active-memory-remainder-audit-2026-10-22.md) — the final 176 active leaves whole-read, 19 further memories repaired, and prioritized evidence gaps.
- [PI Identity and Request-Mutation Authorization](pi-identity-request-mutation-audit-2026-10-22.md) — confirmed PI role-source conflict, bounded mutation authorization trace, documentary repairs and unresolved runtime follow-ups.
- [Identity, COI, Referral and Provenance](identity-coi-referral-provenance-audit-2026-10-22.md) — retention/promotion and receipt corrections, preserved manual/COI decisions, referral/acknowledgement evidence and the shared-person write-ordering gap.
- [Awardee Read-Only Exceptions](awardee-read-only-exceptions-audit-2026-10-22.md) — action-specific Preview/Copy/Export contracts, scope corrections and browser/export follow-ups; no blanket exemption for other actions.
- [Remaining Read-Only Exceptions](remaining-read-only-exceptions-audit-2026-10-22.md) — reviewer GET effects, public proposal cache and IRS lookup/refresh boundaries; matrix/roster/export follow-ups remain open.
- [Matrix, Roster Contract and Exports](matrix-roster-export-audit-2026-10-22.md) — current roster dispatch/mutations, IRS matrix corrections and three export families; remaining export/live-state limits retained.
- [Active Memory Coverage Inventory](active-memory-review-coverage-2026-10-22.csv) — all 272 active leaves, sample membership, bounded disposition and evidence report. No active leaf remains outside the named whole-read samples.

## Current follow-up status and holds

The [autonomous cleanup ledger](autonomous-memory-cleanup-2026-10-22.md) now owns
execution status for the four authorized follow-up areas: deeper source checks,
large-hub compression, runtime repairs and read-only external evidence. The
reports above retain their original checkpoint findings and test receipts as
history. Do not use their original pending lists as the current work queue.

The lifecycle hub now routes nine capability extracts; the exact original and
segment proof are retained in the [extraction audit](reviewer-lifecycle-extraction-2026-10-22.md).
Scoped external observations are retained in the live-evidence JSON linked by
the ledger; local source changes are not deployed behavior. Whole-read coverage
still does not certify every claim. The 32 non-active leaves remain outside the
active-memory census but now have their own whole-read inventory and scoped repairs. Unprobed populations/effective permissions remain
unknown. Existing intake, BILL, reminder, paid-run and owner-review-burden
holds remain in force. No gate-coverage numeral or checker policy was changed.

## Historical parent verification for the router batch

Router routes and the moved development-memory references were reviewed. The historical archive matches the committed pre-edit body exactly (13,302 bytes; SHA-256 recorded in its report), and the subsequent implementation-history body is unchanged. Earlier repair batches passed the applicable documentation gates and self-tests; the final router/extraction and five-memory repair checks passed: memory-router and self-test, agent-wiki and self-test, harness-framing and self-test, fact-consistency, canonical-pointers, doc-symbol-refs, doc-currency, and agent-invariants. Earlier checkpoints recorded ten and then eleven advisory flags; the final remainder audit records sixteen, with the named retained-history and unknown-freshness dispositions explained there. No checker or flag suppression changed. The earlier three JavaScript corrections and the continuation’s two source-file corrections were independently compared against pre-batch non-comment parser tokens; all are comments-only. The owner-review-burden memory is unchanged. All commits remain local; no push or live-system action is part of this pass.
