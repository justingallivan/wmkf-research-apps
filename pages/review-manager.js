import { useState, useEffect, useCallback } from 'react';
import Layout, { PageHeader, Card } from '../shared/components/Layout';
import HelpButton from '../shared/components/HelpButton';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import { useProfile } from '../shared/context/ProfileContext';
import ReviewerManagePanel, { StatusSummary } from '../shared/components/reviewers/ReviewerManagePanel';

// The reviewer-management substance (status pipeline, badges, email/upload
// modals, the reviewers table) lives in shared/components/reviewers/
// ReviewerManagePanel so the Request Workbench and this page render it
// identically. See docs/REQUEST_WORKBENCH_BUILD_PLAN.md § Phase 2.

// ─── Tab Component ──────────────────────────────────────────────────────────

function Tab({ label, active, onClick, icon, badge }) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 px-6 py-3 font-medium text-sm
        border-b-2 transition-all duration-200
        ${active
          ? 'border-gray-900 text-gray-900 bg-gray-50'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
        }
      `}
    >
      <span>{icon}</span>
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-gray-200 text-gray-700">{badge}</span>
      )}
    </button>
  );
}

// ─── Cycle Overview Tab ─────────────────────────────────────────────────────

function CycleOverviewTab({ proposals, cycles, selectedCycleCode, onCycleChange, onSelectProposal, loading }) {
  const filteredProposals = selectedCycleCode === 'all'
    ? proposals
    : proposals.filter(p => p.grantCycleCode === selectedCycleCode);

  return (
    <div className="space-y-4">
      {/* Cycle selector */}
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-gray-700">Grant Cycle</label>
        <select
          value={selectedCycleCode}
          onChange={e => onCycleChange(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-400 focus:border-transparent"
        >
          <option value="all">All Cycles</option>
          {cycles.filter(c => c.shortCode).map(c => (
            <option key={c.shortCode} value={c.shortCode}>{c.name} ({c.shortCode})</option>
          ))}
        </select>
        {loading && (
          <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
        )}
      </div>

      {/* Proposals table */}
      {filteredProposals.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg mb-2">No accepted reviewers found</p>
            <p className="text-gray-400 text-sm">
              Reviewers marked as &quot;accepted&quot; in the Reviewer Finder will appear here.
            </p>
          </div>
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Proposal</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PI</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cycle</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Reviewers</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProposals.map(p => (
                <tr key={p.proposalId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    {p.requestNumber && (
                      <p className="text-xs font-mono text-gray-400">#{p.requestNumber}</p>
                    )}
                    <p className="text-sm font-medium text-gray-900 line-clamp-2">{p.proposalTitle}</p>
                    {p.proposalInstitution && (
                      <p className="text-xs text-gray-500 mt-0.5">{p.proposalInstitution}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{p.proposalAuthors || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{p.grantCycleCode || '—'}</td>
                  <td className="px-4 py-3 text-center text-sm font-medium text-gray-900">{p.reviewers.length}</td>
                  <td className="px-4 py-3">
                    <StatusSummary statusSummary={p.statusSummary} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => onSelectProposal(p)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Proposal Detail Tab ────────────────────────────────────────────────────
// Thin wrapper around the shared ReviewerManagePanel: the proposal selector and
// the proposal info card are Review-Manager-specific (the Workbench supplies
// request context itself), so they stay here; the reviewer-management substance
// is the shared panel.

function ProposalDetailTab({ proposal, proposals, onProposalChange, onRefresh, settings }) {
  if (!proposal) {
    return (
      <Card>
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg mb-2">Select a proposal</p>
          <p className="text-gray-400 text-sm">
            Choose a proposal from the dropdown above or click &quot;Manage&quot; on the Overview tab.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Proposal Selector */}
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-gray-700">Proposal</label>
        <select
          value={proposal.proposalId}
          onChange={e => {
            const p = proposals.find(x => x.proposalId === e.target.value);
            if (p) onProposalChange(p);
          }}
          className="flex-1 max-w-xl px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-400 focus:border-transparent"
        >
          {proposals.map(p => (
            <option key={p.proposalId} value={p.proposalId}>
              {p.proposalTitle} ({p.reviewers.length} reviewer{p.reviewers.length !== 1 ? 's' : ''})
            </option>
          ))}
        </select>
      </div>

      {/* Proposal Info */}
      <Card>
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-gray-900">{proposal.proposalTitle}</h3>
            <p className="text-sm text-gray-600 mt-1">
              {proposal.proposalAuthors && <span>PI: {proposal.proposalAuthors}</span>}
              {proposal.proposalInstitution && <span> — {proposal.proposalInstitution}</span>}
            </p>
            {(proposal.cycleLabel || proposal.grantCycleCode) && (
              <p className="text-xs text-gray-500 mt-1">
                Cycle: {proposal.cycleLabel || proposal.grantCycleCode}
              </p>
            )}
          </div>
          <StatusSummary statusSummary={proposal.statusSummary} />
        </div>
      </Card>

      {/* Reviewer-management substance (shared with the Request Workbench) */}
      <ReviewerManagePanel
        proposal={proposal}
        reviewers={proposal.reviewers || []}
        onRefresh={onRefresh}
        settings={settings}
        canManage
      />
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

function ReviewManagerPage() {
  const { currentProfile } = useProfile();
  const profileId = currentProfile?.id || null;

  const [activeTab, setActiveTab] = useState('overview');
  const [proposals, setProposals] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [selectedCycleCode, setSelectedCycleCode] = useState('all');
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({ signature: '' });


  // Load settings from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('review_manager_settings');
      if (saved) setSettings(JSON.parse(saved));
    } catch (e) { /* ignore */ }
  }, []);

  // Load grant cycles
  useEffect(() => {
    const loadCycles = async () => {
      try {
        const res = await fetch('/api/reviewer-finder/grant-cycles');
        const data = await res.json();
        setCycles((data.cycles || []).filter(c => c.isActive !== false));
      } catch (err) {
        console.error('Failed to load grant cycles:', err);
      }
    };
    loadCycles();
  }, []);

  // Load reviewers
  const loadReviewers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCycleCode !== 'all') params.set('cycleCode', selectedCycleCode);

      const res = await fetch(`/api/review-manager/reviewers?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setProposals(data.proposals || []);
        // If we had a selected proposal, refresh it
        if (selectedProposal) {
          const updated = (data.proposals || []).find(p => p.proposalId === selectedProposal.proposalId);
          if (updated) setSelectedProposal(updated);
        }
      }
    } catch (err) {
      console.error('Failed to load reviewers:', err);
    } finally {
      setLoading(false);
    }
    // Granular selectedProposal?.proposalId dep is intentional — only the id is
    // read; depending on the whole object would rebuild on unrelated field changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCycleCode, profileId, selectedProposal?.proposalId]);

  // Reload reviewers only when the cycle filter changes. Adding loadReviewers
  // would also refetch on every proposal selection (its proposalId dep).
  useEffect(() => {
    loadReviewers();
  }, [selectedCycleCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = () => {
    loadReviewers();
  };

  const handleSelectProposal = (proposal) => {
    setSelectedProposal(proposal);
    setActiveTab('detail');
  };

  const handleSettingsChange = (key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem('review_manager_settings', JSON.stringify(next)); } catch (e) { /* ignore */ }
      return next;
    });
  };

  const totalReviewers = proposals.reduce((sum, p) => sum + p.reviewers.length, 0);

  return (
    <Layout title="Review Manager">
      <PageHeader title="Review Manager" icon="📋">
        <HelpButton appKey="review-manager" className="mt-3" />
      </PageHeader>

      <div className="py-8 space-y-6">
        {/* Settings bar */}
        <Card>
          <details className="group">
            <summary className="cursor-pointer flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Settings</span>
              <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Signature</label>
              <textarea
                value={settings.signature || ''}
                onChange={e => handleSettingsChange('signature', e.target.value)}
                placeholder="Your name and title"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-400 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-2">
                Emails are sent from your signed-in Microsoft account.
              </p>
            </div>
          </details>
        </Card>

        {/* Tab Navigation */}
        <div className="border-b border-gray-200">
          <div className="flex">
            <Tab
              label="Overview"
              icon="📊"
              active={activeTab === 'overview'}
              onClick={() => setActiveTab('overview')}
              badge={totalReviewers}
            />
            <Tab
              label="Proposal Detail"
              icon="📄"
              active={activeTab === 'detail'}
              onClick={() => setActiveTab('detail')}
            />
          </div>
        </div>

        {/* Tab Content */}
        <div className="min-h-[400px]">
          {activeTab === 'overview' && (
            <CycleOverviewTab
              proposals={proposals}
              cycles={cycles}
              selectedCycleCode={selectedCycleCode}
              onCycleChange={setSelectedCycleCode}
              onSelectProposal={handleSelectProposal}
              loading={loading}
            />
          )}
          {activeTab === 'detail' && (
            <ProposalDetailTab
              proposal={selectedProposal}
              proposals={proposals}
              onProposalChange={setSelectedProposal}
              onRefresh={handleRefresh}
              settings={settings}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}

export default function ReviewManagerGuard() {
  return (
    <RequireAppAccess appKey="review-manager">
      <ReviewManagerPage />
    </RequireAppAccess>
  );
}
