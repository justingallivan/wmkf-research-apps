---
title: Workbench Read Coalescing Stage 2 — Production After-Baseline
domain: architecture
kind: audit
status: complete
summary: "Controlled GET-only Production evidence that Stage 2 person-read counts match the chunk-aware after formula across empty, small, active+removed, and decline-referral strata."
canonical: false
cataloged: 2026-08-15
last_verified: 2026-08-15
owner: product-engineering
related:
  - docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md
  - docs/audits/workbench-observability-stage1-production-baseline-2026-08-15.md
  - docs/audits/claude-workbench-read-coalescing-stage2-implementation-record-2026-08-15.md
---

# Workbench Read Coalescing Stage 2 — Production After-Baseline

## Scope and safety

- **Deployment:** `main` at promotion record `897ac285`, Production deployment
  `dpl_3BU1Zstkn1ZhEhabfvNE5MFNpdpq` (READY).
- **Browser activity:** signed-in staff navigation and GET/read page loads only. No PATCH, DELETE,
  dismiss, merge, send, selection, status change, or other Production mutation was performed.
- **Controlled windows:** 2026-08-16 03:30:18.453Z–03:31:22.368Z for empty, small, and
  active+removed strata; 03:36:34.097Z–03:36:40.511Z for the decline-referral stratum.
- **Privacy:** the report retains no request number, Dataverse GUID, reviewer/applicant identity,
  email, filename, response body, URL query, or raw log line.

The Stage 1 report deliberately omitted business identifiers. The current browser history did not
retain the earlier fixture URLs, so exact request identity could not be proven. This pass therefore
repeated the same **structural strata**, not a provably identical request set. That is sufficient for
the source-defined chunk-count contract because every observed person set remained within one
25-id chunk, but it is not evidence for a request-identity-matched latency comparison.

## Extraction evidence

The first unfiltered one-minute export reached the explicit 5,000-record limit and was rejected and
deleted. The same windows were re-exported as five short, adjacent unfiltered slices containing
33, 1, 32, 32, and 30 request records; every slice was below the limit. The plan's strict `.logs[]`
v1 validator accepted 181 telemetry occurrences. `eventId`-only merge produced 180 unique events
(one duplicated occurrence), all from `dpl_3BU1Zstkn1ZhEhabfvNE5MFNpdpq`. No malformed or
contract-invalid discriminator-bearing event was encountered.

Among the 180 unique events, 44 belonged to the three target routes. All 44 reported `success`;
zero reported `http_error`, `timeout`, or `network_error`. Nine were Dataverse
`wmkf_potentialreviewerses` reads.

## Controlled results

`q(n) = ceil(n / 25)`, with empty sets contributing zero. Durations are controlled/descriptive
only. For a two-call cell, p50/p95 uses nearest rank.

| Structural stratum | Reviewers reads (p50/p95 ms) | My-candidates reads (p50/p95 ms) | Decline reads (p50/p95 ms) | Contract result |
|---|---:|---:|---:|---|
| Empty person-id sets | 0 (—/—) | 0 (—/—) | 0 (—/—) | `0 + 0 + 0` — PASS |
| Small/typical saved set | 1 (107/107) | 1 (94/94) | 0 (—/—) | `q(reviewers)=1`, `q(active)=1` — PASS |
| Active + removed, no decline referral | 1 (93/93) | 2 (118/153) | 0 (—/—) | separate active + removed reads — PASS |
| Active + removed + decline referral | 1 (108/108) | 2 (97/107) | 1 (98/98) | `1 + 1 + 1 + 1 = 4` — PASS |

The full combined stratum is the load-bearing acceptance case: the before-baseline observed
`2 / 4 / 1` person reads for reviewers / my-candidates / decline-referrals; Stage 2 observed
`1 / 2 / 1`. The small stratum changed `2 / 2 / 0 → 1 / 1 / 0`; the empty stratum remained
`0 / 0 / 0`. The unchanged decline count and the separate two-call active+removed count show that
Stage 2 removed only the duplicate sibling projections; it did not union independent id sets or
alter the decline path.

The >25-id stratum remains unavailable without manufacturing Production state and was not created.
No organic-user p50/p95 claim is made; the controlled durations above are not a natural workload
sample.

## Evidence matrix

| Claim | Producer/entry | Source of truth | Consumer | Strongest evidence | Status |
|---|---|---|---|---|---|
| Three available Workbench page loads returned usable structure | Signed-in Workbench navigation | Production UI responses | Staff browser | Heading + Find/Invite/Track present; no loading residue or visible failure | VERIFIED |
| Decline-referral stratum was genuinely populated | Track subtab load | Production decline-referrals response | Reviewer Manage panel | Visible “referral from reviewers who declined” banner after reload | VERIFIED |
| Target telemetry was valid and successful | Three correlated route handlers | Vercel Production `.logs[]` | Local strict validator/aggregator | 44/44 target events success; validator failed closed on no event | VERIFIED |
| Person-read counts match the Stage 2 formula | Instrumented Dataverse seams | `wmkf_potentialreviewerses` events | Stage 2 acceptance analysis | `0/0/0`, `1/1/0`, `1/2/0`, `1/2/1` by structural stratum | VERIFIED |
| Exact request identity matched the before-baseline | N/A | Prior report intentionally retained no identifiers | Latency comparison | Earlier fixture URLs unavailable | UNKNOWN |
| >25-id behavior occurred in Production | N/A | Production fixtures | Acceptance analysis | No safe fixture available | UNKNOWN |

## Mode A sweep report

- **Domain/change:** Stage 2 controlled Production after-baseline changed from pending to complete.
- **Claims:** 6 → VERIFIED 4 / UNKNOWN 2 / PARTIAL 0 / ASSUMED 0 / CONFLICT 0.
- **Structural correction:** plan, security watch item, Stage 1 baseline, Stage 2 implementation
  addendum, milestone log, and session handoff now point to this completed evidence.
- **Semantic omission found:** the prior non-identifying report made exact request-identity reuse
  unverifiable; this limitation is now explicit rather than silently calling the pass identical.
- **Remaining live stale claims:** 0 after the post-edit searches and documentation gates.
- **Verdict:** RECONCILED for Stage 2's call-count acceptance. Organic latency and >25-id
  Production behavior remain unclaimed.
