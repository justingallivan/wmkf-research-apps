---
title: Claude → Codex Handoff (Session 2026-07-27, reviewer email work)
domain: process
kind: status
status: active
summary: Reviewer-email session outcomes, unrun follow-ups, and Claude's self-assessment with three unimplemented remediation proposals for Codex to evaluate.
canonical: false
cataloged: 2026-07-27
owner: product-engineering
related:
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/TODO_EMAIL_NOTIFICATIONS.md
  - docs/CI_GATES_REFERENCE.md
---

# Claude → Codex Handoff (2026-07-27)

Branch `codex/claude-bug-fixes`, 10 commits, all pushed. Worktree
`/Users/gallivan/Code/WMKF_Apps-claude-bugs`. Nothing merged to `main`.

The owner asked for this handoff and explicitly instructed that the behavioral
remediations in Part 4 **not** be implemented by Claude. They are proposals for
Codex to evaluate, not a worklist Claude started.

---

## Part 1 — What shipped

Started as a config question ("the reviewer-quota alert emails PDs from a named
individual") and grew into three areas.

### Alert sender

| Commit | Change |
|---|---|
| `677a0b32` | Split `SCHOLARLY_POLITE_MAILTO` out of `NOTIFICATION_EMAIL_FROM`, which was doing double duty as the Dynamics sender AND the NCBI/Europe PMC contact address [VERIFIED via `lib/services/pubmed-service.js`, `lib/services/contact-enrichment/scholarly-email.js`]. Falls back to the old var when unset, so unset environments are unchanged. |
| `b4ef3a25` | Recorded `alerts@wmkeck.org` as the selected sender. |
| `b413d5c6` | Read-only Dataverse probe confirmed it resolves: systemuser `d57ddb27-c8db-ee11-904d-000d3a310f67`, `isdisabled=false`, `accessmode=0`, `fullname` `# Alerts` (owner accepted that display name) [VERIFIED via read-only probe of `wmkf.crm.dynamics.com`, 2026-07-27]. |
| `ec5c8a2c` | Reconciled to applied after the owner set both vars in Vercel [VERIFIED via owner report; Vercel values are not readable from a session]. |

### Reviewer email copy and greeting

| Commit | Change |
|---|---|
| `a497d158` | `{{greeting}}` now renders `Dear Dr. <Last>` on every reviewer email, not just invitations; `buildReviewerGreeting` is the single definition and the invitation path delegates to it [VERIFIED via `lib/utils/email-generator.js`]. Release copy: "your willingness to review" → "Thank you for considering our request to review", "a full panel" → "a full slate of reviewers". Also fixed a surname defect where `"Jane Roe, Ph.D."` yielded `"Roe,"`. |
| `66a5fb28` | Removed template closing lines that would have doubled the PD signature. **Superseded** — see `e3a471e7`; the premise was wrong. |
| `82f4edf2` | `scripts/migrate-reviewer-email-copy.mjs` — pushes seed copy onto the live `wmkf_appsystemsettings` rows. Dry-run default, `--execute` writes. |
| `0f7d1348` | Documented the interlock requirements for that script: `DATAVERSE_ALLOW_PROD_READS` for reads, a same-UTC-day `DATAVERSE_PROD_WRITE_ACK` for writes [VERIFIED via `lib/dataverse/core/interlock.js`]. |

**Load-bearing fact for anyone touching this area:** the constants in
`lib/seed/email-defaults/` are init data, **not a runtime fallback**.
`readRequiredEmailDefaults` reads the live Dataverse row and skips the send with
an ops alert when it is blank [VERIFIED via `lib/services/email-defaults.js`;
disconfirming grep found no production importer of the seed constants outside
tests]. A code-only copy change reaches nobody.

### Review-before-send for the reviewer release

| Commit | Change |
|---|---|
| `c91244ee` | New read-only route `POST /api/review-manager/render-withdraw-emails` → `renderWithdrawPreviews()`; `withdraw-sufficient` accepts per-suggestion `overrides`; new `ReleaseEmailModal`. Staff can now edit each "no longer needed" note before it sends. |
| `e3a471e7` | Fixes for all seven Codex adversarial-review findings (Part 3). |

Staff context: the release email only ever reaches reviewers who never responded
[VERIFIED via `isStillPending`, `lib/services/review-manager/withdraw-sufficient-service.js`],
so it is not "automatic" in the sense a PD asked about — it is staff-selected and
confirmed. Sending **is** the release (the lifecycle write precedes the email
deliberately), so a true "save to drafts" is not available without splitting that
operation; the owner accepted edit-before-send instead.

---

## Part 2 — State and what is NOT done

**Verified at `e3a471e7`** [VERIFIED via commands run in this session]: 525
suites / 6259 tests; 15 gates plus 14 paired self-tests; Playwright 6/6 in a real
browser; ESLint clean.

Outstanding, all owner-gated:

1. **Nothing is merged to `main`.** The `{{greeting}}` token only renders once
   the renderer code ships.
2. **Ordering constraint:** run `scripts/migrate-reviewer-email-copy.mjs
   --execute` **after** the merge deploys. Running it first puts a literal
   `{{greeting}},` in reviewer emails.
3. `before.txt` in the worktree is a **stale** dry-run capture — the seed copy
   changed after it was taken. Re-run the dry run before executing. Untracked
   and not gitignored; do not commit it.
4. **[UNVERIFIED]** Outgoing Server-Side Sync on the `alerts@wmkeck.org`
   mailbox. The sender resolves, but if SSS is not enabled the send fails *after*
   resolution and `notify()` swallows it [VERIFIED via
   `lib/services/notification-service.js:85-88`] — alert email would stop
   silently while dashboard alerts keep working.
5. Session docs (`SESSION_PROMPT.md`) were **not** written. `/stop` was started
   and paused: HEAD is a feature branch and a concurrent Codex session owns
   `codex/local-retention-inventory`, so where they land is an open owner
   decision.

---

## Part 3 — Review history

A Codex adversarial review (`--base origin/main`) returned **no-ship** with seven
findings, all fixed in `e3a471e7`:

1. [high] `ReleaseEmailModal` treated every `withdrawn_*` status as success, so a
   reviewer who was released but never emailed was reported as sent.
2. [high] The reviewed draft was not bound to what actually sent — the modal sent
   only changed fields, and neither recipient nor rendered copy was pinned.
3. [medium] Request membership failed open when `_wmkf_request_value` was absent
   (pre-existing at `origin/main:101`, propagated into the new preview).
4. [medium] `Mrs.` resolved to `Mr.` (`startsWith('mr')` preceded the `mrs`
   branch) — live on the invitation path, not only the new surfaces.
5. [medium] Removing template closings assumed every PD signature carries a
   valediction; the resolver guarantees only a name.
6. [medium] A migration read error permitted a partial write with exit 0.
7. [medium] The existing Playwright release spec was stale and would fail on
   every push to `main`.

**One correction to Codex's report:** it stated Playwright was unverifiable. It
was not — Chromium simply would not launch in its sandbox. Run in Claude's
environment, Codex's own rewritten E2E test **failed** on a strict-mode locator
violation (`getByText('Dr. Failed Reviewer')` also matched the draft textarea).
Fixed with an exact match; 6/6 now pass. Treat "could not verify" from either
agent as an open gap, not a caveat to pass along.

---

## Part 4 — Claude's self-assessment (proposals only, NOT implemented)

Six of the seven findings were defects Claude introduced or propagated and did
not catch, having reported the work as verified. This section is self-reported
and worth independent scrutiny.

### The pattern

Four findings are a single defect class: **a producer enumerates N states; a
consumer handles a subset via a heuristic.**

| Site | Heuristic | Falls through |
|---|---|---|
| `ReleaseEmailModal` | `startsWith('withdrawn')` over a 9-state set | 4 failure statuses |
| `withdraw-sufficient-service` | `if (x && mismatch)` | the null case |
| `migrate-reviewer-email-copy` | `if (failed > 0)` | the `error` status |
| `email-generator` | `startsWith('mr')` | `mrs` |

The other two are the same shape in a different medium: the honorific tests
sampled Professor and Ms. (the cases that pass), and the signature contract was
generalized from one PD's saved block.

Claude verified the paths it built and treated that as verifying the change. The
test suite only ever asked the questions Claude had thought to ask, which is why
"523/523, gates green" read as conclusive when it was not.

Aggravating factor: `/contract-reconcile` was run, and its complement-and-
fall-through step exists for exactly this. It was applied to the code written,
not to what falls through it. **`.claude/rules` already states that denylist
guards fail open; Claude read it and then shipped three.** More prose guidance is
therefore the least promising remedy.

### Proposal 1 — extend `check:status-enum-parity` to catch heuristic consumers

Today it compares producer status sets against consumer label/bucket **maps**
[VERIFIED via the gate's own output line: "producer↔consumer key parity
(status/enum/workRemaining vs label/bucket maps)"]. It stayed green here because
the consumers were prefix and truthiness tests, not maps. Proposal: where a
status set is defined, flag consumers applying `startsWith`/`includes`/truthiness
to that value instead of an exhaustive map or explicit allowlist.

Would have caught findings 1, 3, 6 — including the high-severity one — as a red
gate, independent of author confidence.

**[ASSUMED] Open questions for Codex:** whether the gate's producer-set
derivation is actually extensible to non-map consumers, and what the
false-positive rate is against the current tree. Claude did **not** read
`scripts/check-status-enum-parity.js`; do not treat extensibility as settled.

### Proposal 2 — make "verified" mean every suite touching the diff

Finding 7 was not a judgment failure — Claude never asked which existing tests
referenced the changed files. Proposal: a script taking `git diff --name-only`,
grepping `tests/` (**including `tests/e2e/`**) for those paths and their exported
symbols, and running what it finds. Smallest of the three and probably the
highest yield: the stale spec would have surfaced within a minute of being
broken rather than hours later from a reviewer.

### Proposal 3 — session scoping (owner-level, not automatable)

Three findings live in `ReleaseEmailModal` and the override plumbing — code that
did not exist when the session began and was outside its stated scope. A config
question became a new API route, a new component, and a live-write migration
script across nine commits, with review only at the end. Proposal: when work
crosses into new routes or new UI, it becomes its own session with review
**before** commits accumulate.

### What Claude explicitly does not propose

Additional prose rules in `CLAUDE.md` or `.claude/rules`, or an undertaking to
be more careful. Both are unfalsifiable and this session is evidence against
them.
