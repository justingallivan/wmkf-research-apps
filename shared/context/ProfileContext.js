/**
 * ProfileContext - Global user profile state management
 *
 * Integrates with NextAuth session for automatic profile selection.
 * When authenticated, the profile is determined by the Azure account.
 * Provides preference management across the app.
 */

import { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import {
  PREFERENCE_KEYS,
  STORAGE_KEYS,
  normalizeEmailSignatureValue,
  serializeEmailSignaturePreference,
} from '../config/reviewerFinderPreferences';

const ProfileContext = createContext(null);

// localStorage key for persisting selected profile (fallback when not authenticated)
const SELECTED_PROFILE_KEY = 'selected_user_profile_id';
const MIGRATION_FLAG = '_legacy_migration_complete';

const initialState = {
  status: 'loading', // 'loading' | 'ready' | 'error'
  profiles: [],
  currentProfile: null,
  preferences: {},
  error: null,
  activeRequestId: 0
};

function profileReducer(state, action) {
  switch (action.type) {
    case 'START_LOAD':
      return {
        ...state,
        status: 'loading',
        activeRequestId: action.requestId,
        error: null,
        // If we are switching profiles, clear the old one and its prefs immediately
        // so consumers never see a "flash" of the old user's settings.
        currentProfile: action.profile || null,
        preferences: {}
      };

    case 'LOAD_SUCCESS':
      if (action.requestId !== state.activeRequestId) return state;
      return {
        ...state,
        status: 'ready',
        profiles: action.profiles || state.profiles,
        currentProfile: action.profile,
        preferences: action.preferences || {},
        error: null
      };

    case 'LOAD_ERROR':
      if (action.requestId !== state.activeRequestId) return state;
      return {
        ...state,
        status: 'error',
        error: action.error
      };

    case 'UPDATE_PROFILES':
      return { ...state, profiles: action.profiles };

    case 'UPDATE_PROFILE':
      if (action.profileId !== state.currentProfile?.id) return state;
      return {
        ...state,
        currentProfile: { ...state.currentProfile, ...action.updates }
      };

    case 'UPDATE_PREFERENCES':
      if (action.profileId !== state.currentProfile?.id) return state;
      return {
        ...state,
        preferences: { ...state.preferences, ...action.updates }
      };

    default:
      return state;
  }
}

export function ProfileProvider({ children }) {
  const { data: session, status: sessionStatus } = useSession();
  const [state, dispatch] = useReducer(profileReducer, initialState);
  const requestIdRef = useRef(0);
  // Mirror of state.profiles read inside loadSession WITHOUT making it a
  // dependency. If loadSession depended on state.profiles it would be recreated
  // every time profiles load, retriggering the init effect (which depends on
  // loadSession) — an unbounded fetch loop on mount.
  const profilesRef = useRef([]);
  useEffect(() => { profilesRef.current = state.profiles; }, [state.profiles]);

  /**
   * Fetch all profiles from the API
   */
  const fetchProfiles = useCallback(async () => {
    try {
      const response = await fetch('/api/user-profiles');
      if (!response.ok) throw new Error('Failed to fetch profiles');
      const data = await response.json();
      const profiles = data.profiles || [];
      dispatch({ type: 'UPDATE_PROFILES', profiles });
      return profiles;
    } catch (err) {
      console.error('Failed to load profiles:', err);
      return [];
    }
  }, []);

  /**
   * Migrate settings from localStorage to profile preferences (destructive)
   */
  const migrateLegacySettings = useCallback(async (profileId, currentPrefs) => {
    if (currentPrefs[MIGRATION_FLAG]) return currentPrefs;

    console.log(`Checking for legacy settings to migrate for profile ${profileId}...`);
    const migratedPrefs = { ...currentPrefs, [MIGRATION_FLAG]: 'true' };
    let hasMigrationData = false;

    // Mapping of localStorage keys to preference keys
    // email_reviewer_settings is a composite key used by EmailSettingsPanel
    const legacyKeys = {
      [STORAGE_KEYS.SENDER_INFO]: PREFERENCE_KEYS.SENDER_INFO,
      [STORAGE_KEYS.GRANT_CYCLE]: PREFERENCE_KEYS.GRANT_CYCLE_SETTINGS,
      [STORAGE_KEYS.EMAIL_TEMPLATE]: PREFERENCE_KEYS.EMAIL_TEMPLATE,
      [STORAGE_KEYS.CURRENT_CYCLE]: PREFERENCE_KEYS.CURRENT_CYCLE_ID,
      'email_reviewer_settings': null // Special handling below
    };

    const settingsToSave = { [MIGRATION_FLAG]: 'true' };

    for (const [localKey, prefKey] of Object.entries(legacyKeys)) {
      const stored = localStorage.getItem(localKey);
      if (!stored) continue;

      hasMigrationData = true;
      try {
        if (localKey === 'email_reviewer_settings') {
          // This legacy key contained a mix of sender and grant cycle info
          const decoded = JSON.parse(atob(stored));
          if (!migratedPrefs[PREFERENCE_KEYS.SENDER_INFO] && (decoded.senderName || decoded.senderEmail || decoded.signature)) {
            settingsToSave[PREFERENCE_KEYS.SENDER_INFO] = JSON.stringify({
              name: decoded.senderName || '',
              email: decoded.senderEmail || '',
              signature: decoded.signature || ''
            });
          }
          if (!migratedPrefs[PREFERENCE_KEYS.GRANT_CYCLE_SETTINGS] && decoded.grantCycle) {
            settingsToSave[PREFERENCE_KEYS.GRANT_CYCLE_SETTINGS] = JSON.stringify(decoded.grantCycle);
          }
        } else if (prefKey && !migratedPrefs[prefKey]) {
          // Standard keys: they are base64 encoded JSON except for CURRENT_CYCLE
          let value = stored;
          if (localKey !== STORAGE_KEYS.CURRENT_CYCLE) {
            value = JSON.stringify(JSON.parse(atob(stored)));
          }
          settingsToSave[prefKey] = value;
        }
      } catch (e) {
        console.warn(`Failed to migrate legacy key ${localKey}:`, e);
      }
    }

    if (hasMigrationData || !currentPrefs[MIGRATION_FLAG]) {
      try {
        const response = await fetch('/api/user-preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId, preferences: settingsToSave })
        });
        // fetch() does NOT throw on HTTP error status, so an unchecked response
        // would fall through to the purge below and DELETE the local settings
        // even though the server rejected the save — permanent data loss. Only
        // purge after a confirmed-successful save.
        if (!response.ok) throw new Error('Failed to persist migrated preferences');

        // After successful migration, PURGE localStorage to prevent resurrection
        Object.keys(legacyKeys).forEach(key => localStorage.removeItem(key));
        console.log(`Successfully migrated and purged legacy settings for profile ${profileId}`);
        return { ...migratedPrefs, ...settingsToSave };
      } catch (err) {
        console.error('Failed to commit migration to profile:', err);
        return currentPrefs;
      }
    }

    return currentPrefs;
  }, []);

  const copyLegacySenderInfoToEmailSignature = useCallback(async (profileId, currentPrefs) => {
    if (
      Object.prototype.hasOwnProperty.call(currentPrefs, PREFERENCE_KEYS.EMAIL_SIGNATURE)
      || !currentPrefs[PREFERENCE_KEYS.SENDER_INFO]
    ) {
      return currentPrefs;
    }

    const sender = normalizeEmailSignatureValue(currentPrefs[PREFERENCE_KEYS.SENDER_INFO]);
    if (!sender.name && !sender.email && !sender.signature) {
      return currentPrefs;
    }

    const value = serializeEmailSignaturePreference(sender);
    try {
      const response = await fetch('/api/user-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId,
          key: PREFERENCE_KEYS.EMAIL_SIGNATURE,
          value,
        }),
      });
      if (!response.ok) throw new Error('Failed to persist email signature preference');
      return { ...currentPrefs, [PREFERENCE_KEYS.EMAIL_SIGNATURE]: value };
    } catch (err) {
      console.error('Failed to copy legacy sender info to email signature:', err);
      return currentPrefs;
    }
  }, []);

  /**
   * Core session loader: fetches profile and its preferences atomically
   */
  const loadSession = useCallback(async (profileId) => {
    const requestId = ++requestIdRef.current;
    
    // If we have a profileId, we can pre-set it in loading state so the UI
    // can show the name immediately if we already have the profiles list.
    const profiles = profilesRef.current.length > 0 ? profilesRef.current : await fetchProfiles();
    const profile = profileId ? profiles.find(p => p.id === profileId) : null;

    dispatch({ type: 'START_LOAD', requestId, profile });

    if (!profileId) {
      dispatch({ type: 'LOAD_SUCCESS', requestId, profile: null, preferences: {} });
      return;
    }

    try {
      const response = await fetch(`/api/user-preferences?profileId=${profileId}`);
      if (!response.ok) throw new Error('Failed to fetch preferences');
      const data = await response.json();
      let prefs = data.preferences || {};

      // Check for and perform legacy migration
      prefs = await migrateLegacySettings(profileId, prefs);
      prefs = await copyLegacySenderInfoToEmailSignature(profileId, prefs);

      dispatch({ type: 'LOAD_SUCCESS', requestId, profile, preferences: prefs });
    } catch (err) {
      console.error('Session load error:', err);
      dispatch({ type: 'LOAD_ERROR', requestId, error: err.message });
    }
  }, [fetchProfiles, migrateLegacySettings, copyLegacySenderInfoToEmailSignature]);

  /**
   * Select a profile by ID
   */
  const selectProfile = useCallback(async (profileId) => {
    if (!profileId) {
      localStorage.removeItem(SELECTED_PROFILE_KEY);
      await loadSession(null);
      return;
    }

    localStorage.setItem(SELECTED_PROFILE_KEY, String(profileId));
    
    // Update last_used_at (fire and forget)
    fetch('/api/user-profiles', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: profileId, updateLastUsed: true })
    }).catch(err => console.error('Failed to update last_used_at:', err));

    await loadSession(profileId);
  }, [loadSession]);

  /**
   * Update a profile
   */
  const updateProfile = useCallback(async (id, updates) => {
    try {
      const response = await fetch('/api/user-profiles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update profile');
      }

      const data = await response.json();
      
      // Update local state if it's the current profile
      dispatch({ type: 'UPDATE_PROFILE', profileId: id, updates: data.profile });
      
      // Refresh the full list
      await fetchProfiles();
      return data.profile;
    } catch (err) {
      console.error('Failed to update profile:', err);
      throw err;
    }
  }, [fetchProfiles]);

  /**
   * Archive a profile
   */
  const archiveProfile = useCallback(async (id) => {
    try {
      const response = await fetch('/api/user-profiles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to archive profile');
      }

      const updatedProfiles = await fetchProfiles();

      if (state.currentProfile?.id === id) {
        const defaultProfile = updatedProfiles.find(p => p.isDefault) || updatedProfiles[0];
        await selectProfile(defaultProfile?.id || null);
      }

      return true;
    } catch (err) {
      console.error('Failed to archive profile:', err);
      throw err;
    }
  }, [state.currentProfile?.id, fetchProfiles, selectProfile]);

  /**
   * Save a single preference
   */
  const setPreference = useCallback(async (key, value) => {
    const profileId = state.currentProfile?.id;
    if (!profileId) return false;

    try {
      // Optimistic update
      dispatch({ type: 'UPDATE_PREFERENCES', profileId, updates: { [key]: value } });

      const response = await fetch('/api/user-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, key, value })
      });

      if (!response.ok) throw new Error('Failed to save preference');
      return true;
    } catch (err) {
      console.error('Failed to save preference:', err);
      // Revert could be implemented here if needed by re-fetching
      return false;
    }
  }, [state.currentProfile?.id]);

  /**
   * Save multiple preferences
   */
  const savePreferences = useCallback(async (prefsToSave) => {
    const profileId = state.currentProfile?.id;
    if (!profileId) return false;

    try {
      // Optimistic update
      dispatch({ type: 'UPDATE_PREFERENCES', profileId, updates: prefsToSave });

      const response = await fetch('/api/user-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, preferences: prefsToSave })
      });

      if (!response.ok) throw new Error('Failed to save preferences');
      return true;
    } catch (err) {
      console.error('Failed to save preferences:', err);
      return false;
    }
  }, [state.currentProfile?.id]);

  // Initial load effect
  useEffect(() => {
    if (sessionStatus === 'loading') return;

    async function init() {
      const loadedProfiles = await fetchProfiles();
      
      // 1. Authenticated session takes priority
      if (sessionStatus === 'authenticated' && session?.user?.profileId) {
        await loadSession(session.user.profileId);
        return;
      }

      // 2. Fallback to localStorage selection
      const savedProfileId = localStorage.getItem(SELECTED_PROFILE_KEY);
      if (savedProfileId) {
        const profile = loadedProfiles.find(p => p.id === parseInt(savedProfileId, 10));
        if (profile) {
          await loadSession(profile.id);
          return;
        }
      }

      // 3. Fallback to default or first profile
      const defaultProfile = loadedProfiles.find(p => p.isDefault) || loadedProfiles[0];
      if (defaultProfile) {
        localStorage.setItem(SELECTED_PROFILE_KEY, String(defaultProfile.id));
        await loadSession(defaultProfile.id);
      } else {
        await loadSession(null);
      }
    }

    init();
  }, [sessionStatus, session?.user?.profileId, fetchProfiles, loadSession]);

  const value = {
    // Atomic State
    status: state.status,
    profiles: state.profiles,
    currentProfile: state.currentProfile,
    preferences: state.preferences,
    isLoading: state.status === 'loading',
    error: state.error,
    
    // For backward compatibility
    preferencesProfileId: state.currentProfile?.id || null,

    // Session info
    session,
    isAuthenticated: sessionStatus === 'authenticated',
    sessionStatus,

    // Methods
    selectProfile,
    updateProfile,
    archiveProfile,
    refreshProfiles: fetchProfiles,
    setPreference,
    savePreferences,
    setPreferences: savePreferences, // Alias
    refreshPreferences: (id) => loadSession(id || state.currentProfile?.id),
    hasPreference: (key) => !!state.preferences[key],

    // Convenience
    hasProfile: !!state.currentProfile,
    profileId: state.currentProfile?.id || null,
    profileName: state.currentProfile?.displayName || state.currentProfile?.name || null
  };

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (!context) throw new Error('useProfile must be used within a ProfileProvider');
  return context;
}

export function useProfileId() {
  return useProfile().profileId;
}

export default ProfileContext;
