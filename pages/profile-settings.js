/**
 * Profile Settings Page
 *
 * Self-service surface for the staff user's own linked profile. Each Entra
 * account links to exactly one profile via /api/auth/link-profile during
 * first-login; this page exposes display-name, avatar color, and archive on
 * that profile. Profile creation is intentionally not exposed here.
 */

import { useEffect, useRef, useState } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import { useProfile } from '../shared/context/ProfileContext';
import {
  PREFERENCE_KEYS,
  readEmailSignaturePreference,
  serializeEmailSignaturePreference,
} from '../shared/config/reviewerFinderPreferences';
import EmailTemplatesModal from '../shared/components/reviewers/EmailTemplatesModal';
import { TEMPLATE_TYPE_LABELS, TEMPLATE_TYPES } from '../shared/components/reviewers/email-template-store';

// Preset colors for avatar selection
const AVATAR_COLORS = [
  '#6366f1', // Indigo (default)
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#3b82f6', // Blue
  '#6b7280', // Gray
];

export default function ProfileSettings() {
  const {
    profiles,
    currentProfile,
    isLoading,
    updateProfile,
    archiveProfile,
    selectProfile,
    preferences,
    setPreference,
    deletePreference,
    status,
  } = useProfile();

  const [editingProfile, setEditingProfile] = useState(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileColor, setNewProfileColor] = useState(AVATAR_COLORS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signatureForm, setSignatureForm] = useState({ name: '', email: '', signature: '' });
  const [isSavingSignature, setIsSavingSignature] = useState(false);
  const [signatureStatus, setSignatureStatus] = useState(null);
  const [error, setError] = useState(null);
  const loadedSignatureSourceRef = useRef('');
  const emailSignaturePreference = preferences?.[PREFERENCE_KEYS.EMAIL_SIGNATURE] || '';
  const senderInfoPreference = preferences?.[PREFERENCE_KEYS.SENDER_INFO] || '';

  // Grantee-invitation custom email body (S272). Body-only — the server appends the
  // signature; the textarea must not contain one. Absent pref => the admin default.
  const [inviteBody, setInviteBody] = useState('');
  const [inviteDefault, setInviteDefault] = useState({
    body: '',
    loaded: false,
    unavailable: false,
  });
  const [isSavingInviteBody, setIsSavingInviteBody] = useState(false);
  const [inviteBodyStatus, setInviteBodyStatus] = useState(null);
  const loadedInviteBodySourceRef = useRef('');
  const inviteBodyDirtyRef = useRef(false);
  const inviteBodyPreference = preferences?.[PREFERENCE_KEYS.GRANTEE_INVITE_BODY] || '';

  // Reviewer email templates (the 6-type set sent from Workbench → Reviewers).
  // Edited in the shared EmailTemplatesModal, which loads/saves via the same
  // preference key the Workbench tab uses — so this is a second entry point to the
  // ONE editor, not a separate copy. Defaults are seeded by the modal itself.
  const [showReviewerTemplates, setShowReviewerTemplates] = useState(false);

  useEffect(() => {
    if (status !== 'ready') return;
    const sourceKey = [
      currentProfile?.id || '',
      emailSignaturePreference,
      senderInfoPreference,
    ].join('::');
    if (sourceKey === loadedSignatureSourceRef.current) return;
    const next = readEmailSignaturePreference({
      [PREFERENCE_KEYS.EMAIL_SIGNATURE]: emailSignaturePreference,
      [PREFERENCE_KEYS.SENDER_INFO]: senderInfoPreference,
    });
    setSignatureForm(prev => (
      prev.name === next.name && prev.email === next.email && prev.signature === next.signature
        ? prev
        : next
    ));
    setSignatureStatus(null);
    loadedSignatureSourceRef.current = sourceKey;
  }, [
    status,
    currentProfile?.id,
    emailSignaturePreference,
    senderInfoPreference,
  ]);

  useEffect(() => {
    if (status !== 'ready') return;
    if (!inviteDefault.loaded && !inviteBodyPreference.trim()) return;
    const sourceKey = [
      currentProfile?.id || '',
      inviteBodyPreference,
      inviteDefault.body,
      inviteDefault.loaded ? 'loaded' : 'pending',
      inviteDefault.unavailable ? 'unavailable' : 'available',
    ].join('::');
    if (sourceKey === loadedInviteBodySourceRef.current) return;
    const next = inviteBodyPreference.trim() ? inviteBodyPreference : inviteDefault.body;
    if (!inviteBodyDirtyRef.current) {
      setInviteBody((prev) => (prev === next ? prev : next));
      setInviteBodyStatus(null);
    }
    loadedInviteBodySourceRef.current = sourceKey;
  }, [
    status,
    currentProfile?.id,
    inviteBodyPreference,
    inviteDefault.body,
    inviteDefault.loaded,
    inviteDefault.unavailable,
  ]);

  useEffect(() => {
    if (status !== 'ready' || !currentProfile?.id) return;
    let cancelled = false;
    fetch('/api/email-defaults/grantee-invite')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load Request Abstract email default.');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setInviteDefault({
          body: String(data.body || ''),
          loaded: true,
          unavailable: Boolean(data.unavailable),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setInviteDefault({ body: '', loaded: true, unavailable: true });
      });
    return () => { cancelled = true; };
  }, [status, currentProfile?.id]);

  // Reset form when closing
  const resetForm = () => {
    setEditingProfile(null);
    setNewProfileName('');
    setNewProfileColor(AVATAR_COLORS[0]);
    setError(null);
  };

  // Handle edit profile
  const handleEdit = async (e) => {
    e.preventDefault();
    if (!editingProfile || !newProfileName.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await updateProfile(editingProfile.id, {
        name: newProfileName.trim(),
        displayName: newProfileName.trim(),
        avatarColor: newProfileColor
      });
      resetForm();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle archive profile
  const handleArchive = async (profile) => {
    if (!confirm(`Are you sure you want to archive "${profile.displayName || profile.name}"? This will hide the profile but preserve its data.`)) {
      return;
    }

    try {
      await archiveProfile(profile.id);
    } catch (err) {
      setError(err.message);
    }
  };

  // Handle set as default
  const handleSetDefault = async (profile) => {
    try {
      await updateProfile(profile.id, { isDefault: true });
    } catch (err) {
      setError(err.message);
    }
  };

  // Start editing a profile
  const startEdit = (profile) => {
    setEditingProfile(profile);
    setNewProfileName(profile.displayName || profile.name);
    setNewProfileColor(profile.avatarColor || AVATAR_COLORS[0]);
    setError(null);
  };

  const updateSignatureField = (field, value) => {
    setSignatureForm(prev => ({ ...prev, [field]: value }));
    setSignatureStatus(null);
  };

  const handleSaveSignature = async (e) => {
    e.preventDefault();
    if (!currentProfile) return;

    setIsSavingSignature(true);
    setError(null);
    setSignatureStatus(null);
    const ok = await setPreference(
      PREFERENCE_KEYS.EMAIL_SIGNATURE,
      serializeEmailSignaturePreference(signatureForm),
    );
    setIsSavingSignature(false);
    setSignatureStatus(ok ? 'saved' : 'error');
    if (!ok) setError('Failed to save email signature.');
  };

  const handleSaveInviteBody = async (e) => {
    e.preventDefault();
    if (!currentProfile) return;
    setIsSavingInviteBody(true);
    setError(null);
    setInviteBodyStatus(null);
    const ok = await setPreference(PREFERENCE_KEYS.GRANTEE_INVITE_BODY, inviteBody);
    setIsSavingInviteBody(false);
    setInviteBodyStatus(ok ? 'saved' : 'error');
    if (ok) inviteBodyDirtyRef.current = false;
    if (!ok) setError('Failed to save the Request Abstract email body.');
  };

  // Reset = DELETE the key so the body falls back to the canonical Foundation
  // default (and tracks future default changes), not a frozen literal.
  const handleResetInviteBody = async () => {
    if (!currentProfile) return;
    setIsSavingInviteBody(true);
    setError(null);
    setInviteBodyStatus(null);
    const ok = await deletePreference(PREFERENCE_KEYS.GRANTEE_INVITE_BODY);
    setIsSavingInviteBody(false);
    if (ok) {
      inviteBodyDirtyRef.current = false;
      setInviteBody(inviteDefault.body || '');
      setInviteBodyStatus('reset');
    } else {
      setInviteBodyStatus('error');
      setError('Failed to reset the Request Abstract email body.');
    }
  };

  if (isLoading) {
    return (
      <Layout title="Profile Settings" maxWidth="4xl">
        <PageHeader
          title="Profile Settings"
          subtitle="Manage your user profiles and preferences"
        />
        <div className="flex justify-center items-center py-12">
          <div className="text-gray-500">Loading...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Profile Settings" maxWidth="4xl">
      <PageHeader
        title="Profile Settings"
        subtitle="Manage your user profiles and preferences"
      />

      <div className="py-8 space-y-8">
        {/* Error Display */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* Current Profile Card */}
        {currentProfile && (
          <Card>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Profile</h2>
            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white text-xl font-semibold"
                style={{ backgroundColor: currentProfile.avatarColor }}
              >
                {(currentProfile.displayName || currentProfile.name || 'U')[0].toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="text-lg font-medium text-gray-900">
                  {currentProfile.displayName || currentProfile.name}
                </div>
                <div className="text-sm text-gray-500">
                  {currentProfile.isDefault && (
                    <span className="inline-flex items-center gap-1 text-indigo-600">
                      <span>Default profile</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Card>
        )}

        {currentProfile && (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Email Signature</h2>
              {signatureStatus === 'saved' && (
                <span className="text-sm text-green-700">Saved</span>
              )}
            </div>
            <form onSubmit={handleSaveSignature} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-gray-700">
                  Name
                  <input
                    type="text"
                    value={signatureForm.name}
                    onChange={(e) => updateSignatureField('name', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Email
                  <input
                    type="email"
                    value={signatureForm.email}
                    onChange={(e) => updateSignatureField('email', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </label>
              </div>
              <label className="block text-sm font-medium text-gray-700">
                Signature
                <textarea
                  value={signatureForm.signature}
                  onChange={(e) => updateSignatureField('signature', e.target.value)}
                  rows={6}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                />
              </label>
              {signatureStatus === 'error' && (
                <p className="text-sm text-red-700">Could not save the email signature.</p>
              )}
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  disabled={isSavingSignature}
                  loading={isSavingSignature}
                >
                  Save Email Signature
                </Button>
              </div>
            </form>
          </Card>
        )}

        {currentProfile && (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Request Abstract Email</h2>
              {inviteBodyStatus === 'saved' && <span className="text-sm text-green-700">Saved</span>}
              {inviteBodyStatus === 'reset' && <span className="text-sm text-green-700">Reset to default</span>}
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Your default body for the grantee abstract-review email (the Workbench
              Awardee tab). Do not include your name or signature — your saved Email
              Signature is appended automatically when you send. Keep the{' '}
              <code className="text-xs">[Name]</code>, <code className="text-xs">[title]</code>, and{' '}
              <code className="text-xs">COB [date]</code> placeholders; they’re filled in per-grantee.
            </p>
            <form onSubmit={handleSaveInviteBody} className="space-y-4">
              <label className="block text-sm font-medium text-gray-700">
                Email body
                <textarea
                  value={inviteBody}
                  onChange={(e) => {
                    inviteBodyDirtyRef.current = true;
                    setInviteBody(e.target.value);
                    setInviteBodyStatus(null);
                  }}
                  rows={14}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                />
              </label>
              {inviteDefault.loaded && inviteDefault.unavailable && (
                <p className="text-sm text-red-700">
                  The shared default is unavailable because settings read failed. Saved custom text can still be edited, but reset is disabled until the default loads.
                </p>
              )}
              {inviteDefault.loaded && !inviteDefault.unavailable && !inviteBodyPreference.trim() && inviteDefault.body.trim() === '' && (
                <p className="text-sm text-amber-700">
                  The shared default is blank - not configured.
                </p>
              )}
              {inviteBodyStatus === 'error' && (
                <p className="text-sm text-red-700">Could not save the Request Abstract email body.</p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={handleResetInviteBody}
                  disabled={isSavingInviteBody || !inviteDefault.loaded || inviteDefault.unavailable}
                >
                  Reset to default
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  disabled={isSavingInviteBody}
                  loading={isSavingInviteBody}
                >
                  Save Email Body
                </Button>
              </div>
            </form>
          </Card>
        )}

        {currentProfile && (
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Reviewer Emails</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Your templates for the emails sent to peer reviewers from the Workbench
              Reviewers tab. Everyone starts from a default; edits here are saved to your
              profile and used wherever you send. Your saved Email Signature fills the{' '}
              <code className="text-xs">{'{{signature}}'}</code> placeholder.
            </p>
            <ul className="text-sm text-gray-600 mb-4 flex flex-wrap gap-x-4 gap-y-1">
              {TEMPLATE_TYPES.map((t) => (
                <li key={t} className="text-gray-700">• {TEMPLATE_TYPE_LABELS[t] || t}</li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button variant="primary" size="sm" type="button" onClick={() => setShowReviewerTemplates(true)}>
                Edit reviewer email templates
              </Button>
            </div>
          </Card>
        )}

        {/* All Profiles Section */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">All Profiles</h2>
          </div>

          {/* Edit Form */}
          {editingProfile && (
            <form
              onSubmit={handleEdit}
              className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200"
            >
              <h3 className="text-sm font-semibold text-gray-800 mb-4">
                Edit Profile
              </h3>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Profile Name
                </label>
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Display name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  autoFocus
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Color
                </label>
                <div className="flex gap-2 flex-wrap">
                  {AVATAR_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewProfileColor(color)}
                      className={`w-8 h-8 rounded-full transition-all ${
                        newProfileColor === color
                          ? 'ring-2 ring-offset-2 ring-indigo-500 scale-110'
                          : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={resetForm}
                  type="button"
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  disabled={!newProfileName.trim() || isSubmitting}
                  loading={isSubmitting}
                >
                  Save Changes
                </Button>
              </div>
            </form>
          )}

          {/* Profile List */}
          <div className="space-y-2">
            {profiles.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No profile linked yet. Sign in with your WMKF account to provision one.
              </div>
            ) : (
              profiles.map((profile) => (
                <div
                  key={profile.id}
                  className={`flex items-center gap-4 p-4 rounded-lg border ${
                    currentProfile?.id === profile.id
                      ? 'border-indigo-200 bg-indigo-50'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white text-lg font-semibold"
                    style={{ backgroundColor: profile.avatarColor }}
                  >
                    {(profile.displayName || profile.name || 'U')[0].toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 truncate">
                        {profile.displayName || profile.name}
                      </span>
                      {profile.isDefault && (
                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                          Default
                        </span>
                      )}
                      {currentProfile?.id === profile.id && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      Last used: {new Date(profile.lastUsedAt).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {currentProfile?.id !== profile.id && (
                      <button
                        onClick={() => selectProfile(profile.id)}
                        className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        Switch
                      </button>
                    )}
                    {!profile.isDefault && (
                      <button
                        onClick={() => handleSetDefault(profile)}
                        className="text-sm text-gray-500 hover:text-gray-700"
                        title="Set as default"
                      >
                        Set Default
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(profile)}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Edit
                    </button>
                    {profiles.length > 1 && (
                      <button
                        onClick={() => handleArchive(profile)}
                        className="text-sm text-red-500 hover:text-red-700"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Info Card */}
        <Card>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">About Profiles</h2>
          <div className="prose prose-sm text-gray-600">
            <p>
              Each WMKF Entra account links to a single profile, provisioned automatically
              on first sign-in. Your profile stores per-user state used by the apps:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Saved reviewer candidates and proposal-search history</li>
              <li>Per-app preferences (model overrides, UI settings)</li>
              <li>Display name and avatar color</li>
            </ul>
            <p className="mt-3">
              <strong>Note:</strong> External API credentials (Claude, ORCID, NCBI, SerpAPI) are
              centralized server-side — they are not stored per profile. Researchers and grant
              cycles are shared across all profiles to maintain a unified database of experts.
            </p>
          </div>
        </Card>
      </div>
      {showReviewerTemplates && (
        <EmailTemplatesModal onClose={() => setShowReviewerTemplates(false)} />
      )}
    </Layout>
  );
}
