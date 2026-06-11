/**
 * SettingsModal - Global settings for Reviewer Finder
 *
 * Accessible via gear icon, contains:
 * - Email template configuration
 * - Grant cycle settings (including summary page extraction config)
 * - Sender information
 *
 * Settings are stored per-user in the database when a profile is selected,
 * with fallback to localStorage when no profile is active.
 */

import { useState, useEffect, useRef } from 'react';
import { upload } from '@vercel/blob/client';
import { CYCLE_MATERIAL_PREFIX } from '../../lib/utils/cycle-material-ref';
import EmailTemplateEditor from './EmailTemplateEditor';
import { STORAGE_KEYS } from './EmailSettingsPanel';
import { useProfile } from '../context/ProfileContext';
import {
  PREFERENCE_KEYS,
  STORAGE_KEYS as RF_STORAGE_KEYS,
  resolveStoredCycle,
  formatCycleForStorage,
} from '../config/reviewerFinderPreferences';

// Phase 1 private-blob migration of grant-cycle materials (review template +
// additional attachments). Behind a flag (default public) until smoked. When on,
// uploads go to the dedicated private store under the CYCLE_MATERIAL_PREFIX, and we
// persist the blob PATHNAME (not a public URL) so the prefix-based classifier
// (lib/utils/cycle-material-ref.js) routes every server-read + the download proxy.
function cycleMaterialUpload(filename) {
  const usePrivate = process.env.NEXT_PUBLIC_REVIEWER_FINDER_PRIVATE_CYCLE_MATERIALS === 'true';
  return {
    usePrivate,
    access: usePrivate ? 'private' : 'public',
    uploadPath: usePrivate ? `${CYCLE_MATERIAL_PREFIX}${filename}` : filename,
  };
}

// Default grant cycle settings
const DEFAULT_GRANT_CYCLE = {
  programName: 'W. M. Keck Foundation',
  reviewDeadline: '',
  summaryPages: '2', // Default to page 2 for Keck proposals
  reviewTemplateBlobUrl: '', // URL to uploaded review template file
  reviewTemplateFilename: '', // Original filename
  additionalAttachments: [], // Array of {blobUrl, filename, contentType}
  customFields: {
    proposalDueDate: '',
    // honorarium removed S199 — now a single Dataverse ground-truth
    // (honorarium.default_amount) read server-side, not a per-user preference.
    proposalSendDate: '',
    commitDate: ''
  }
};

// Default sender settings
const DEFAULT_SENDER = {
  name: '',
  email: '',
  signature: ''
};

// Storage key for current cycle ID (legacy)
const CURRENT_CYCLE_KEY = 'reviewer_finder_current_cycle';

export default function SettingsModal({ isOpen, onClose, onCycleChange }) {
  const { status, currentProfile, preferences, setPreference } = useProfile();

  const [activeSection, setActiveSection] = useState('sender');
  const [grantCycle, setGrantCycle] = useState(DEFAULT_GRANT_CYCLE);
  const [sender, setSender] = useState(DEFAULT_SENDER);
  const [saveStatus, setSaveStatus] = useState(null);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [uploadingAdditional, setUploadingAdditional] = useState(false);

  // Grant cycles management state
  const [cycles, setCycles] = useState([]);
  const [cyclesLoading, setCyclesLoading] = useState(false);
  const [currentCycleId, setCurrentCycleId] = useState(null);
  const [editingCycle, setEditingCycle] = useState(null); // null = not editing, {} = new cycle
  const [cycleFormData, setCycleFormData] = useState({});
  const [savingCycle, setSavingCycle] = useState(false);

  // Reload when opened OR when the profile/preferences session is ready.
  // ProfileContext guarantees that once status is 'ready', the currentProfile
  // and preferences are atomically aligned.
  useEffect(() => {
    if (!isOpen) return;
    if (status !== 'ready') return;
    
    loadSettings();
    loadCycles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, status, currentProfile?.id, preferences[PREFERENCE_KEYS.GRANT_CYCLE_SETTINGS], preferences[PREFERENCE_KEYS.SENDER_INFO], preferences[PREFERENCE_KEYS.CURRENT_CYCLE_ID]]);

  // Normalize the stored cycle preference once cycles are loaded.
  useEffect(() => {
    if (!currentCycleId || cycles.length === 0) return;

    const { cycle, needsWriteback } = resolveStoredCycle(currentCycleId, cycles);

    if (!cycle) {
      // Neither shape resolved — clear stale value from both backends.
      setCurrentCycleId(null);
      if (currentProfile) {
        setPreference(PREFERENCE_KEYS.CURRENT_CYCLE_ID, '').catch(() => {});
      }
      // Always purge localStorage stale value on both paths.
      localStorage.removeItem(CURRENT_CYCLE_KEY);
      return;
    }

    const shortcode = formatCycleForStorage(cycle);
    if (currentCycleId === shortcode) return; // already normalized

    setCurrentCycleId(shortcode);
    if (needsWriteback) {
      // Legacy integer was the stored shape — rewrite as shortcode.
      if (currentProfile) {
        setPreference(PREFERENCE_KEYS.CURRENT_CYCLE_ID, shortcode).catch(() => {});
      } else {
        localStorage.setItem(CURRENT_CYCLE_KEY, shortcode);
      }
    }
  }, [cycles, currentCycleId, currentProfile, setPreference]);

  const loadSettings = () => {
    try {
      let loadedGrantCycle = DEFAULT_GRANT_CYCLE;
      let loadedSender = DEFAULT_SENDER;
      let loadedCycleId = null;

      // 1. Try Profile preferences
      if (currentProfile) {
        if (preferences[PREFERENCE_KEYS.GRANT_CYCLE_SETTINGS]) {
          try {
            const decoded = JSON.parse(preferences[PREFERENCE_KEYS.GRANT_CYCLE_SETTINGS]);
            loadedGrantCycle = { ...DEFAULT_GRANT_CYCLE, ...decoded };
          } catch (e) {
            console.warn('Failed to parse grant cycle from profile:', e);
          }
        }

        if (preferences[PREFERENCE_KEYS.SENDER_INFO]) {
          try {
            const decoded = JSON.parse(preferences[PREFERENCE_KEYS.SENDER_INFO]);
            loadedSender = { ...DEFAULT_SENDER, ...decoded };
          } catch (e) {
            console.warn('Failed to parse sender info from profile:', e);
          }
        }

        if (preferences[PREFERENCE_KEYS.CURRENT_CYCLE_ID]) {
          loadedCycleId = String(preferences[PREFERENCE_KEYS.CURRENT_CYCLE_ID]);
        }
      }

      // 2. Fallback to localStorage ONLY if no profile is active.
      if (!currentProfile) {
        const storedCycle = localStorage.getItem(STORAGE_KEYS.GRANT_CYCLE);
        if (storedCycle) {
          const decoded = JSON.parse(atob(storedCycle));
          loadedGrantCycle = { ...DEFAULT_GRANT_CYCLE, ...decoded };
        }

        const storedSender = localStorage.getItem(STORAGE_KEYS.SENDER_INFO);
        if (storedSender) {
          const decoded = JSON.parse(atob(storedSender));
          loadedSender = { ...DEFAULT_SENDER, ...decoded };
        }

        const storedCycleId = localStorage.getItem(CURRENT_CYCLE_KEY);
        if (storedCycleId) {
          loadedCycleId = String(storedCycleId);
        }
      }

      setGrantCycle(loadedGrantCycle);
      setSender(loadedSender);
      setCurrentCycleId(loadedCycleId);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  // Fetch grant cycles from API
  const loadCycles = async () => {
    setCyclesLoading(true);
    try {
      const response = await fetch('/api/reviewer-finder/grant-cycles?includeArchived=true');
      if (response.ok) {
        const data = await response.json();
        setCycles(data.cycles || []);
      }
    } catch (error) {
      console.error('Failed to load grant cycles:', error);
    } finally {
      setCyclesLoading(false);
    }
  };

  // Create or update a grant cycle
  const saveCycleToApi = async () => {
    setSavingCycle(true);
    try {
      const isNew = !cycleFormData.id;
      const method = isNew ? 'POST' : 'PATCH';

      const response = await fetch('/api/reviewer-finder/grant-cycles', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cycleFormData),
      });

      if (response.ok) {
        const data = await response.json();
        await loadCycles();
        setEditingCycle(null);
        setCycleFormData({});

        // If this was a new cycle and there's no current cycle set, make it current
        if (isNew && !currentCycleId && data.cycle?.shortCode) {
          handleSetCurrentCycle(data.cycle.shortCode);
        }
      } else {
        const error = await response.json();
        alert(`Failed to save cycle: ${error.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to save cycle:', error);
      alert('Failed to save cycle. Please try again.');
    } finally {
      setSavingCycle(false);
    }
  };

  // Archive a grant cycle
  const archiveCycle = async (cycleId) => {
    if (!confirm('Archive this grant cycle? It will be hidden from the cycle selector but data will be preserved.')) {
      return;
    }

    try {
      const response = await fetch('/api/reviewer-finder/grant-cycles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cycleId }),
      });

      if (response.ok) {
        // The cycle being archived may have been the current one; resolve by id
        // against the still-loaded `cycles` list before clearing, since
        // `currentCycleId` is now a shortcode and the caller passed an id.
        const archivedCycle = cycles.find(c => c.id === cycleId);
        await loadCycles();
        if (archivedCycle && currentCycleId === archivedCycle.shortCode) {
          handleSetCurrentCycle(null);
        }
      }
    } catch (error) {
      console.error('Failed to archive cycle:', error);
    }
  };

  // Set current cycle. The `cycleShortCode` argument is now a shortcode string
  // (e.g. "J26") — never a Postgres integer ID. See plan §"Rollout-safety
  // policy for the preference-shape migration" for the broader contract.
  const handleSetCurrentCycle = async (cycleShortCode) => {
    const value = cycleShortCode || null;
    setCurrentCycleId(value);

    // Save to profile if available, otherwise localStorage.
    // Always write shortcode (never integer ID) — Codex S147 writer policy.
    if (currentProfile) {
      await setPreference(PREFERENCE_KEYS.CURRENT_CYCLE_ID, value || '');
      if (!value) {
        localStorage.removeItem(CURRENT_CYCLE_KEY);
      }
    } else {
      if (value) {
        localStorage.setItem(CURRENT_CYCLE_KEY, value);
      } else {
        localStorage.removeItem(CURRENT_CYCLE_KEY);
      }
    }

    // Notify parent component
    if (onCycleChange) {
      onCycleChange(value);
    }
  };

  // Generate short code from date
  const generateShortCode = (month, year) => {
    const monthLetter = month === 'june' ? 'J' : 'D';
    const yearShort = year.toString().slice(-2);
    return `${monthLetter}${yearShort}`;
  };

  // Quick create a cycle for June or December
  const quickCreateCycle = (month) => {
    const now = new Date();
    let year = now.getFullYear();
    const currentMonth = now.getMonth();

    // If we're past the month, use next year
    if (month === 'june' && currentMonth > 5) {
      year += 1;
    } else if (month === 'december' && currentMonth > 11) {
      year += 1;
    }

    const shortCode = generateShortCode(month, year);
    const fullName = `${month === 'june' ? 'June' : 'December'} ${year}`;

    setCycleFormData({
      name: fullName,
      shortCode,
      programName: grantCycle.programName || 'W. M. Keck Foundation',
      reviewDeadline: '',
      summaryPages: '2',
    });
    setEditingCycle({});
  };

  const saveSettings = async () => {
    try {
      if (currentProfile) {
        // Save to profile preferences
        await setPreference(PREFERENCE_KEYS.GRANT_CYCLE_SETTINGS, JSON.stringify(grantCycle));
        await setPreference(PREFERENCE_KEYS.SENDER_INFO, JSON.stringify(sender));
      } else {
        // Fallback to localStorage
        localStorage.setItem(STORAGE_KEYS.GRANT_CYCLE, btoa(JSON.stringify(grantCycle)));
        localStorage.setItem(STORAGE_KEYS.SENDER_INFO, btoa(JSON.stringify(sender)));
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveStatus('error');
    }
  };

  const updateGrantCycle = (field, value) => {
    setGrantCycle(prev => ({ ...prev, [field]: value }));
    setSaveStatus(null);
  };

  const updateCustomField = (field, value) => {
    setGrantCycle(prev => ({
      ...prev,
      customFields: { ...prev.customFields, [field]: value }
    }));
    setSaveStatus(null);
  };

  const updateSender = (field, value) => {
    setSender(prev => ({ ...prev, [field]: value }));
    setSaveStatus(null);
  };

  // Handle review template upload
  const handleTemplateUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!validTypes.includes(file.type)) {
      alert('Please upload a PDF or Word document (.pdf, .doc, .docx)');
      return;
    }

    setUploadingTemplate(true);
    try {
      // Upload to Vercel Blob via the client-token flow (/api/upload-handler).
      // Flag-gated private mode (Phase 1): private uploads land in the dedicated
      // store under the cycle-materials/ prefix and persist the PATHNAME; public
      // (default) persists the public URL, unchanged.
      const { usePrivate, access, uploadPath } = cycleMaterialUpload(file.name);
      const blob = await upload(uploadPath, file, {
        access,
        clientPayload: JSON.stringify({ access }),
        handleUploadUrl: '/api/upload-handler',
      });

      // Store the private pathname (classifier reads the cycle-materials/ prefix)
      // or the legacy public URL.
      setGrantCycle(prev => ({
        ...prev,
        reviewTemplateBlobUrl: usePrivate ? blob.pathname : blob.url,
        reviewTemplateFilename: file.name
      }));
      setSaveStatus(null);
    } catch (error) {
      console.error('Template upload failed:', error);
      alert('Failed to upload template. Please try again.');
    } finally {
      setUploadingTemplate(false);
    }
  };

  // Handle review template removal
  const handleRemoveTemplate = () => {
    setGrantCycle(prev => ({
      ...prev,
      reviewTemplateBlobUrl: '',
      reviewTemplateFilename: ''
    }));
    setSaveStatus(null);
  };

  // Handle additional attachment upload
  const handleAdditionalUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAdditional(true);
    try {
      // Upload to Vercel Blob via the client-token flow (/api/upload-handler).
      // Flag-gated private mode (Phase 1) — see handleTemplateUpload.
      const { usePrivate, access, uploadPath } = cycleMaterialUpload(file.name);
      const blob = await upload(uploadPath, file, {
        access,
        clientPayload: JSON.stringify({ access }),
        handleUploadUrl: '/api/upload-handler',
      });

      // Private attachment → { pathname, access }; legacy public → { blobUrl }.
      // The cycle-materials/ prefix on the pathname is the classifier every reader uses.
      const attachment = usePrivate
        ? {
            pathname: blob.pathname,
            access: 'private',
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
          }
        : {
            blobUrl: blob.url,
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
          };
      setGrantCycle(prev => ({
        ...prev,
        additionalAttachments: [
          ...(prev.additionalAttachments || []),
          attachment,
        ]
      }));
      setSaveStatus(null);
    } catch (error) {
      console.error('Additional attachment upload failed:', error);
      alert('Failed to upload file. Please try again.');
    } finally {
      setUploadingAdditional(false);
      // Reset the input so the same file can be uploaded again if needed
      e.target.value = '';
    }
  };

  // Handle additional attachment removal
  const handleRemoveAdditional = (index) => {
    setGrantCycle(prev => ({
      ...prev,
      additionalAttachments: prev.additionalAttachments.filter((_, i) => i !== index)
    }));
    setSaveStatus(null);
  };

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sections = [
    { id: 'sender', label: 'Sender Info', icon: '👤' },
    { id: 'cycles', label: 'Grant Cycles', icon: '📆' },
    { id: 'grant-cycle', label: 'Cycle Settings', icon: '📅' },
    { id: 'template', label: 'Email Template', icon: '✉️' },
    { id: 'attachments', label: 'Attachments', icon: '📎' },
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚙️</span>
              <h2 className="text-xl font-semibold text-gray-900">Settings</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex h-[calc(90vh-140px)]">
            {/* Sidebar */}
            <div className="w-48 border-r border-gray-200 bg-gray-50">
              <nav className="p-2 space-y-1">
                {sections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`
                      w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg
                      ${activeSection === section.id
                        ? 'bg-blue-100 text-blue-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100'
                      }
                    `}
                  >
                    <span>{section.icon}</span>
                    <span>{section.label}</span>
                  </button>
                ))}
              </nav>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Grant Cycles Management Section */}
              {activeSection === 'cycles' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Grant Cycles</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Manage your grant review cycles. Each cycle can have its own settings and proposals.
                    </p>
                  </div>

                  {/* Current Cycle Selector */}
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <label className="block text-sm font-medium text-blue-800 mb-2">
                      Current Cycle (for new proposals)
                    </label>
                    <select
                      value={currentCycleId || ''}
                      onChange={(e) => handleSetCurrentCycle(e.target.value || null)}
                      className="w-full px-3 py-2 border border-blue-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- No cycle selected --</option>
                      {cycles.filter(c => c.isActive && c.shortCode).map(cycle => (
                        <option key={cycle.id} value={cycle.shortCode}>
                          {cycle.shortCode} - {cycle.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-blue-600 mt-1">
                      New proposals will be automatically assigned to this cycle.
                    </p>
                  </div>

                  {/* Quick Create Buttons */}
                  {!editingCycle && (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-600">Quick create:</span>
                      <button
                        onClick={() => quickCreateCycle('june')}
                        className="px-3 py-1.5 bg-green-100 text-green-700 text-sm rounded-lg hover:bg-green-200"
                      >
                        June Cycle
                      </button>
                      <button
                        onClick={() => quickCreateCycle('december')}
                        className="px-3 py-1.5 bg-purple-100 text-purple-700 text-sm rounded-lg hover:bg-purple-200"
                      >
                        December Cycle
                      </button>
                      <button
                        onClick={() => {
                          setCycleFormData({});
                          setEditingCycle({});
                        }}
                        className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200"
                      >
                        Custom...
                      </button>
                    </div>
                  )}

                  {/* Cycle Edit Form */}
                  {editingCycle !== null && (
                    <div className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                      <h4 className="text-sm font-medium text-gray-700 mb-4">
                        {cycleFormData.id ? 'Edit Cycle' : 'Create New Cycle'}
                      </h4>
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Cycle Name *</label>
                          <input
                            type="text"
                            value={cycleFormData.name || ''}
                            onChange={(e) => setCycleFormData(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="June 2026"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Short Code</label>
                          <input
                            type="text"
                            value={cycleFormData.shortCode || ''}
                            onChange={(e) => setCycleFormData(prev => ({ ...prev, shortCode: e.target.value }))}
                            placeholder="J26"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Program Name</label>
                          <input
                            type="text"
                            value={cycleFormData.programName || ''}
                            onChange={(e) => setCycleFormData(prev => ({ ...prev, programName: e.target.value }))}
                            placeholder="W. M. Keck Foundation"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">Review Deadline</label>
                          <input
                            type="date"
                            value={cycleFormData.reviewDeadline || ''}
                            onChange={(e) => setCycleFormData(prev => ({ ...prev, reviewDeadline: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={saveCycleToApi}
                          disabled={!cycleFormData.name || savingCycle}
                          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {savingCycle ? 'Saving...' : (cycleFormData.id ? 'Update' : 'Create')}
                        </button>
                        <button
                          onClick={() => {
                            setEditingCycle(null);
                            setCycleFormData({});
                          }}
                          className="px-4 py-2 text-gray-600 text-sm hover:text-gray-800"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Cycles List */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-3">
                      {cyclesLoading ? 'Loading cycles...' : `All Cycles (${cycles.length})`}
                    </h4>
                    {cycles.length === 0 && !cyclesLoading ? (
                      <p className="text-sm text-gray-500 italic">No cycles created yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {cycles.map(cycle => (
                          <div
                            key={cycle.id}
                            className={`
                              flex items-center justify-between p-3 rounded-lg border
                              ${cycle.isActive ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-60'}
                              ${currentCycleId === cycle.shortCode ? 'ring-2 ring-blue-300' : ''}
                            `}
                          >
                            <div className="flex items-center gap-3">
                              {cycle.shortCode && (
                                <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs font-mono rounded">
                                  {cycle.shortCode}
                                </span>
                              )}
                              <div>
                                <div className="text-sm font-medium text-gray-800">
                                  {cycle.name}
                                  {currentCycleId === cycle.shortCode && (
                                    <span className="ml-2 text-xs text-blue-600">(current)</span>
                                  )}
                                  {!cycle.isActive && (
                                    <span className="ml-2 text-xs text-gray-400">(archived)</span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {cycle.proposalCount} proposals, {cycle.candidateCount} candidates
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {cycle.isActive && cycle.shortCode && currentCycleId !== cycle.shortCode && (
                                <button
                                  onClick={() => handleSetCurrentCycle(cycle.shortCode)}
                                  className="text-xs text-blue-600 hover:text-blue-800"
                                >
                                  Set Current
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  setCycleFormData({
                                    id: cycle.id,
                                    name: cycle.name,
                                    shortCode: cycle.shortCode || '',
                                    programName: cycle.programName || '',
                                    reviewDeadline: cycle.reviewDeadline || '',
                                    summaryPages: cycle.summaryPages || '2',
                                  });
                                  setEditingCycle(cycle);
                                }}
                                className="text-xs text-gray-600 hover:text-gray-800"
                              >
                                Edit
                              </button>
                              {cycle.isActive && (
                                <button
                                  onClick={() => archiveCycle(cycle.id)}
                                  className="text-xs text-red-600 hover:text-red-800"
                                >
                                  Archive
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Grant Cycle Section (legacy settings) */}
              {activeSection === 'grant-cycle' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Grant Cycle Settings</h3>
                    <p className="text-sm text-gray-500 mb-6">
                      Configure settings for the current grant review cycle. These values are used in email templates.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Program Name
                      </label>
                      <input
                        type="text"
                        value={grantCycle.programName}
                        onChange={(e) => updateGrantCycle('programName', e.target.value)}
                        placeholder="W. M. Keck Foundation"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Review Deadline
                      </label>
                      <input
                        type="date"
                        value={grantCycle.reviewDeadline}
                        onChange={(e) => updateGrantCycle('reviewDeadline', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Summary Page Extraction */}
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <label className="block text-sm font-medium text-blue-800 mb-1">
                      Summary Page(s) to Extract
                    </label>
                    <p className="text-xs text-blue-600 mb-2">
                      Which page(s) from uploaded proposals should be extracted as the one-page summary for email attachments?
                    </p>
                    <input
                      type="text"
                      value={grantCycle.summaryPages}
                      onChange={(e) => updateGrantCycle('summaryPages', e.target.value)}
                      placeholder="2"
                      className="w-32 px-3 py-2 border border-blue-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Examples: "2" for page 2, "1,2" for pages 1 and 2, "2-4" for pages 2 through 4
                    </p>
                  </div>

                  {/* Custom Date Fields */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Custom Date Fields</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          Proposal Due Date
                        </label>
                        <input
                          type="date"
                          value={grantCycle.customFields.proposalDueDate}
                          onChange={(e) => updateCustomField('proposalDueDate', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          Proposal Send Date
                        </label>
                        <input
                          type="date"
                          value={grantCycle.customFields.proposalSendDate}
                          onChange={(e) => updateCustomField('proposalSendDate', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          Reviewer Commit Date
                        </label>
                        <input
                          type="date"
                          value={grantCycle.customFields.commitDate}
                          onChange={(e) => updateCustomField('commitDate', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      {/* Honorarium Amount input removed S199 — the amount is now
                          a single admin-managed Dataverse setting
                          (honorarium.default_amount), not a per-user preference. */}
                    </div>
                  </div>
                </div>
              )}

              {/* Attachments Section */}
              {activeSection === 'attachments' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Email Attachments</h3>
                    <p className="text-sm text-gray-500 mb-6">
                      Configure files to attach to reviewer invitation emails. The project summary is automatically
                      extracted from uploaded proposals based on the Summary Pages setting.
                    </p>
                  </div>

                  {/* Review Template Upload */}
                  <div className="p-4 border border-gray-200 rounded-lg">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Review Template</h4>
                    <p className="text-xs text-gray-500 mb-3">
                      Upload a review template (PDF or Word document) that will be attached to all invitation emails.
                    </p>

                    {grantCycle.reviewTemplateBlobUrl ? (
                      <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="text-green-600">📄</span>
                          <span className="text-sm text-green-800">
                            {grantCycle.reviewTemplateFilename || 'Review_Template.pdf'}
                          </span>
                        </div>
                        <button
                          onClick={handleRemoveTemplate}
                          className="text-sm text-red-600 hover:text-red-800"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <label className="flex-1">
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx"
                            onChange={handleTemplateUpload}
                            className="hidden"
                          />
                          <div className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                            <span className="text-gray-400">📎</span>
                            <span className="text-sm text-gray-600">
                              {uploadingTemplate ? 'Uploading...' : 'Click to upload review template'}
                            </span>
                          </div>
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Project Summary Info */}
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <h4 className="text-sm font-medium text-blue-800 mb-2">Project Summary (Auto-extracted)</h4>
                    <p className="text-xs text-blue-600 mb-2">
                      The project summary is automatically extracted from each uploaded proposal based on the
                      "Summary Pages" setting in Grant Cycle. Currently set to extract page(s): <strong>{grantCycle.summaryPages || '2'}</strong>
                    </p>
                    <p className="text-xs text-gray-500">
                      To change which pages are extracted, go to the Grant Cycle section.
                    </p>
                  </div>

                  {/* Additional Attachments */}
                  <div className="p-4 border border-gray-200 rounded-lg">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Additional Attachments (Optional)</h4>
                    <p className="text-xs text-gray-500 mb-3">
                      Upload additional files to include with all invitation emails.
                    </p>

                    {/* List of uploaded additional attachments */}
                    {grantCycle.additionalAttachments?.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {grantCycle.additionalAttachments.map((attachment, index) => (
                          <div key={index} className="flex items-center justify-between p-2 bg-gray-50 border border-gray-200 rounded-lg">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">📄</span>
                              <span className="text-sm text-gray-700 truncate max-w-[200px]">
                                {attachment.filename}
                              </span>
                            </div>
                            <button
                              onClick={() => handleRemoveAdditional(index)}
                              className="text-sm text-red-600 hover:text-red-800"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Upload button */}
                    <label className="block">
                      <input
                        type="file"
                        onChange={handleAdditionalUpload}
                        className="hidden"
                        disabled={uploadingAdditional}
                      />
                      <div className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                        <span className="text-gray-400">+</span>
                        <span className="text-sm text-gray-600">
                          {uploadingAdditional ? 'Uploading...' : 'Add attachment'}
                        </span>
                      </div>
                    </label>
                  </div>

                  {/* Attachment Preview */}
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Attachments Preview</h4>
                    <p className="text-xs text-gray-500 mb-3">
                      Each generated email will include:
                    </p>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li className="flex items-center gap-2">
                        <span className={grantCycle.reviewTemplateBlobUrl ? 'text-green-500' : 'text-gray-300'}>
                          {grantCycle.reviewTemplateBlobUrl ? '✓' : '○'}
                        </span>
                        <span>Review_Template.{grantCycle.reviewTemplateFilename?.split('.').pop() || 'pdf'}</span>
                        {!grantCycle.reviewTemplateBlobUrl && (
                          <span className="text-xs text-gray-400">(not uploaded)</span>
                        )}
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-blue-500">○</span>
                        <span>Project_Summary.pdf</span>
                        <span className="text-xs text-gray-400">(per-proposal, auto-extracted)</span>
                      </li>
                      {grantCycle.additionalAttachments?.map((attachment, index) => (
                        <li key={index} className="flex items-center gap-2">
                          <span className="text-green-500">✓</span>
                          <span>{attachment.filename}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Sender Info Section */}
              {activeSection === 'sender' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Sender Information</h3>
                    <p className="text-sm text-gray-500 mb-6">
                      Your contact information for outgoing emails.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Your Name
                      </label>
                      <input
                        type="text"
                        value={sender.name}
                        onChange={(e) => updateSender('name', e.target.value)}
                        placeholder="John Smith"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Your Email
                      </label>
                      <input
                        type="email"
                        value={sender.email}
                        onChange={(e) => updateSender('email', e.target.value)}
                        placeholder="john.smith@example.org"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Email Signature
                      </label>
                      <textarea
                        value={sender.signature}
                        onChange={(e) => updateSender('signature', e.target.value)}
                        rows={4}
                        placeholder="Best regards,

John Smith
Senior Program Director | W. M. Keck Foundation"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Email Template Section */}
              {activeSection === 'template' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Email Template</h3>
                    <p className="text-sm text-gray-500 mb-6">
                      Customize the email template used for reviewer invitations.
                    </p>
                  </div>
                  <EmailTemplateEditor compact={false} />
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div>
              {saveStatus === 'saved' && (
                <span className="text-sm text-green-600">Settings saved</span>
              )}
              {saveStatus === 'error' && (
                <span className="text-sm text-red-600">Failed to save settings</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={saveSettings}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
