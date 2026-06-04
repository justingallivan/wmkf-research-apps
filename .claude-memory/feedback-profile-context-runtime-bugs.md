---
name: feedback-profile-context-runtime-bugs
description: ProfileContext atomic-refactor (S203) shipped runtime bugs CI missed — two the stop-gate caught: an init fetch loop and a destructive-migration data-loss path. Check response.ok before irreversible actions; never let an effect depend on a callback that depends on state it mutates.
metadata:
  type: feedback
  status: closed
  scope: auth
  last_verified: S204 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: doing load-bearing async/effect React work (contexts, mount effects, fetch-then-mutate flows) — especially anything with destructive side effects gated on a fetch.

Do:
- Check `response.ok` before any irreversible action (delete/purge/overwrite) — `fetch()` does not throw on HTTP errors.
- Use a `useRef` to read changing state inside a callback that is itself an effect dependency, so deps stay stable.
- Manually smoke-test (mount, switch profile, simulate a failing save) before calling such a refactor done; lint+tests+build green is not sufficient.

Do not:
- Assume CI (lint + jest + build) catches runtime-only effect loops or fetch-error data-loss paths — both S203 bugs passed CI clean.
- Let an effect depend on a callback that depends on the state that callback mutates.

Ground truth: `shared/context/ProfileContext.js`; `docs/PROFILE_CONTEXT_REFACTOR_SUMMARY.md`; `tests/unit/profile-context.test.js`; commits 0876dd0, 306f77a, 62b0640.

The S203 atomic-state-machine refactor of `shared/context/ProfileContext.js` — which correctly resolved a long chain of profile/preferences race + resurrection bugs — itself shipped at least two runtime bugs that `npm run lint` + the 1544-test jest suite + `next build` all passed clean. The stop-gate (Codex) caught these two after they landed (there may be others not yet surfaced — this is not a proven-exhaustive count):

1. **Infinite fetch loop on mount.** `loadSession` (a `useCallback`) listed `state.profiles` in its dependency array, and the `init` `useEffect` depended on `loadSession`. `init` calls `fetchProfiles()`, which dispatches `UPDATE_PROFILES` with a NEW array reference → `state.profiles` changes → `loadSession` is recreated → the `init` effect re-fires → unbounded loop hammering `/api/user-profiles` + `/api/user-preferences`. Fixed (commit `0876dd0`) by reading profiles from a synced `profilesRef` so `loadSession`'s deps are stable (`[fetchProfiles, migrateLegacySettings]`).

2. **Destructive migration deletes data on a failed save.** `migrateLegacySettings` awaited the migration POST but never checked `response.ok`. `fetch()` does NOT throw on an HTTP error status, so a rejected save (500/403) fell through to `localStorage.removeItem(...)`, purging the user's legacy settings that were never persisted to the profile → permanent data loss. Fixed (commit `306f77a`) by throwing on `!response.ok` before the purge, so a failed save preserves localStorage and migration retries next load.

**Why:** Two reusable root causes. (a) `fetch()` doesn't reject on HTTP error status — any `await fetch` that gates an irreversible/destructive action (delete, purge, overwrite) MUST check `response.ok` first. (b) A callback that depends on state it also causes to change, when that callback is itself an effect dependency, is a self-retriggering loop — use a `useRef` to *read* the changing state inside the callback without taking it as a dependency.

**How to apply:** For load-bearing async/effect code, "lint + tests + build green" is NOT sufficient evidence of correctness — both bugs were runtime-only and invisible to CI. Manually smoke-test (mount the app, switch a profile, simulate a failing save) before calling such a refactor done. Related: [[feedback-real-fix-not-design-note]], [[feedback-apply-reconcile-to-fix-work]]. Design doc: `docs/PROFILE_CONTEXT_REFACTOR_SUMMARY.md`.

**CLOSED S204 (2026-05-30).** The mandatory smoke test was done and the refactor verified three ways: (1) 5 regression tests added — `tests/unit/profile-context.test.js`, commit `62b0640` — pinning both bugs (each confirmed to go RED when the bug is reintroduced) plus the stale-flash and out-of-order-request guards; (2) server-log analysis under a local `npm run dev` (auth bypassed via temporary `AUTH_REQUIRED=false` + dev `NEXTAUTH_SECRET` in `.env.local`, reverted after): bounded request pattern, fresh `GET /api/user-preferences?profileId=<new>` on every switch, no loop, no cross-profile bleed; (3) Justin's browser pass: correct per-profile settings + persistence, no leak. The file previously had ZERO tests — that gap is now closed, so a reintroduction is CI-caught. Local-dev auth note: full Azure login can't run on localhost (no `localhost:3000` redirect URI), so `AUTH_REQUIRED=false`+dev secret is the way to smoke-test gated UI locally; the fire-and-forget `PATCH /api/user-profiles` 401s harmlessly under that bypass.
