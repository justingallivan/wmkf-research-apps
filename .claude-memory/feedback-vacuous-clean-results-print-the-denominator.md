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

## Extension — estimate the denominator BEFORE proposing the probe (S413, 2026-08-10)

The rule above governs *reporting* a sweep. It applies one step earlier too: **to
proposing one.**

S413. To settle how many SharePoint versions a Word editing session produces, I offered
to sweep every governed artifact and report the version distribution. The owner stopped
it with one sentence: *"Our apps are new so we haven't created more than a handful."* The
population was app-created files sitting at version `1.0` because nothing had edited them.
The sweep would have returned "almost every file has one version" — measuring how new the
system was, not how Word behaves. Clean, confident, and worthless.

**Why:** a probe against a population that cannot exhibit the phenomenon returns a clean
result that reads exactly like a real finding. Printing the denominator would have exposed
it *after* spending the owner's time; asking what the population contains costs nothing
*before*.

**How to apply:**
- Before proposing any survey, state what the population is and **what a clean result
  would mean**. If "nothing found" is indistinguishable from "nothing could have been
  found", the probe is not worth running — say so instead of running it.
- Ask the owner about population size when they know the system's history better than the
  repo does. Newness, seed data, and test-only records are invisible to a row count.
- A probe with a tiny population can still be worth running when **a single positive is
  itself decisive** (S413: checking whether *any* governed artifact sits in a checked-out
  state — one hit is a finding at any N). Distinguish "needs a distribution" from "needs
  one instance"; only the former requires a real denominator.
- When a proposed probe dies this way, prefer the **controlled experiment** (construct the
  condition on a disposable artifact) or the **authoritative config read** over a survey of
  organic data.

Related: [[feedback-falsify-not-confirm]], [[feedback-dont-self-certify-convergence]],
[[feedback-completeness-by-scanner-not-enumeration]],
[[feedback-thoroughness-default]].
