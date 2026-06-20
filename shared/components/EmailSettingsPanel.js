/**
 * EmailSettingsPanel - Collapsible panel for email generation settings
 *
 * Settings include:
 * - Sender name and email
 * - Signature block
 * - Grant cycle settings (program name, review deadline, custom fields)
 *
 * Settings are stored per-user in the database when a profile is selected,
 * with fallback to localStorage when no profile is active.
 */

import { useState, useEffect, useRef } from 'react';
import { useProfile } from '../context/ProfileContext';
import {
  PREFERENCE_KEYS,
  readEmailSignaturePreference,
  serializeEmailSignaturePreference,
} from '../config/reviewerFinderPreferences';

// Storage keys
const STORAGE_KEYS = {
  EMAIL_SETTINGS: 'email_reviewer_settings',
  EMAIL_TEMPLATE: 'email_reviewer_template',
  GRANT_CYCLE: 'email_grant_cycle',
  SENDER_INFO: 'email_sender_info',
};

// Default settings
const DEFAULT_SETTINGS = {
  senderName: '',
  senderEmail: '',
  signature: '',
  grantCycle: {
    programName: '',
    reviewDeadline: '',
    customFields: {}
  }
};

export default function EmailSettingsPanel({ onSettingsChange, initialExpanded = false }) {
  const { status, currentProfile, preferences, setPreference } = useProfile();

  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [hasStoredSettings, setHasStoredSettings] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [newFieldName, setNewFieldName] = useState('');

  // Reload settings when the profile/preferences session is ready.
  // ProfileContext guarantees that once status is 'ready', the currentProfile
  // and preferences are atomically aligned.
  useEffect(() => {
    if (status !== 'ready') return;
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, currentProfile?.id, preferences[PREFERENCE_KEYS.EMAIL_SIGNATURE], preferences[PREFERENCE_KEYS.SENDER_INFO], preferences[PREFERENCE_KEYS.GRANT_CYCLE_SETTINGS]]);

  const loadSettings = () => {
    try {
      let loadedSettings = null;

      // 1. Try Profile preferences
      if (currentProfile) {
        let hasAnyProfileSettings = false;

        if (preferences[PREFERENCE_KEYS.EMAIL_SIGNATURE] || preferences[PREFERENCE_KEYS.SENDER_INFO]) {
          const sender = readEmailSignaturePreference(preferences);
          loadedSettings = loadedSettings || { ...DEFAULT_SETTINGS };
          loadedSettings.senderName = sender.name || '';
          loadedSettings.senderEmail = sender.email || '';
          loadedSettings.signature = sender.signature || '';
          hasAnyProfileSettings = true;
        }

        if (preferences[PREFERENCE_KEYS.GRANT_CYCLE_SETTINGS]) {
          try {
            const grantCycle = JSON.parse(preferences[PREFERENCE_KEYS.GRANT_CYCLE_SETTINGS]);
            loadedSettings = loadedSettings || { ...DEFAULT_SETTINGS };
            loadedSettings.grantCycle = {
              ...loadedSettings.grantCycle,
              ...grantCycle
            };
            hasAnyProfileSettings = true;
          } catch (e) {
            console.warn('Failed to parse grant cycle from profile:', e);
          }
        }
      }

      // 2. Fallback to localStorage ONLY if no profile is active.
      // If a profile IS active, ProfileContext has already handled migration
      // and purged localStorage, so we don't need to check it here.
      if (!loadedSettings && !currentProfile) {
        const stored = localStorage.getItem(STORAGE_KEYS.EMAIL_SETTINGS);
        if (stored) {
          loadedSettings = JSON.parse(atob(stored));
        }
      }

      if (loadedSettings) {
        setSettings(loadedSettings);
        setHasStoredSettings(true);
        if (onSettingsChange) {
          onSettingsChange(loadedSettings);
        }
      } else {
        // Reset to defaults if no settings found
        setSettings(DEFAULT_SETTINGS);
        setHasStoredSettings(false);
      }
    } catch (error) {
      console.error('Failed to load email settings:', error);
    }
  };

  // Update a single setting
  const updateSetting = (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
    setSaveStatus(null);
  };

  // Update grant cycle setting
  const updateGrantCycle = (key, value) => {
    setSettings(prev => ({
      ...prev,
      grantCycle: {
        ...prev.grantCycle,
        [key]: value
      }
    }));
    setSaveStatus(null);
  };

  // Add custom field
  const addCustomField = () => {
    if (!newFieldName.trim()) return;

    const fieldKey = newFieldName.trim().toLowerCase().replace(/\s+/g, '_');
    setSettings(prev => ({
      ...prev,
      grantCycle: {
        ...prev.grantCycle,
        customFields: {
          ...prev.grantCycle.customFields,
          [fieldKey]: ''
        }
      }
    }));
    setNewFieldName('');
    setSaveStatus(null);
  };

  // Update custom field value
  const updateCustomField = (key, value) => {
    setSettings(prev => ({
      ...prev,
      grantCycle: {
        ...prev.grantCycle,
        customFields: {
          ...prev.grantCycle.customFields,
          [key]: value
        }
      }
    }));
    setSaveStatus(null);
  };

  // Remove custom field
  const removeCustomField = (key) => {
    setSettings(prev => {
      const newCustomFields = { ...prev.grantCycle.customFields };
      delete newCustomFields[key];
      return {
        ...prev,
        grantCycle: {
          ...prev.grantCycle,
          customFields: newCustomFields
        }
      };
    });
    setSaveStatus(null);
  };

  // Save settings
  const saveSettings = async () => {
    try {
      if (currentProfile) {
        // Save to profile preferences as separate keys
        await setPreference(PREFERENCE_KEYS.EMAIL_SIGNATURE, serializeEmailSignaturePreference({
          name: settings.senderName || '',
          email: settings.senderEmail || '',
          signature: settings.signature || ''
        }));

        if (settings.grantCycle) {
          await setPreference(PREFERENCE_KEYS.GRANT_CYCLE_SETTINGS, JSON.stringify(settings.grantCycle));
        }
      } else {
        // Fallback to localStorage
        localStorage.setItem(STORAGE_KEYS.EMAIL_SETTINGS, btoa(JSON.stringify(settings)));
      }

      setHasStoredSettings(true);
      setSaveStatus('saved');

      if (onSettingsChange) {
        onSettingsChange(settings);
      }

      setTimeout(() => setSaveStatus(null), 3000);
    } catch (error) {
      console.error('Failed to save email settings:', error);
      setSaveStatus('error');
    }
  };

  // Clear settings
  const clearSettings = async () => {
    if (!confirm('Are you sure you want to clear all email settings?')) {
      return;
    }

    if (currentProfile) {
      // Clear from profile preferences
      await setPreference(PREFERENCE_KEYS.EMAIL_SIGNATURE, '');
      await setPreference(PREFERENCE_KEYS.GRANT_CYCLE_SETTINGS, '');
    }
    // Always purge legacy localStorage so reopen cannot resurrect the cleared value.
    localStorage.removeItem(STORAGE_KEYS.EMAIL_SETTINGS);

    setSettings(DEFAULT_SETTINGS);
    setHasStoredSettings(false);
    setSaveStatus(null);

    if (onSettingsChange) {
      onSettingsChange(DEFAULT_SETTINGS);
    }
  };

  // Count configured items
  const configuredCount = [
    settings.senderEmail,
    settings.signature,
    settings.grantCycle?.programName
  ].filter(Boolean).length;

  const customFieldKeys = Object.keys(settings.grantCycle?.customFields || {});

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Collapsible Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50
                   hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-500">✉️</span>
          <span className="font-medium text-gray-700">Email Settings</span>
          {hasStoredSettings && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
              {configuredCount} configured
            </span>
          )}
        </div>
        <span className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-4 border-t border-gray-200 bg-white">
          <p className="text-sm text-gray-600 mb-4">
            Configure sender information and grant cycle settings for reviewer invitation emails.
          </p>

          {/* Sender Information */}
          <div className="mb-6 pb-6 border-b border-gray-100">
            <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <span className="text-blue-600">👤</span>
              Sender Information
            </h4>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Your Name
                </label>
                <input
                  type="text"
                  value={settings.senderName}
                  onChange={(e) => updateSetting('senderName', e.target.value)}
                  placeholder="Dr. Jane Smith"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                           focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Your Email
                </label>
                <input
                  type="email"
                  value={settings.senderEmail}
                  onChange={(e) => updateSetting('senderEmail', e.target.value)}
                  placeholder="jane.smith@university.edu"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                           focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Signature Block */}
          <div className="mb-6 pb-6 border-b border-gray-100">
            <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <span className="text-purple-600">✍️</span>
              Signature Block
            </h4>

            <textarea
              value={settings.signature}
              onChange={(e) => updateSetting('signature', e.target.value)}
              placeholder="Best regards,

Dr. Jane Smith
Program Officer
Grant Review Office
University of Example"
              rows={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                       focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                       font-mono"
            />
            <p className="mt-1 text-xs text-gray-500">
              This will appear at the end of each email. Use {'{{signature}}'} placeholder in your template.
            </p>
          </div>

          {/* Grant Cycle Settings */}
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <span className="text-green-600">📅</span>
              Grant Cycle Settings
              <span className="text-xs font-normal text-gray-500">(Shared across all proposals)</span>
            </h4>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Program Name
                </label>
                <input
                  type="text"
                  value={settings.grantCycle?.programName || ''}
                  onChange={(e) => updateGrantCycle('programName', e.target.value)}
                  placeholder="Research Excellence Program 2025"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                           focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Use {'{{programName}}'} in your template.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Review Deadline
                </label>
                <input
                  type="date"
                  value={settings.grantCycle?.reviewDeadline || ''}
                  onChange={(e) => updateGrantCycle('reviewDeadline', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                           focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Use {'{{reviewDeadline}}'} in your template.
                </p>
              </div>

              {/* Custom Fields */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Custom Fields
                </label>

                {customFieldKeys.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {customFieldKeys.map(key => (
                      <div key={key} className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 min-w-[100px]">
                          {`{{customField:${key}}}`}
                        </span>
                        <input
                          type="text"
                          value={settings.grantCycle.customFields[key]}
                          onChange={(e) => updateCustomField(key, e.target.value)}
                          placeholder={`Value for ${key}`}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm
                                   focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <button
                          onClick={() => removeCustomField(key)}
                          className="text-red-500 hover:text-red-700 text-sm px-2"
                          title="Remove field"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newFieldName}
                    onChange={(e) => setNewFieldName(e.target.value)}
                    placeholder="Field name (e.g., panelDate)"
                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm
                             focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    onKeyPress={(e) => e.key === 'Enter' && addCustomField()}
                  />
                  <button
                    onClick={addCustomField}
                    disabled={!newFieldName.trim()}
                    className="px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded
                             hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    + Add
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Add custom fields like panel date, compensation, etc.
                </p>
              </div>
            </div>
          </div>

          {/* Status Message */}
          {saveStatus === 'saved' && (
            <div className="mb-4 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2">
              <span>✓</span>
              Settings saved successfully
            </div>
          )}
          {saveStatus === 'error' && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
              <span>✗</span>
              Failed to save settings
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              onClick={clearSettings}
              className="text-sm text-gray-500 hover:text-red-600 transition-colors"
              disabled={!hasStoredSettings}
            >
              Clear All
            </button>
            <button
              onClick={saveSettings}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg
                       hover:bg-blue-700 transition-colors"
            >
              Save Settings
            </button>
          </div>

          {/* Info Box */}
          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">
              <strong>💾 Storage:</strong> {currentProfile
                ? `Settings are stored in your profile (${currentProfile.displayName || currentProfile.name}).`
                : 'Settings are stored locally in your browser.'}
              {' '}They will be used when generating reviewer invitation emails.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// Export storage keys and defaults
export { STORAGE_KEYS, DEFAULT_SETTINGS };
