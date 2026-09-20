/**
 * ProfileLinkingDialog - First-time login profile linking
 *
 * When a user logs in with Azure for the first time and there are existing
 * unlinked profiles, this dialog lets them choose which profile to link to
 * or create a new one.
 */

import { useState, useEffect } from 'react';
import { signOut } from 'next-auth/react';
import { requestEnvelope } from '../utils/api-request';

export default function ProfileLinkingDialog({ session, onLinked }) {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLinking, setIsLinking] = useState(false);
  const [error, setError] = useState(null);

  // Fetch linkable profiles (server-side filtered: unlinked + email matches caller)
  useEffect(() => {
    async function fetchProfiles() {
      try {
        const { ok: resOk, data } = await requestEnvelope('/api/user-profiles?linkable=true');
        if (!resOk) throw new Error('Failed to fetch profiles');
        setProfiles(data.profiles || []);
      } catch (err) {
        console.error('Failed to load profiles:', err);
        setError('Failed to load existing profiles');
      } finally {
        setIsLoading(false);
      }
    }
    fetchProfiles();
  }, []);

  const handleLinkProfile = async () => {
    if (!selectedProfileId) return;

    setIsLinking(true);
    setError(null);

    try {
      const { ok: resOk, data } = await requestEnvelope('/api/auth/link-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          profileId: selectedProfileId,
        },
        tolerantBody: true,
      });

      if (!resOk) {
        throw new Error(data.error || 'Failed to link profile');
      }

      // Force a page reload to refresh the session with the new profile
      window.location.reload();
    } catch (err) {
      setError(err.message);
      setIsLinking(false);
    }
  };

  const handleCreateNew = async () => {
    setIsLinking(true);
    setError(null);

    try {
      const { ok: resOk, data } = await requestEnvelope('/api/auth/link-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          createNew: true,
        },
        tolerantBody: true,
      });

      if (!resOk) {
        throw new Error(data.error || 'Failed to create profile');
      }

      // Force a page reload to refresh the session
      window.location.reload();
    } catch (err) {
      setError(err.message);
      setIsLinking(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-indigo-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Welcome, {session.user.name}!
          </h1>
          <p className="text-gray-600">
            This is your first time signing in. Please link your Microsoft account to an existing profile or create a new one.
          </p>
        </div>

        {/* Signed in as */}
        <div className="bg-gray-50 rounded-lg px-4 py-3 mb-6">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
            Signed in as
          </div>
          <div className="text-sm font-medium text-gray-900">
            {session.user.email}
          </div>
        </div>

        {/* Profile Selection */}
        {isLoading ? (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-4 border-gray-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-600 text-sm">Loading profiles...</p>
          </div>
        ) : profiles.length > 0 ? (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select your existing profile:
              </label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {profiles.map((profile) => (
                  <label
                    key={profile.id}
                    className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-all ${
                      selectedProfileId === profile.id
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="profile"
                      value={profile.id}
                      checked={selectedProfileId === profile.id}
                      onChange={() => setSelectedProfileId(profile.id)}
                      className="sr-only"
                    />
                    <div
                      className="w-8 h-8 rounded-full flex-shrink-0"
                      style={{ backgroundColor: profile.avatarColor || '#6366f1' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900">
                        {profile.displayName || profile.name}
                      </div>
                      {profile.isDefault && (
                        <div className="text-xs text-gray-500">Default profile</div>
                      )}
                    </div>
                    {selectedProfileId === profile.id && (
                      <svg className="w-5 h-5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </label>
                ))}
              </div>
            </div>

            {error && (
              <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={handleLinkProfile}
                disabled={!selectedProfileId || isLinking}
                className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
              >
                {isLinking ? 'Linking...' : 'Link to Selected Profile'}
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-500">or</span>
                </div>
              </div>

              <button
                onClick={handleCreateNew}
                disabled={isLinking}
                className="w-full px-4 py-3 border border-gray-300 hover:border-gray-400 text-gray-700 font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                Create New Profile
              </button>
            </div>
          </>
        ) : (
          <>
            {/* No existing profiles - just show create button */}
            <div className="text-center py-4 mb-4">
              <p className="text-gray-600">
                No existing profiles found. Click below to create your profile.
              </p>
            </div>

            {error && (
              <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              onClick={handleCreateNew}
              disabled={isLinking}
              className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors"
            >
              {isLinking ? 'Creating...' : 'Create My Profile'}
            </button>
          </>
        )}

        {/* Sign out option */}
        <div className="mt-6 pt-4 border-t border-gray-200 text-center">
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Sign in with a different account
          </button>
        </div>
      </div>
    </div>
  );
}
