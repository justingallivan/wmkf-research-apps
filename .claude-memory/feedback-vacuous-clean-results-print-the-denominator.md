---
name: A clean result is only evidence if you know the denominator
description: A sweep that reads one silent page reports "0 found" identically to a genuinely clean population — print rows scanned beside rows matched, and refuse on a zero-row read.
type: feedback
originSessionId: 2fbb7696-5871-460f-b363-e2304fd15c35
status: active
scope: code
last_verified: 2026-07-29 via live probe (queryReviewers returned records=25, hasMore=true against a 385-row filtered population)
---

## Recall Rule

Read this when writing or reviewing anything that sweeps a population and reports a
count: a maintenance script, a backfill, an audit, a "no violations found" scanner, or a
probe whose conclusion is "nothing to do".

## The Lesson

**S387.** A production backfill's first successful dry run printed `0 person rows pinned
below available evidence` — a tidy no-op. It was false. `potentialReviewerAdapter.queryReviewers`
wraps `DynamicsService.queryRecords`, which returns **one 25-row page plus `hasMore`**; the
script ignored `hasMore` and scanned 25 of 385 rows. Had that result been believed, the
answer to the owner would have been "the backfill is unnecessary and your reviewer cannot be
fixed" — the opposite of the truth (6 reviewers were pinned, including the one asked about).

**Why nothing caught it.** Three adversarial review passes and a Codex write-access fix pass
all read this script and called it sound. Static review cannot see a read that silently
truncates; only running it can. And the output was structurally unfalsifiable: `0 found` with
no denominator reads identically whether the query returned 25 rows or 385.

**Why:** an empty result and a broken read are the same string. Absence of findings is only
evidence when the size of the searched set is stated next to it.

**How to apply:**
- Print the DENOMINATOR beside the numerator: `rows scanned: N` next to `rows matched: M`.
  A reviewer (or you, tomorrow) can then sanity-check N against a known population size.
- REFUSE on a zero-row read rather than reporting a clean pass — a broken read is not an
  empty population.
- Prefer the auto-paginating call when the answer depends on completeness. In this repo:
  `DynamicsService.queryAllRecords` / `potential-reviewer.queryAllReviewers`, never the
  page-at-a-time `queryRecords` / `queryReviewers`. See
  [[../docs/agent-wiki/topics/dataverse-dynamics.md]] Operating Notes.
- The same shape applies to a Postgres sweep with an implicit `LIMIT`, a `$select` page, a
  glob that silently matched nothing, and a scanner whose file list came back empty — assert
  the input set is non-empty before trusting the verdict.

Related: [[feedback-falsify-not-confirm]], [[feedback-dont-self-certify-convergence]],
[[feedback-completeness-by-scanner-not-enumeration]].
