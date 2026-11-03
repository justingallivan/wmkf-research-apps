# Preview alias CSRF origin fix

Status: **BUILT ON BRANCH `claude/preview-alias-csrf`, NOT MERGED; Preview proof
pending.** Owner approved D1 (tracked constant) and D2 (Dynamics Explorer chat
empty-message POST) on 2026-11-03. Session 661, Claude, 2026-11-03. Queue entry: `docs/CURRENT_WORK_QUEUE.md` → "Preview CSRF origin
check rejects alias-hosted POSTs".

## Problem

Line references to `lib/utils/auth.js` in this plan are pre-change
positions (commit `d3016b5da`).

`validateOrigin` in `lib/utils/auth.js:61-119` guards every state-changing staff
API request (POST/PUT/PATCH/DELETE) through `requireAuth` (`:160`) and
`requireAppAccess` (`:318`). It compares the request's Origin (or Referer)
against **one** allowed origin:

- Production: `NEXTAUTH_URL`.
- Preview, where `NEXTAUTH_URL` is normally unset: the immutable deployment host
  from `VERCEL_URL` (`:84-88`).

[VERIFIED via `docs/AUTHENTICATION_SETUP.md` §1.5 lines 95-109] The only Preview
host registered as an Entra redirect URI is the stable alias
`https://wmkfresearchapps-preview.vercel.app`; Entra does not accept wildcard
branch URLs. So the stable alias is the only Preview host where staff can
actually sign in, and on that alias every signed-in POST returns 403 `Forbidden`
because its Origin is not the deployment's `VERCEL_URL`. GETs pass. Today's
workaround is the §2.4 procedure (branch-scoped Preview `NEXTAUTH_URL` +
redeploy + rollback).

[ASSUMED] The registered Entra list still matches §1.5. The queue entry records
seven Web redirect URIs after the 2026-09-24 cleanup, including three older
deployment-hash callbacks; those hosts are immutable single deployments and
already work under `VERCEL_URL` derivation.

## Proposed fix

On Preview only, accept the registered stable alias as an additional allowed
origin.

- `validateOrigin` builds a small **set** of allowed origins instead of one
  string; the comparison at `:114` becomes set membership.
- Production path is unchanged: when `VERCEL_ENV !== 'preview'`, the set is
  exactly the `NEXTAUTH_URL` origin, as now.
- Preview set = (`NEXTAUTH_URL` origin if a branch override is set, else the
  `VERCEL_URL` origin) ∪ the stable alias origin.
- Fail-closed branches stay as they are. `NODE_ENV` is `production` on Preview,
  so `:90-94` and `:100-102` are live there; an explicitly invalid Preview
  `NEXTAUTH_URL` must still fail closed (existing test), and the alias constant
  must never turn a missing/invalid primary origin into a pass.
- The alias is never taken from a request header (`Host`, `X-Forwarded-Host`).
- Callers: `validateOrigin` is called only by `requireAuth` (`:160`) and
  `requireAppAccess` (`:318`); `requireAuthWithProfile` (`:226-227`) and
  `requireSuperuser` (`:452`) inherit it through `requireAuth`. [VERIFIED via
  grep of `lib/utils/auth.js`] No other Origin check exists in `lib/`, `pages/`
  or `shared/` [VERIFIED via grep for `headers['origin']` / `Origin mismatch`].

### Invariants preserved from the 2026-08-15 origin hardening

From `docs/audits/codex-origin-and-cron-auth-hardening-implementation-2026-08-15.md:39-46`;
each keeps its existing test and stays true after this change:

| # | Invariant | How the plan keeps it |
| --- | --- | --- |
| 1 | Safe methods bypass Origin validation | Early return unchanged |
| 5 | Production never substitutes `VERCEL_URL` (or the alias) for a missing `NEXTAUTH_URL` | Alias added only inside the `VERCEL_ENV === 'preview'` branch |
| 6 | Preview derives from `VERCEL_URL` only when `NEXTAUTH_URL` is absent | Unchanged; the alias is an addition, not a replacement |
| 7 | Preview fails closed when `VERCEL_URL` is missing or unparseable | Alias is added only after a valid primary origin exists; new test: missing `VERCEL_URL` + alias Origin → 403 |
| 8 | An invalid `NEXTAUTH_URL` never falls through | Unchanged; new test: invalid Preview `NEXTAUTH_URL` + alias Origin → 403 |
- Comments at `:51-57` and `:80-83` updated to describe the set.

**D1 — where the alias lives (recommendation: tracked code constant).** A single
exported constant in `lib/utils/auth.js` (or a tiny sibling module), changed
only by reviewed commit. Rationale: it widens a security allowlist, and the repo
already treats security hostname lists as tracked code (the Dataverse target
interlock's `target-registry.js`: "extending it is a reviewed commit, not an env
edit"). This intentionally departs from `feedback-mutable-parameters-not-in-code`;
the alias is fixed by its Entra registration, so changing it already requires a
deliberate step. Alternative: a Preview
env var such as `PREVIEW_ALLOWED_ORIGINS`, which lets an env edit widen CSRF
scope without review.

### Threat model

A browser sends `Origin: https://wmkfresearchapps-preview.vercel.app` only from
a page served on that alias, which is always a deployment of this project's own
code. [VERIFIED via `public_suffix_list.dat` line 16327, fetched 2026-11-03]
`vercel.app` is on the Public Suffix List, so other people's `vercel.app`
sites are separate sites and cannot use our origin. Accepting the alias therefore
admits our own Preview code, possibly from a different branch than the receiving
deployment, not third parties. Non-browser callers can forge Origin, but they
are not the CSRF threat (no victim's cookies). Production gains nothing new.

### Non-goals

- Accepting `VERCEL_BRANCH_URL` (queue option (b)). No branch URL has an Entra
  callback, so no one can sign in there; it would widen the list with no use.
  Revisit only if the owner registers a per-branch callback.
- Any Entra app-registration change.
- Any Production behavior or env change.
- Removing the three older deployment-hash callbacks (separate owner decision).

## Tests

Extend the Preview block in `tests/unit/utils/auth.test.js` (around `:420-480`):

1. Alias Origin accepted on Preview via `requireAuth` and via `requireAppAccess`.
2. Alias Referer (no Origin) accepted on Preview.
3. Alias Origin **rejected** when `VERCEL_ENV` is `production` (Production
   `NEXTAUTH_URL` set to the branded host).
4. Alias accepted alongside a branch-scoped Preview `NEXTAUTH_URL` override.
5. Existing cases still hold: arbitrary origin rejected on Preview; invalid
   Preview `NEXTAUTH_URL` still fails closed even when Origin is the alias;
   missing `VERCEL_URL` on Preview still fails closed even when Origin is the
   alias; cookie-bearing request with no Origin/Referer still rejected.
6. A lookalike origin (`https://wmkfresearchapps-preview.vercel.app.evil.com`,
   `http://` scheme) rejected.

## Docs and memory to reconcile

- `docs/AUTHENTICATION_SETUP.md`: §2.2 note (line ~141), §2.4 (no longer needed
  for alias POSTs; keep only as the procedure for an unregistered host or drop),
  troubleshooting entry (~288-299).
- `.claude-memory/project-vercel-cli-deploy-preview-auth.md`: the "Do" bullet
  that sends alias POSTs through §2.4.
- `docs/CURRENT_WORK_QUEUE.md`: close the entry with merge/deploy evidence.
- `docs/API_ROUTE_SECURITY_MATRIX.md`: [VERIFIED via grep] has no CSRF/Origin
  row today. The guard is shared by every `requireAuth`/`requireAppAccess` route,
  not per-route, so no per-route row changes; add one sentence describing the
  Preview origin set only if the matrix has a shared-guard section to hold it.
  [VERIFIED via grep at build] It has none (the App guard row at `:91` names
  `requireAppAccess` without describing Origin checks), so the matrix is
  unchanged. The agent wiki `topics/security-auth.md` was updated instead.

## Release and verification

Tier 2 (authentication) under `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`:
branch `claude/preview-alias-csrf`, characterization tests first, PR with CI
green, explicit owner decision to merge. Rollback: revert the merge commit;
Production behavior is unchanged either way.

The change only alters Preview behavior, so the real proof is a Preview run,
before merge:

1. Record the alias's current target.
2. Deploy the branch to Preview **without** any `NEXTAUTH_URL` override.
3. Repoint the stable alias to that deployment and verify it.
4. Sign in on the alias; send one validation-only POST; confirm the response is
   not the 403.
5. Restore the alias to its recorded target and verify it.

Steps 1, 3 and 5 are Vercel alias operations on an auth surface: owner-run or
owner-present.

**D2 — the validation-only POST (recommendation: Dynamics Explorer chat with an
empty `messages` array).** `pages/api/dynamics-explorer/chat.js:51-77` passes
`requireAppAccess` (the CSRF check), then the rate limiter, then returns an SSE
`error` event "At least one message is required" before any model call or
Dataverse access. It is also the route where the bug was first seen. Success =
an SSE error event; failure = HTTP 403 `{"error":"Forbidden"}`. The rate
limiter (`max: 10`, `chat.js:43`) is an in-memory `Map` [VERIFIED via
`shared/api/middleware/rateLimiter.js:4-5`], so the probe leaves no durable
row.

[ASSUMED] The stable alias may currently be unassigned
(`docs/plans/CLIENT_REQUEST_LAYER_EXECUTION_2026-09-19.md:936-937` found it
unassigned once). "Restore" then means removing the assignment again.

## Contract review (Session 661)

`/contract-reconcile` Mode A on this plan. No persistence, partial-success,
async or new enum surface: those audits are N/A. Whole-flow: browser on alias →
relative `fetch` (Origin = alias) → `requireAuth`/`requireAppAccess` →
`validateOrigin` → route. Durable surfaces: no route added, so
`check:api-routes` and `CANONICAL_COUNTS` are unaffected. Named changes applied:
the invariant table above, the inherited-caller list, and the limiter
resolution. Verdict: **READY WITH NAMED CHANGES (applied)**, owner decisions
D1–D2 since approved and the Public Suffix List check since verified.

## Scope

- Code: one function in `lib/utils/auth.js` (~15 lines) plus one constant.
- Tests: one existing file, ~6 new cases.
- Docs/memory: 3-4 files.
- External: one alias repoint and restore for verification; no Entra or env
  changes.
- Production behavior change: none.
