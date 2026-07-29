---
name: Prove an invariant with a scanner, not by enumerating call sites
description: Claiming "every caller does X" from a grep-and-list failed three times in one session; a repo-walking test found seven sites no review did.
type: feedback
originSessionId: 2fbb7696-5871-460f-b363-e2304fd15c35
status: active
scope: code
last_verified: 2026-07-29 via tests/unit/email-source-pairing-invariant.test.js finding 7 unlisted call sites
---

## Recall Rule

Read this when about to write or accept a sentence of the form "every caller / every writer /
every path does X" — in a commit message, a durable doc, or a review response.

## The Lesson

**S387.** The invariant was "a reviewer address is never written without its provenance". I
asserted it complete three times, each time by grepping and listing the call sites, and each
time an adversarial review found one I had missed (`save-candidates`' person upsert, then a
historical backfill script). The pattern was not bad luck: adapter support is not the
invariant, because the field is dropped when a *caller* omits it, so completeness is a
property of a set no behavioral test can observe — the defect is an OMISSION at a site nobody
wrote a test for.

Replacing the list with a mechanical check (`tests/unit/email-source-pairing-invariant.test.js`
walks `lib/`, `pages/`, `scripts/`, `shared/`, parses each file, and fails on an address
written without a source) found **seven** more sites immediately, including a live service
path, that three adversarial passes and a Codex fix pass had all read past.

**Why:** enumeration proves what you looked at. A scanner proves what exists. For an
"every X" claim those are different claims, and only the second one is the one being made.

**How to apply:**
- If a claim is "every caller", the artifact backing it should be executable, not prose.
- Give the scanner a POSITIVE CONTROL (a literal of the real defect shape) so an empty or
  broken scan cannot pass silently, and assert the scanned file list is non-empty.
- Parse, don't regex, when the pattern involves code structure — a brace inside a string,
  comment, or regex defeats hand-rolled matching. `@babel/parser` is a declared dependency
  here; `@babel/traverse` is NOT (transitive only), so walk the AST yourself.
- Keep an EXEMPTION set with a stated reason per entry, so skipping a site is an argument in
  code rather than a silent omission.
- Prefer enforcing at the choke point (the adapter) AND scanning the callers; the choke point
  alone cannot stop a caller from passing nothing.

Related: [[feedback-symbol-consumer-fanout]], [[feedback-scrutinize-exemptions-and-fallthrough]],
[[feedback-vacuous-clean-results-print-the-denominator]].
