import { useState, useCallback, useMemo } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import FileUploaderSimple from '../shared/components/FileUploaderSimple';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ErrorAlert from '../shared/components/ErrorAlert';

const STATUS_OPTIONS = [
  { value: 'achieved', label: 'Achieved' },
  { value: 'partial', label: 'Partial' },
  { value: 'not_addressed', label: 'Not Addressed' },
  { value: 'pivoted', label: 'Pivoted' },
];

const RATING_OPTIONS = [
  { value: 'successful', label: 'Successful' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'unsuccessful', label: 'Unsuccessful' },
];

const CONFIDENCE_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

function ratingPillClasses(rating) {
  switch (rating) {
    case 'successful':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'mixed':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'unsuccessful':
      return 'bg-red-100 text-red-800 border-red-200';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200';
  }
}

function statusBadgeClasses(status) {
  switch (status) {
    case 'achieved':
      return 'bg-green-100 text-green-800';
    case 'partial':
      return 'bg-yellow-100 text-yellow-800';
    case 'not_addressed':
      return 'bg-red-100 text-red-800';
    case 'pivoted':
      return 'bg-blue-100 text-blue-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function GrantReporting() {
  // Step 1 — request lookup
  const [requestNumber, setRequestNumber] = useState('');
  const [lookup, setLookup] = useState(null);          // {found, requestId, header, documents, errors}
  const [isLookingUp, setIsLookingUp] = useState(false);

  // Document selection (per side: SharePoint pick or upload)
  const [proposalPick, setProposalPick] = useState(''); // SharePoint filename
  const [reportPick, setReportPick] = useState('');
  const [uploadedProposal, setUploadedProposal] = useState(null); // { url, filename }
  const [uploadedReport, setUploadedReport] = useState(null);
  const [showAllProposalFiles, setShowAllProposalFiles] = useState(false);
  const [showAllReportFiles, setShowAllReportFiles] = useState(false);

  // Step 3 — extracted data
  const [formData, setFormData] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [regeneratingField, setRegeneratingField] = useState(null);
  const [isRegeneratingGoals, setIsRegeneratingGoals] = useState(false);
  const [isGeneratingWord, setIsGeneratingWord] = useState(false);

  // ─── Computed FileRefs ────────────────────────────────────────────────────
  // Picks are stored as composite keys "library::folder::filename" so the same
  // name appearing in two different libraries (e.g. akoya_request and
  // RequestArchive3) or two different subfolders (e.g. Year 1/Report.docx vs
  // Year 2/Report.docx) can each be disambiguated by the dropdown.
  const findFileByKey = useCallback((key) => {
    if (!key || !lookup?.documents?.files) return null;
    return lookup.documents.files.find(f => `${f.library}::${f.folder}::${f.name}` === key) || null;
  }, [lookup]);

  const proposalRef = useMemo(() => {
    if (uploadedProposal) {
      return { source: 'upload', fileUrl: uploadedProposal.url, filename: uploadedProposal.filename };
    }
    const f = findFileByKey(proposalPick);
    if (f && f.library && f.folder) {
      return { source: 'sharepoint', library: f.library, folder: f.folder, filename: f.name };
    }
    return null;
  }, [uploadedProposal, proposalPick, findFileByKey]);

  const reportRef = useMemo(() => {
    if (uploadedReport) {
      return { source: 'upload', fileUrl: uploadedReport.url, filename: uploadedReport.filename };
    }
    const f = findFileByKey(reportPick);
    if (f && f.library && f.folder) {
      return { source: 'sharepoint', library: f.library, folder: f.folder, filename: f.name };
    }
    return null;
  }, [uploadedReport, reportPick, findFileByKey]);

  const canExtract = !!reportRef && !processing;

  // ─── Step 1: Lookup ───────────────────────────────────────────────────────
  const handleLookup = async () => {
    if (!requestNumber.trim()) {
      setError('Please enter a request number.');
      return;
    }
    setError(null);
    setIsLookingUp(true);
    setLookup(null);
    setProposalPick('');
    setReportPick('');
    setUploadedProposal(null);
    setUploadedReport(null);
    setFormData(null);

    try {
      const resp = await fetch('/api/grant-reporting/lookup-grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestNumber: requestNumber.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || `Lookup failed (${resp.status})`);
      }
      setLookup(data);
      if (data.documents?.proposalBestGuess) setProposalPick(data.documents.proposalBestGuess);
      if (data.documents?.reportBestGuess) setReportPick(data.documents.reportBestGuess);
    } catch (err) {
      setError(err.message || 'Lookup failed');
    } finally {
      setIsLookingUp(false);
    }
  };

  // ─── Step 2: Extract ──────────────────────────────────────────────────────
  const handleExtract = async () => {
    if (!reportRef) {
      setError('Please select or upload a grant report first.');
      return;
    }
    setProcessing(true);
    setError(null);
    try {
      const resp = await fetch('/api/grant-reporting/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'full',
          reportRef,
          proposalRef,
          headerFromDynamics: lookup?.header || {},
          requestGuid: lookup?.requestId || null,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const detail = data.details ? `: ${data.details}` : '';
        throw new Error(`${data.error || `Extraction failed (${resp.status})`}${detail}`);
      }

      // Defensive: re-apply Dynamics values so they always win on conflicts
      const mergedHeader = mergeHeaders(data.header, lookup?.header);

      setFormData({
        header: mergedHeader,
        counts: data.counts || {},
        narratives: data.narratives || {},
        goalsAssessment: data.goalsAssessment || null,
      });
    } catch (err) {
      setError(err.message || 'Extraction failed');
    } finally {
      setProcessing(false);
    }
  };

  // ─── Field regeneration ───────────────────────────────────────────────────
  const handleRegenerate = async (fieldKey) => {
    if (!reportRef || !formData) return;
    setRegeneratingField(fieldKey);
    setError(null);
    try {
      const resp = await fetch('/api/grant-reporting/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'regenerate',
          reportRef,
          fieldKey,
          currentValues: formData,
          requestGuid: lookup?.requestId || null,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const detail = data.details ? `: ${data.details}` : '';
        throw new Error(`${data.error || `Regeneration failed (${resp.status})`}${detail}`);
      }

      setFormData(prev => ({
        ...prev,
        narratives: { ...prev.narratives, [fieldKey]: data.value },
      }));
    } catch (err) {
      setError(err.message || 'Regeneration failed');
    } finally {
      setRegeneratingField(null);
    }
  };

  const handleRegenerateGoals = async () => {
    if (!reportRef || !proposalRef || !formData) return;
    setIsRegeneratingGoals(true);
    setError(null);
    try {
      const resp = await fetch('/api/grant-reporting/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'regenerate-goals',
          reportRef,
          proposalRef,
          headerFromDynamics: lookup?.header || {},
          currentValues: formData,
          requestGuid: lookup?.requestId || null,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const detail = data.details ? `: ${data.details}` : '';
        throw new Error(`${data.error || `Goals regeneration failed (${resp.status})`}${detail}`);
      }
      setFormData(prev => ({ ...prev, goalsAssessment: data.goalsAssessment }));
    } catch (err) {
      setError(err.message || 'Goals regeneration failed');
    } finally {
      setIsRegeneratingGoals(false);
    }
  };

  // ─── Word export ──────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!formData) return;
    setIsGeneratingWord(true);
    setError(null);
    try {
      const { generateGrantReportDocument } = await import('../shared/utils/grant-report-word-export');
      const blob = await generateGrantReportDocument(formData);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const baseName = (requestNumber || 'grant_report').replace(/\W+/g, '_');
      a.download = `${baseName}_Grant_Report.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Word export failed:', err);
      setError(`Word export failed: ${err.message}`);
    } finally {
      setIsGeneratingWord(false);
    }
  };

  // ─── Form mutators ────────────────────────────────────────────────────────
  const updateHeader = (key, value) => {
    setFormData(prev => ({ ...prev, header: { ...prev.header, [key]: value } }));
  };
  const updateCount = (key, value) => {
    const parsed = value === '' ? null : Number.parseInt(value, 10);
    setFormData(prev => ({
      ...prev,
      counts: { ...prev.counts, [key]: Number.isNaN(parsed) ? value : parsed },
    }));
  };
  const updateCountString = (key, value) => {
    setFormData(prev => ({ ...prev, counts: { ...prev.counts, [key]: value } }));
  };
  const updateNarrative = (key, value) => {
    setFormData(prev => ({ ...prev, narratives: { ...prev.narratives, [key]: value } }));
  };
  const updatePublication = (key, subKey, value) => {
    setFormData(prev => ({
      ...prev,
      narratives: {
        ...prev.narratives,
        [key]: { ...(prev.narratives[key] || {}), [subKey]: value },
      },
    }));
  };
  const updateGoals = (updater) => {
    setFormData(prev => ({ ...prev, goalsAssessment: updater(prev.goalsAssessment) }));
  };

  // ─── Document picker rendering ────────────────────────────────────────────
  const renderDocPicker = (which) => {
    const isProposal = which === 'proposal';
    const label = isProposal ? 'Original Proposal' : 'Grant Report';
    const targetClassification = isProposal ? 'proposal' : 'report';
    const pick = isProposal ? proposalPick : reportPick;
    const setPick = isProposal ? setProposalPick : setReportPick;
    const uploaded = isProposal ? uploadedProposal : uploadedReport;
    const setUploaded = isProposal ? setUploadedProposal : setUploadedReport;
    const showAll = isProposal ? showAllProposalFiles : showAllReportFiles;
    const setShowAll = isProposal ? setShowAllProposalFiles : setShowAllReportFiles;

    const allFiles = lookup?.documents?.files || [];
    const filtered = showAll
      ? allFiles
      : allFiles.filter(f => f.classification !== 'other' || f.classification === targetClassification);

    // Short label for each library so staff can tell at a glance where a file
    // lives. "Active" = the live akoya_request folder; "Archive 1/2/3" =
    // legacy migrated content.
    const libraryLabel = (lib) => {
      if (lib === 'akoya_request') return 'Active';
      const m = /^RequestArchive(\d+)$/i.exec(lib || '');
      if (m) return `Archive ${m[1]}`;
      return lib || '?';
    };

    return (
      <Card className="flex-1">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">{label}</h3>

        {lookup?.documents?.files?.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Pick from SharePoint
            </label>
            <select
              value={uploaded ? '' : pick}
              onChange={e => {
                setPick(e.target.value);
                if (e.target.value) setUploaded(null);
              }}
              disabled={!!uploaded}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100"
            >
              <option value="">— Select a file —</option>
              {filtered.map(f => {
                const key = `${f.library}::${f.folder}::${f.name}`;
                const star = f.classification === targetClassification ? '★ ' : '';
                const subPrefix = f.subfolder ? `${f.subfolder} / ` : '';
                return (
                  <option key={key} value={key}>
                    {star}[{libraryLabel(f.library)}] {subPrefix}{f.name}
                  </option>
                );
              })}
            </select>
            <label className="flex items-center gap-2 mt-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={showAll}
                onChange={e => setShowAll(e.target.checked)}
              />
              Show all files in folder ({allFiles.length} total)
            </label>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Or upload a file
          </label>
          <FileUploaderSimple
            onFilesUploaded={(files) => {
              if (files && files.length > 0) {
                setUploaded({ url: files[0].url, filename: files[0].filename });
                setPick('');
              }
            }}
            multiple={false}
            accept=".pdf,.docx,.doc"
            hideFileList={false}
          />
          {uploaded && (
            <p className="mt-2 text-sm text-green-700">
              Using upload: <span className="font-medium">{uploaded.filename}</span>
              <button
                type="button"
                onClick={() => setUploaded(null)}
                className="ml-2 text-xs text-gray-500 underline"
              >
                clear
              </button>
            </p>
          )}
        </div>
      </Card>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <Layout currentPage="/grant-reporting">
      <PageHeader
        icon="📊"
        title="Grant Reporting"
        subtitle="Extract grantee progress/final reports into an editable form, compare goals vs. achievements, and export a Word doc matching the Keck final report template."
      />

      {error && (
        <ErrorAlert error={error} onDismiss={() => setError(null)} />
      )}

      {/* ── Step 1: Request lookup ── */}
      <Card className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Step 1 — Request Lookup</h2>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Request Number
            </label>
            <input
              type="text"
              value={requestNumber}
              onChange={e => setRequestNumber(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleLookup(); }}
              placeholder="e.g. 1001289"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <Button
            variant="primary"
            onClick={handleLookup}
            loading={isLookingUp}
            disabled={isLookingUp}
          >
            Look up
          </Button>
        </div>

        {lookup && (
          <div className="mt-4 text-sm">
            {lookup.found ? (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800">
                ✓ Found: <strong>{lookup.header.title || '(untitled)'}</strong>
                {lookup.header.pis?.length > 0 && <> — {lookup.header.pis.join(', ')}</>}
              </div>
            ) : (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
                Could not find this request in Dynamics. You can still proceed by uploading both files directly.
                {lookup.errors?.dynamics && <div className="text-xs mt-1">{lookup.errors.dynamics}</div>}
              </div>
            )}
            {lookup.errors?.sharepoint && (
              <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-xs">
                SharePoint listing failed: {lookup.errors.sharepoint}. Use the upload pickers below.
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── Step 2: Document selection ── */}
      {(lookup || true) && (
        <Card className="mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Step 2 — Select Documents</h2>
          <div className="flex flex-col md:flex-row gap-4">
            {renderDocPicker('proposal')}
            {renderDocPicker('report')}
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              onClick={handleExtract}
              loading={processing}
              disabled={!canExtract}
            >
              Extract & Analyze
            </Button>
          </div>
          {!proposalRef && reportRef && (
            <p className="mt-2 text-xs text-gray-600 text-right">
              No original proposal selected — the goals assessment will be skipped.
            </p>
          )}
        </Card>
      )}

      {/* ── Step 3: Editable form ── */}
      {formData && (
        <div className="space-y-6">
          {/* Section 1 — Header */}
          <Card>
            <h2 className="text-xl font-bold text-gray-900 mb-4">Header</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <FormField label="Project Title">
                  <input
                    type="text"
                    value={formData.header.title || ''}
                    onChange={e => updateHeader('title', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </FormField>
              </div>
              <div className="md:col-span-2">
                <FormField label="PIs (comma-separated)">
                  <input
                    type="text"
                    value={(formData.header.pis || []).join(', ')}
                    onChange={e => updateHeader('pis', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </FormField>
              </div>
              <FormField label="Award Amount">
                <input
                  type="text"
                  value={formData.header.award_amount || ''}
                  onChange={e => updateHeader('award_amount', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </FormField>
              <FormField label="Project Time Period">
                <input
                  type="text"
                  value={formData.header.project_period || ''}
                  onChange={e => updateHeader('project_period', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </FormField>
              <FormField label="Subject Area">
                <input
                  type="text"
                  value={formData.header.subject_area || ''}
                  onChange={e => updateHeader('subject_area', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </FormField>
              <div className="md:col-span-2">
                <FormField label="Purpose of Grant">
                  <textarea
                    rows={2}
                    value={formData.header.purpose || ''}
                    onChange={e => updateHeader('purpose', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </FormField>
              </div>
              <div className="md:col-span-2">
                <FormField label="Proposal Abstract">
                  <textarea
                    rows={5}
                    value={formData.header.abstract || ''}
                    onChange={e => updateHeader('abstract', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </FormField>
              </div>
            </div>
          </Card>

          {/* Section 2 — Counts */}
          <Card>
            <h2 className="text-xl font-bold text-gray-900 mb-4">Personnel & Outputs</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                ['postdocs', 'Postdocs'],
                ['grad_students', 'Graduate Students'],
                ['undergrads', 'Undergraduate Students'],
                ['total_publications', 'Total Publications'],
                ['peer_reviewed_publications', 'Peer-Reviewed'],
                ['non_peer_reviewed_publications', 'Non-Peer-Reviewed'],
                ['patents_awarded', 'Patents Awarded'],
                ['patents_submitted', 'Patents Submitted'],
              ].map(([key, label]) => (
                <FormField key={key} label={label}>
                  <input
                    type="number"
                    value={formData.counts[key] ?? ''}
                    onChange={e => updateCount(key, e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </FormField>
              ))}
              <div className="md:col-span-3">
                <FormField label="Additional Funding Secured">
                  <textarea
                    rows={2}
                    value={formData.counts.additional_funding_secured || ''}
                    onChange={e => updateCountString('additional_funding_secured', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </FormField>
              </div>
            </div>
          </Card>

          {/* Section 3 — Narratives */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">Narratives</h2>
            </div>

            <NarrativeField
              label="Project Impacts"
              value={formData.narratives.project_impacts || ''}
              onChange={v => updateNarrative('project_impacts', v)}
              onRegenerate={() => handleRegenerate('project_impacts')}
              regenerating={regeneratingField === 'project_impacts'}
              rows={6}
            />

            <NarrativeField
              label="Awards and Honors"
              value={formData.narratives.awards_and_honors || ''}
              onChange={v => updateNarrative('awards_and_honors', v)}
              onRegenerate={() => handleRegenerate('awards_and_honors')}
              regenerating={regeneratingField === 'awards_and_honors'}
              rows={3}
            />

            <PublicationField
              label="Publication 1 (most significant)"
              pub={formData.narratives.publication_1}
              onChange={(subKey, value) => updatePublication('publication_1', subKey, value)}
              onRegenerate={() => handleRegenerate('publication_1')}
              regenerating={regeneratingField === 'publication_1'}
            />

            <PublicationField
              label="Publication 2"
              pub={formData.narratives.publication_2}
              onChange={(subKey, value) => updatePublication('publication_2', subKey, value)}
              onRegenerate={() => handleRegenerate('publication_2')}
              regenerating={regeneratingField === 'publication_2'}
            />

            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <NarrativeField
                label="Implications for Future Grantmaking [DRAFT — staff judgment]"
                value={formData.narratives.implications_for_future_grantmaking || ''}
                onChange={v => updateNarrative('implications_for_future_grantmaking', v)}
                onRegenerate={() => handleRegenerate('implications_for_future_grantmaking')}
                regenerating={regeneratingField === 'implications_for_future_grantmaking'}
                rows={4}
                noMargin
              />
            </div>
          </Card>

          {/* Section 4 — Goals Assessment */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">Project Goals Assessment</h2>
              {formData.goalsAssessment && proposalRef && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRegenerateGoals}
                  loading={isRegeneratingGoals}
                  disabled={isRegeneratingGoals}
                >
                  🔄 Regenerate all goals
                </Button>
              )}
            </div>

            {!formData.goalsAssessment ? (
              <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg text-center">
                <p className="text-gray-700 mb-2">
                  No goals assessment was generated because no original proposal was provided.
                </p>
                <p className="text-sm text-gray-600">
                  Pick or upload an original proposal in Step 2 above and click "Extract & Analyze" again to generate one.
                </p>
              </div>
            ) : (
              <GoalsAssessmentEditor
                assessment={formData.goalsAssessment}
                updateGoals={updateGoals}
              />
            )}
          </Card>

          {/* Export */}
          <div className="flex justify-end gap-3">
            <Button
              variant="primary"
              onClick={handleExport}
              loading={isGeneratingWord}
              disabled={isGeneratingWord}
            >
              📄 Download Word Document
            </Button>
          </div>
        </div>
      )}
    </Layout>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function FormField({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function NarrativeField({ label, value, onChange, onRegenerate, regenerating, rows = 4, noMargin = false }) {
  return (
    <div className={noMargin ? '' : 'mb-4'}>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-sm font-medium text-gray-700">{label}</label>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating}
          className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
          title="Regenerate this field"
        >
          {regenerating ? '⏳ Regenerating…' : '🔄 Regenerate'}
        </button>
      </div>
      <textarea
        rows={rows}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
      />
    </div>
  );
}

function PublicationField({ label, pub, onChange, onRegenerate, regenerating }) {
  const safe = pub || { citation: '', abstract: '', source: 'verbatim' };
  return (
    <div className="mb-4 p-3 border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-semibold text-gray-700">{label}</label>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating}
          className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
        >
          {regenerating ? '⏳ Regenerating…' : '🔄 Regenerate'}
        </button>
      </div>
      <input
        type="text"
        placeholder="Citation"
        value={safe.citation || ''}
        onChange={e => onChange('citation', e.target.value)}
        className="w-full px-3 py-2 mb-2 border border-gray-300 rounded-lg text-sm"
      />
      <textarea
        rows={4}
        placeholder="Abstract"
        value={safe.abstract || ''}
        onChange={e => onChange('abstract', e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
      />
      <div className="mt-1 text-xs text-gray-500">
        Source:&nbsp;
        <select
          value={safe.source || 'verbatim'}
          onChange={e => onChange('source', e.target.value)}
          className="text-xs border border-gray-300 rounded px-1"
        >
          <option value="verbatim">verbatim</option>
          <option value="summarized">summarized</option>
        </select>
      </div>
    </div>
  );
}

function GoalsAssessmentEditor({ assessment, updateGoals }) {
  const setField = (key, value) => {
    updateGoals(prev => ({ ...prev, [key]: value }));
  };
  const setGoal = (idx, key, value) => {
    updateGoals(prev => {
      const goals = [...(prev.goals || [])];
      goals[idx] = { ...goals[idx], [key]: value };
      return { ...prev, goals };
    });
  };
  const addGoal = () => {
    updateGoals(prev => ({
      ...prev,
      goals: [
        ...(prev.goals || []),
        { goal_number: `Goal ${(prev.goals?.length || 0) + 1}`, goal_text: '', evidence_from_report: '', status: 'partial', confidence: 'medium' },
      ],
    }));
  };
  const removeGoal = (idx) => {
    updateGoals(prev => ({ ...prev, goals: (prev.goals || []).filter((_, i) => i !== idx) }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-700">Overall Rating:</span>
        <select
          value={assessment.overall_rating || ''}
          onChange={e => setField('overall_rating', e.target.value)}
          className={`px-3 py-1 border rounded-full text-sm font-semibold ${ratingPillClasses(assessment.overall_rating)}`}
        >
          <option value="">—</option>
          {RATING_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <FormField label="Outcome Summary">
        <textarea
          rows={3}
          value={assessment.outcome_summary || ''}
          onChange={e => setField('outcome_summary', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
      </FormField>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-800">Goals</h3>
          <Button variant="outline" size="sm" onClick={addGoal}>+ Add goal</Button>
        </div>
        <div className="space-y-3">
          {(assessment.goals || []).map((goal, idx) => (
            <div key={idx} className="p-3 border border-gray-200 rounded-lg bg-gray-50">
              <div className="flex items-center justify-between mb-2">
                <input
                  type="text"
                  value={goal.goal_number || ''}
                  onChange={e => setGoal(idx, 'goal_number', e.target.value)}
                  className="px-2 py-1 border border-gray-300 rounded text-sm font-semibold w-32"
                  placeholder="Aim 1"
                />
                <button
                  type="button"
                  onClick={() => removeGoal(idx)}
                  className="text-xs text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              </div>
              <FormField label="Goal text">
                <textarea
                  rows={2}
                  value={goal.goal_text || ''}
                  onChange={e => setGoal(idx, 'goal_text', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </FormField>
              <FormField label="Evidence from report">
                <textarea
                  rows={3}
                  value={goal.evidence_from_report || ''}
                  onChange={e => setGoal(idx, 'evidence_from_report', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Status">
                  <select
                    value={goal.status || ''}
                    onChange={e => setGoal(idx, 'status', e.target.value)}
                    className={`w-full px-2 py-1 border border-gray-300 rounded text-sm ${statusBadgeClasses(goal.status)}`}
                  >
                    {STATUS_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Confidence">
                  <select
                    value={goal.confidence || ''}
                    onChange={e => setGoal(idx, 'confidence', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  >
                    {CONFIDENCE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </FormField>
              </div>
            </div>
          ))}
        </div>
      </div>

      <FormField label="Notes for Staff">
        <textarea
          rows={3}
          value={assessment.notes_for_staff || ''}
          onChange={e => setField('notes_for_staff', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm italic text-gray-700"
        />
      </FormField>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mergeHeaders(extracted, fromDynamics) {
  const out = { ...(extracted || {}) };
  if (!fromDynamics) return out;
  for (const [key, value] of Object.entries(fromDynamics)) {
    if (value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      out[key] = value;
    }
  }
  return out;
}

export default function GrantReportingPage() {
  return (
    <RequireAppAccess appKey="grant-reporting">
      <GrantReporting />
    </RequireAppAccess>
  );
}
