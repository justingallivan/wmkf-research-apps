---
name: feedback-mutation-test-with-the-discriminating-fixture
description: A mutation check only proves a test has teeth if the fixture is one where the bug actually bites; a fixture that coincidentally satisfies the buggy predicate passes either way and proves nothing.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: 2026-08-10 (S412) — caught twice in one session on the grantee replace-submission service
---

## Recall Rule

Read this when: writing or reviewing a test that pins a guard, a rollback branch,
or any predicate you deliberately made *narrower* than a sibling's — and whenever
you are about to say "mutation-checked, so the test has teeth."

Do:
- Pick the fixture from the case where the two predicates **disagree**.
- Run the mutation and confirm it fails **that specific test**; name which one.
- If the mutation leaves the suite green, the test is decorative — fix the fixture,
  not the claim.

Do not:
- Trust a mutation check whose fixture satisfies both the correct and the buggy
  predicate.
- Report "verified by mutation" without saying which test failed.

**Why:** S412, grantee staff replace-submission service. The portal writer confirms
a commit with `imageRef === new && status === SUBMITTED`; the new staff path writes
no status, so it must confirm on the ref alone — copying the status term would
misread a committed write as a rollback and delete a referenced image. The test
pinning this used a `Submitted` fixture, where the buggy predicate *also* passes.
Reintroducing the bug left all 25 tests green. Switching the fixture to
`Staff Review` — the status where the predicates diverge — made the mutation fail
exactly that test. The same session's adversarial review then found a second
instance: every route-level guard (auth, GUID, DAL context, caption cap, busboy
limits) was untested because service and UI tests both bypassed the handler.

The general shape: when you narrow a predicate relative to a sibling, the
discriminating input is the one the sibling's extra term would reject. That input
is the only fixture that tests the difference.

**How to apply:**
- After writing a guard test, ask "what input makes the correct and incorrect
  versions disagree?" and assert on that one.
- Mutate, observe the named failure, restore. Cheap: three commands.
- A crude mutation may fail extra tests as an artifact of how it was applied — say
  so rather than claiming a tighter result than you measured.
- Related: [[feedback-vacuous-clean-results-print-the-denominator]],
  [[feedback-dont-self-certify-convergence]],
  [[feedback-author-adversarial-pass-first]].
