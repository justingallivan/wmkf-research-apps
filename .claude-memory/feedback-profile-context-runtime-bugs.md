---
name: feedback-profile-context-runtime-bugs
description: ProfileContext atomic-refactor (S203) shipped runtime bugs CI missed — two the stop-gate caught: an init fetch loop and a destructive-migration data-loss path. Check response.ok before irreversible actions; never let an effect depend on a callback that depends on state it mutates.
metadata:
  type: feedback
---

The S203 atomic-state-machine refactor of `shared/context/ProfileContext.js` — which correctly resolved a long chain of profile/preferences race + resurrection bugs — itself shipped at least two runtime bugs that `npm run lint` + the 1544-test jest suite + `next build` all passed clean. The stop-gate (Codex) caught these two after they landed (there may be others not yet surfaced — this is not a proven-exhaustive count):

1. **Infinite fetch loop on mount.** `loadSession` (a `useCallback`) listed `state.profiles` in its dependency array, and the `init` `useEffect` depended on `loadSession`. `init` calls `fetchProfiles()`, which dispatches `UPDATE_PROFILES` with a NEW array reference → `state.profiles` changes → `loadSession` is recreated → the `init` effect re-fires → unbounded loop hammering `/api/user-profiles` + `/api/user-preferences`. Fixed (commit `0876dd0`) by reading profiles from a synced `profilesRef` so `loadSession`'s deps are stable (`[fetchProfiles, migrateLegacySettings]`).

2. **Destructive migration deletes data on a failed save.** `migrateLegacySettings` awaited the migration POST but never checked `response.ok`. `fetch()` does NOT throw on an HTTP error status, so a rejected save (500/403) fell through to `localStorage.removeItem(...)`, purging the user's legacy settings that were never persisted to the profile → permanent data loss. Fixed (commit `306f77a`) by throwing on `!response.ok` before the purge, so a failed save preserves localStorage and migration retries next load.

**Why:** Two reusable root causes. (a) `fetch()` doesn't reject on HTTP error status — any `await fetch` that gates an irreversible/destructive action (delete, purge, overwrite) MUST check `response.ok` first. (b) A callback that depends on state it also causes to change, when that callback is itself an effect dependency, is a self-retriggering loop — use a `useRef` to *read* the changing state inside the callback without taking it as a dependency.

**How to apply:** For load-bearing async/effect code, "lint + tests + build green" is NOT sufficient evidence of correctness — both bugs were runtime-only and invisible to CI. Manually smoke-test (mount the app, switch a profile, simulate a failing save) before calling such a refactor done. Related: [[feedback-real-fix-not-design-note]], [[feedback-apply-reconcile-to-fix-work]]. Design doc: `docs/PROFILE_CONTEXT_REFACTOR_SUMMARY.md`.
