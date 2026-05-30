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
