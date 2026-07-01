# Email Template Token-Syntax Unification Plan

**Created:** 2026-07-01 (S311)
**Status:** DRAFT — pending Codex review + owner approval. No code written yet.
**Goal:** One token syntax — mustache `{{token}}` — across ALL admin-editable email
templates (reviewer + grantee), replacing the legacy `[bracket]` syntax used by the
transactional/automated emails.
**Decisions locked by owner (S311):** (1) standardize on `{{}}`; (2) scope = all email
templates, not just reviewer; (3) draft plan → Codex review → implement after approval.

## 1. Why (the historical split)

There are two independent token-substitution engines, split by send pipeline:

| System | Syntax | Templates | Resolver |
|---|---|---|---|
| A (newer, central) | `{{token}}` | reviewer `invitation`, `materials`, `followup`, `thankyou` | `replacePlaceholders` (`lib/utils/email-generator.js:156`) via `render-emails.js` → `send-emails.js` |
| B (older, transactional) | `[token]` | reviewer `acceptance`, `withdraw`, `reminder_respond_by`, `reminder_review_due`; grantee `invite`, `reminder` | ad-hoc per-file token maps (`applyPlaceholders`) with string-literal keys |

System B resolvers live in [VERIFIED via source this session]:
`lib/external/reviewer-reminder-email.js` (both reminders),
`lib/external/reviewer-withdraw-email.js` (withdraw),
`lib/external/grantee-invite-email.js` (BOTH grantee invite AND grantee reminder —
`renderGranteeReminderHtml`, imported at `grantee-deliverable-reminders.js:13`), and
`pages/api/external/review/[token]/respond.js` (acceptance). Note `applyPlaceholders`
is **not shared** — it is duplicated as a private function in each of the three
`lib/external/*.js` files (`reviewer-reminder-email.js:31`,
`reviewer-withdraw-email.js:16`, `grantee-invite-email.js:68`). All System-B
templates are admin-editable in `/admin` → Email Defaults, stored in Dataverse
`wmkf_appsystemsetting`, seeded from `lib/seed/email-defaults/{reviewer-actions,
reviewer-reminders,grantee-invite,grantee-reminder}.js`.

System B also has **intra-bracket** inconsistency this cleanup fixes: `[reviewerName]`
(acceptance) vs `[Reviewer Name]` (withdraw/reminders); `[reviewDueDate]` (acceptance)
vs `[review due date]` (review-due reminder).

## 2. Preflight finding (VERIFIED 2026-07-01 via live read-only probe)

Read every System-B stored value in Dataverse and diffed against its seed
(`scratchpad/preflight-token-syntax.mjs`):

- **All 6 subjects: MATCH seed.**
- **All 6 bodies: DIFFER from seed** by ~3–12 chars — and the diffs are **real,
  intentional admin copy edits**, not whitespace. Examples:
  - `email.reviewer_acceptance.body`: prod = "A calendar reminder for the review
    deadline is attached for your convenience." (seed = "…attached when a review due
    date is available."), and prod drops a redundant "Thank you," sign-off.
  - `email.grantee_invite.body`: prod drops the seed's trailing "Thank you," (the
    signature block closes the letter).
- Every stored body uses the **same bracket token set** as its seed (no unknown/custom
  tokens).

**Consequence — the load-bearing constraint:** a plain re-baseline from the seed files
would OVERWRITE live, intentional admin copy. The migration MUST **preserve each stored
value's copy verbatim and only swap the token syntax** (`[X]` → `{{X}}`) in place.

> Separately noted (OUT OF SCOPE): the seed files have drifted from prod copy. That is a
> pre-existing condition; this task does not reconcile copy, only token syntax. Flag for a
> future seed re-baseline decision.

## 3. Canonical token map (`[bracket]` → `{{mustache}}`)

Unify to the existing System-A token names where the meaning matches; keep distinct
where semantics differ.

| Legacy bracket token(s) | New mustache token | Notes |
|---|---|---|
| `[Program Director signature]` | `{{signature}}` | Same as System A's existing token. |
| `[reviewerName]`, `[Reviewer Name]` | `{{reviewerName}}` | Collapses the two casings. |
| `[title]` | `{{proposalTitle}}` | Same as System A. Award/proposal title. |
| `[reviewDueDate]`, `[review due date]` | `{{reviewDueDate}}` | Collapses the two spellings. Same as System A. |
| `[proposal]` | `{{proposalClause}}` | **Distinct from `{{proposalTitle}}`** — resolves to a full clause ("the proposal 'X'", with a fallback phrase when untitled). New name to avoid implying it's the bare title. |
| `[Name]` (grantee) | `{{granteeName}}` | Grantee's name. |
| `[date]` (grantee, "COB [date]") | `{{dueDate}}` | Deliverable due date. |

Open question for review: whether to fold `[proposal]` clause + `{{proposalTitle}}`
into one, or keep the clause helper. Recommendation: keep distinct (`{{proposalClause}}`)
— the clause carries fallback wording the bare title can't.

## 4. Transition safety — dual-syntax resolver window

Neither "flip resolver first" nor "migrate data first" is safe alone: each leaves a
window where a stored value's syntax doesn't match the deployed resolver → the literal
token text ships in a real email. So:

**Step A (deploy, no behavior change).** Make every System-B resolver map accept BOTH
the legacy bracket key AND the new mustache key for each token (dual entries in the
`applyPlaceholders` maps). Stored values are still `[X]`; they resolve exactly as today.
There is precedent for this exact pattern already in the code
(`reviewer-reminder-email.js` keeps a `'[proposal title clause]'` legacy dual-key).

**Step B (data migration).** Run `scripts/migrate-email-token-syntax.mjs` (new): for
each of the 12 System-B keys, read the stored value, mechanically replace bracket tokens
with mustache per §3 (order-independent, whole-token match), and write back. Dry-run
first (prints before/after token diff, asserts copy is otherwise byte-identical), then
`--execute`. The dual-syntax resolver (Step A) keeps resolving throughout.

**Step C (flip seeds + hints).** Rewrite the 4 System-B seed files and the
`editableTextDefaults.js` `placeholders` arrays (12 keys) to mustache, so fresh installs
and the admin panel hints are consistent. (Seeds are create-only init data; this does not
touch prod values — those were handled in Step B.)

**Step D (later, optional cleanup).** After a soak period, drop the legacy bracket half
of the dual-syntax maps. Tracked as a follow-up, not part of this change.

## 5. File-by-file change list

- `lib/external/reviewer-reminder-email.js` — dual-syntax map (Step A).
- `lib/external/reviewer-withdraw-email.js` — dual-syntax map.
- `lib/external/grantee-invite-email.js` — dual-syntax map; covers BOTH grantee
  invite and grantee reminder (`renderGranteeReminderHtml`), so one file, one map.
- `pages/api/external/review/[token]/respond.js` — dual-syntax map (acceptance).
- `lib/seed/email-defaults/reviewer-actions.js`, `reviewer-reminders.js`,
  `grantee-invite.js`, `grantee-reminder.js` — seed bodies/subjects → mustache (Step C).
- `shared/config/editableTextDefaults.js` — `placeholders` arrays for the 12 keys → mustache (Step C).
- `scripts/migrate-email-token-syntax.mjs` — NEW data-migration script (Step B).
- Docs/wiki: `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` email-templates
  section; any placeholder references in runbooks.

## 6. Tests

- Unit: each System-B render function resolves BOTH `[X]` and `{{X}}` inputs to the same
  output (proves dual-syntax + no regression), and leaves unknown tokens untouched.
- Unit/integration: the migration script's token-swap on a fixture body changes ONLY the
  tokens (copy byte-identical otherwise).
- Existing System-B email tests updated to mustache fixtures once Step C lands.
- Full `npm test` green before each commit.

## 7. Sequencing & rollback

Commit per step (A, B, C) so each is independently revertable. Step A is a pure superset
(no behavior change) → safe to deploy alone. Step B is data-only, reversible via the same
script run backward (or Dataverse audit / re-seed). Step C is code/init-data only. If any
step regresses, revert that commit; the dual-syntax resolver means a partial state (some
stored values migrated, some not) still resolves correctly.

## 8. Blast radius / risk

- Colleague-facing outbound email copy — a mis-migrated token ships a literal `{{x}}` or
  `[x]` in a real email. Mitigated by dual-syntax resolver + dry-run + copy-byte-identical
  assertion + unit tests asserting both syntaxes resolve.
- No schema change, no new route. Reads/writes only existing `wmkf_appsystemsetting` keys.
- Superuser-only settings write path unchanged.
