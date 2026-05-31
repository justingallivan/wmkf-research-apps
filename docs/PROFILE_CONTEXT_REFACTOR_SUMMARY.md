# ProfileContext Atomic Consistency Refactor Summary

## Overview
The `ProfileContext` was refactored to resolve recurring async state-consistency bugs where `currentProfile` and `preferences` would update independently. The new architecture uses an atomic state machine and centralized migration logic to ensure that profile and preference data are always consistent and that stale async operations cannot clobber active state.

## Core Architectural Changes

### 1. Atomic State Machine
Refactored `ProfileContext.js` to use `useReducer` with a unified session state.
- **States:** `loading`, `ready`, `error`.
- **Atomic Unit:** `currentProfile` and `preferences` are updated in a single transition. Consumers never see a "half-loaded" state (e.g., New Profile + Old Preferences).
- **Immediate Reset:** Switching profiles immediately clears the previous session's preferences, eliminating data leakage between profile renders.

### 2. Request ID Tagging (Fencing)
Implemented monotonic `requestId` tracking for all async operations.
- Every load request is tagged with a unique ID.
- The reducer ignores `LOAD_SUCCESS` actions if the `requestId` is older than the `activeRequestId`.
- This inherently handles out-of-order fetch responses and rapid profile switching without requiring complex guards in consumer components.

### 3. Centralized & Destructive Migration
Retired the fragile, multi-component migration logic and moved it into the `ProfileProvider`.
- **One-Shot Migration:** When a profile is loaded, the context checks for a `_legacy_migration_complete` flag.
- **Destructive Purge:** After migrating data from `localStorage` to the database, the context immediately deletes the `localStorage` keys.
- **Resolution:** This permanently fixes the "resurrection" bug where cleared profile preferences were being overwritten by stale `localStorage` copies during component re-renders.

## Consumer Impact
The following components were simplified by removing redundant `useRef` guards and migration logic:
- `shared/components/EmailSettingsPanel.js`
- `shared/components/SettingsModal.js`
- `shared/components/EmailTemplateEditor.js`
- `shared/components/EmailGeneratorModal.js`

**New Simplified Pattern:**
```javascript
const { status, currentProfile, preferences } = useProfile();

useEffect(() => {
  if (status !== 'ready') return;
  // Atomically consistent data is guaranteed here
  loadSettings(currentProfile, preferences);
}, [status, currentProfile?.id, preferences]);
```

## Benefits
- **Eliminated Race Conditions:** Structural fix for a whole class of async bugs.
- **Reduced Complexity:** Removed ~150 lines of boilerplate/guard logic across 4 components.
- **Data Integrity:** Singular source of truth (Database > LocalStorage) with no resurrection paths.
- **Better UX:** No "flash" of old user data when switching profiles.

## Post-Refactor Fixes (runtime bugs CI did not catch)
The architecture above is sound, but the initial implementation shipped two
runtime bugs that `npm run lint`, the full jest suite, and `next build` all
passed clean (they are render-time / HTTP-status issues, invisible to CI). Both
were caught in stop-gate review and fixed — recorded here so they are not
reintroduced. (Caught-by-review, not a proven-exhaustive list.)

1. **Init fetch loop (fixed, commit `0876dd0`).** `loadSession` listed
   `state.profiles` in its `useCallback` deps, and the `init` effect depended on
   `loadSession`. `init` calls `fetchProfiles()` → `UPDATE_PROFILES` dispatches a
   new array reference → `state.profiles` changes → `loadSession` is recreated →
   the `init` effect re-fires → unbounded loop. **Fix:** read profiles from a
   synced `profilesRef` inside `loadSession` so it does not depend on
   `state.profiles` (deps are now `[fetchProfiles, migrateLegacySettings]`).
   *Rule:* never let an effect depend on a callback that depends on state the
   callback itself mutates — read changing state via a ref instead.

2. **Destructive migration data loss (fixed, commit `306f77a`).**
   `migrateLegacySettings` awaited the migration POST but did not check
   `response.ok`. `fetch()` does NOT throw on an HTTP error status (500/403), so
   a rejected save fell through to `localStorage.removeItem(...)` — purging the
   user's legacy settings even though they were never persisted to the profile
   (permanent data loss). **Fix:** `if (!response.ok) throw` before the purge, so
   a failed save preserves localStorage and migration retries next load.
   *Rule:* any `await fetch` that gates an irreversible/destructive action must
   check `response.ok` first.

**Process note:** for load-bearing async/effect code, green CI is not sufficient
evidence of correctness — manually smoke-test (mount the app, switch a profile,
simulate a failing save) before considering such a refactor done.
