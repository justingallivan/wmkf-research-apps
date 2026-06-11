import { useState, useMemo, useCallback } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import FileUploaderSimple from '../shared/components/FileUploaderSimple';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ErrorAlert from '../shared/components/ErrorAlert';

/**
 * Test page: single-request Phase I summarization with Dynamics writeback.
 *
 * Enter a request number → lookup fetches Dynamics header + SharePoint docs
 * (reusing /api/grant-reporting/lookup-grant). Pick a proposal file, run
 * summarization, and the narrative lands in akoya_request.wmkf_ai_summary.
 *
 * Not registered in the main navigation — direct URL only while we validate
 * Field Set A writeback. Gated on the existing `batch-phase-i-summaries` app
 * access grant.
 */
function PhaseIDynamics() {
  const [requestNumber, setRequestNumber] = useState('');
  const [lookup, setLookup] = useState(null);
  const [isLookingUp, setIsLookingUp] = useState(false);

  const [pick, setPick] = useState('');
  const [uploaded, setUploaded] = useState(null);
  const [showAllFiles, setShowAllFiles] = useState(false);

  const [summaryLength, setSummaryLength] = useState(1);
  const [summaryLevel, setSummaryLevel] = useState('technical-non-expert');
  const [useDynamicsPrompt, setUseDynamicsPrompt] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null); // {existingLength, existingPreview, recordModifiedOn}

  const findFileByKey = useCallback((key) => {
    if (!key || !lookup?.documents?.files) return null;
    return lookup.documents.files.find(f => `${f.library}::${f.folder}::${f.name}` === key) || null;
  }, [lookup]);

  const fileRef = useMemo(() => {
    if (uploaded) {
      // Carry pathname + access so the server (via file-loader →
      // readUploadedBlobBuffer) reads a private blob by pathname; a legacy
      // public upload (no access) still resolves via its fileUrl.
      return {
        source: 'upload',
        fileUrl: uploaded.url,
        pathname: uploaded.pathname,
        access: uploaded.access,
        filename: uploaded.filename,
      };
    }
    const f = findFileByKey(pick);
    if (f && f.library && f.folder) {
      return { source: 'sharepoint', library: f.library, folder: f.folder, filename: f.name };
    }
    return null;
  }, [uploaded, pick, findFileByKey]);

  const canSummarize = !!fileRef && !!lookup?.requestId && !processing;

  const handleLookup = async () => {
    if (!requestNumber.trim()) {
      setError('Please enter a request number.');
      return;
    }
    setError(null);
    setIsLookingUp(true);
    setLookup(null);
    setPick('');
    setUploaded(null);
    setResult(null);

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
      if (data.documents?.proposalBestGuess) setPick(data.documents.proposalBestGuess);
    } catch (err) {
      setError(err.message || 'Lookup failed');
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleSummarize = async (overwrite = false) => {
    if (!fileRef || !lookup?.requestId) return;
    setProcessing(true);
    setError(null);
    setResult(null);
    setConflict(null);
    try {
      const endpoint = useDynamicsPrompt
        ? '/api/phase-i-dynamics/summarize-v2'
        : '/api/phase-i-dynamics/summarize';
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestGuid: lookup.requestId,
          fileRef,
          summaryLength,
          summaryLevel,
          overwrite,
        }),
      });
      const data = await resp.json();
      if (resp.status === 409 && data.conflict) {
        // Pre-flight detected existing content. Surface a confirm dialog.
        setConflict(data.conflict);
        return;
      }
      if (!resp.ok) {
        const detail = data.details ? `: ${data.details}` : '';
        throw new Error(`${data.error || `Summarize failed (${resp.status})`}${detail}`);
      }
      setResult(data);
    } catch (err) {
      setError(err.message || 'Summarize failed');
    } finally {
      setProcessing(false);
    }
  };

  const libraryLabel = (lib) => {
    if (lib === 'akoya_request') return 'Active';
    const m = /^RequestArchive(\d+)$/i.exec(lib || '');
    if (m) return `Archive ${m[1]}`;
    return lib || '?';
  };

  const allFiles = lookup?.documents?.files || [];
  const filtered = showAllFiles
    ? allFiles
    : allFiles.filter(f => f.classification === 'proposal' || f.classification === 'other');

  return (
    <Layout>
      <PageHeader
        title="Phase I Summary — Dynamics (Test)"
        description="Single-request Phase I summarization with writeback to akoya_request.wmkf_ai_summary."
      />

      <ErrorAlert message={error} onDismiss={() => setError(null)} />

      {/* Step 1: Lookup */}
      <Card className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Step 1 — Look up request</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={requestNumber}
            onChange={e => setRequestNumber(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLookup()}
            placeholder="e.g. 1002807"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            disabled={isLookingUp}
          />
          <Button onClick={handleLookup} disabled={isLookingUp || !requestNumber.trim()}>
            {isLookingUp ? 'Looking up…' : 'Look up'}
          </Button>
        </div>

        {lookup?.found && (
          <div className="mt-4 text-sm">
            <div className="font-medium text-gray-900">
              {lookup.header?.title || '(no title)'}
            </div>
            <div className="text-gray-600 mt-1">
              Request ID: <span className="font-mono">{lookup.requestId}</span>
              {lookup.header?.pis?.length > 0 && <> · PIs: {lookup.header.pis.join(', ')}</>}
            </div>
            {lookup.errors?.sharepoint && (
              <div className="text-amber-700 mt-1">
                SharePoint warning: {lookup.errors.sharepoint}
              </div>
            )}
          </div>
        )}
        {lookup && !lookup.found && (
          <div className="mt-4 text-sm text-red-700">
            {lookup.errors?.dynamics || 'No request found.'}
          </div>
        )}
      </Card>

      {/* Step 2: File pick + options */}
      {lookup?.found && (
        <Card className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Step 2 — Choose proposal file</h2>

          {allFiles.length > 0 && (
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
                  const star = f.classification === 'proposal' ? '★ ' : '';
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
                  checked={showAllFiles}
                  onChange={e => setShowAllFiles(e.target.checked)}
                />
                Show all files ({allFiles.length} total)
              </label>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Or upload a file
            </label>
            <FileUploaderSimple
              onFilesUploaded={(files) => {
                if (files && files.length > 0) {
                  setUploaded({
                    url: files[0].url,
                    pathname: files[0].pathname,
                    access: files[0].access,
                    filename: files[0].filename,
                  });
                  setPick('');
                }
              }}
              multiple={false}
              accept=".pdf,.docx,.doc"
              hideFileList={false}
              // Phase 1: Phase-I proposals are sensitive — upload as private blobs
              // when enabled. summarize/summarize-v2 read them server-side by
              // pathname via file-loader. Gated (default public) until smoked.
              access={process.env.NEXT_PUBLIC_PHASE_I_DYNAMICS_PRIVATE_BLOB === 'true' ? 'private' : 'public'}
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

          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Summary length (paragraphs)
              </label>
              <select
                value={summaryLength}
                onChange={e => setSummaryLength(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Audience
              </label>
              <select
                value={summaryLevel}
                onChange={e => setSummaryLevel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="general-audience">General audience</option>
                <option value="technical-non-expert">Technical non-expert</option>
                <option value="technical-expert">Technical expert</option>
              </select>
            </div>
          </div>
        </Card>
      )}

      {/* Step 3: Summarize */}
      {lookup?.found && (
        <Card className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Step 3 — Summarize & write back</h2>

          <label className="flex items-start gap-2 mb-3 text-sm">
            <input
              type="checkbox"
              checked={useDynamicsPrompt}
              onChange={e => setUseDynamicsPrompt(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-gray-900">Use Dynamics-stored prompt (v2)</span>
              <span className="block text-xs text-gray-600">
                Executes via <code>executePrompt()</code> against Dataverse <code>wmkf_ai_prompts</code>,
                uses <code>cache_control</code> on the system block. Output stored to the same
                field — compare the two runs against each other.
              </span>
            </span>
          </label>

          <Button onClick={() => handleSummarize(false)} disabled={!canSummarize}>
            {processing ? 'Summarizing…' : useDynamicsPrompt ? 'Run v2 (Dynamics prompt) + write to Dynamics' : 'Run summary + write to Dynamics'}
          </Button>
          <p className="mt-2 text-xs text-gray-500">
            Writes the narrative to <code>akoya_request.wmkf_ai_summary</code> and
            logs an audit row to <code>wmkf_ai_run</code>. If the field is already populated,
            you'll be asked to confirm overwrite before anything runs.
          </p>
        </Card>
      )}

      {/* Overwrite confirmation */}
      {conflict && (
        <Card className="mb-6 border-amber-300 bg-amber-50">
          <h2 className="text-lg font-semibold text-amber-900 mb-2">
            This request already has a summary
          </h2>
          <p className="text-sm text-amber-800 mb-3">
            <code>wmkf_ai_summary</code> is already populated ({conflict.existingLength.toLocaleString()} chars
            {conflict.recordModifiedOn && (
              <> · record last modified {new Date(conflict.recordModifiedOn).toLocaleString()}</>
            )}
            ). Overwriting will replace the existing text and cost a fresh Claude call.
          </p>
          <details className="mb-3">
            <summary className="cursor-pointer text-sm text-amber-900 font-medium">
              Show existing content
            </summary>
            <pre className="mt-2 text-xs whitespace-pre-wrap bg-white border border-amber-200 rounded p-2 max-h-96 overflow-auto">
{conflict.existingContent}
            </pre>
          </details>
          <div className="flex gap-2">
            <Button onClick={() => handleSummarize(true)} disabled={processing}>
              {processing ? 'Overwriting…' : 'Overwrite existing summary'}
            </Button>
            <button
              type="button"
              onClick={() => setConflict(null)}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              disabled={processing}
            >
              Cancel
            </button>
          </div>
        </Card>
      )}

      {/* Step 4: Result */}
      {result && (
        <Card>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Result</h2>
          <div className="mb-3 text-sm">
            <div>
              <span className="font-medium">File:</span> {result.filename}
            </div>
            <div>
              <span className="font-medium">Model:</span> <span className="font-mono">{result.model}</span>
            </div>
            <div className="mt-1">
              {result.writtenToDynamics ? (
                <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800">
                  ✓ Written to Dynamics
                </span>
              ) : (
                <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-red-100 text-red-800">
                  ✗ Writeback {result.writebackFailure === 'conflict'
                    ? 'blocked: record was modified by another request'
                    : 'failed — see server logs'}
                </span>
              )}
            </div>
            {result.promptMeta && (
              <div className="mt-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900">
                <div className="font-medium mb-1">v2 run — Dynamics prompt</div>
                <div>Source: <code>{result.promptMeta.source}</code> · fetched in {result.promptMeta.fetchMs}ms</div>
                <div>System: {result.promptMeta.systemPromptChars.toLocaleString()} chars · User: {result.promptMeta.userPromptChars.toLocaleString()} chars</div>
                {result.cacheMeta && (
                  <div>
                    Tokens: {result.cacheMeta.inputTokens.toLocaleString()} input
                    {result.cacheMeta.cacheCreationTokens > 0 && <> · {result.cacheMeta.cacheCreationTokens.toLocaleString()} cache write</>}
                    {result.cacheMeta.cacheReadTokens > 0 && <> · {result.cacheMeta.cacheReadTokens.toLocaleString()} cache read</>}
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Summary</label>
            <textarea
              value={result.summary}
              readOnly
              rows={20}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono bg-gray-50"
            />
          </div>
        </Card>
      )}
    </Layout>
  );
}

export default function Page() {
  return (
    <RequireAppAccess appKey="batch-phase-i-summaries">
      <PhaseIDynamics />
    </RequireAppAccess>
  );
}
