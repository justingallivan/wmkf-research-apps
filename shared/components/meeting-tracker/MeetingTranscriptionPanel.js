import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestJson } from '../../utils/api-request';
import { formatTranscriptMinuteHeading, getTranscriptSpeakers, groupTranscriptByMinute } from '../../../lib/services/transcription-pilot/transcript-format';

const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const API_PATH = '/api/meeting-tracker/visits';
const ACTIVE_STATUSES = new Set(['uploading', 'queued', 'submitting', 'processing', 'saving']);
const JOB_STATE_LABELS = {
  uploading: 'Uploading', queued: 'Queued', submitting: 'Transcribing', processing: 'Transcribing', saving: 'Saving transcript',
  ready: 'Ready to review', failed: 'Failed', submission_uncertain: 'Needs attention', expired: 'Expired',
};
const SOURCE_LABELS = {
  pi: 'PI', co_pi: 'Co-PI', coPIs: 'Co-PI', saved_staff: 'Saved staff', saved_attendee: 'Saved attendee', savedAttendees: 'Saved attendee',
};

function errorMessage(error, fallback) {
  if (error?.status === 409) return 'This draft changed elsewhere. Reload it before trying again; your current edits are preserved.';
  return error?.message || fallback;
}

function emptyNameDraft(job) {
  return Object.fromEntries(Object.entries(job?.speaker_names || {}).map(([id, name]) => [id, String(name || '')]));
}

function filenameFormat(file) {
  if (!file) return null;
  const extension = String(file?.name || '').toLowerCase().split('.').pop();
  const expected = extension === 'm4a' ? ['audio/mp4', 'audio/x-m4a'] : extension === 'mp3' ? ['audio/mpeg'] : [];
  if (!expected.length) return 'Choose an M4A or MP3 recording.';
  if (file.type && !expected.includes(file.type)) return 'The selected file type does not match its M4A or MP3 extension.';
  return null;
}

function jobTone(status) {
  if (status === 'ready') return 'border-green-200 bg-green-50 text-green-800';
  if (status === 'submission_uncertain') return 'border-amber-200 bg-amber-50 text-amber-950';
  if (ACTIVE_STATUSES.has(status)) return 'border-blue-200 bg-blue-50 text-blue-800';
  return 'border-gray-200 bg-gray-100 text-gray-700';
}

function Notice({ tone = 'error', children }) {
  if (!children) return null;
  const classes = tone === 'error'
    ? 'border-red-200 bg-red-50 text-red-900'
    : tone === 'success' ? 'border-green-200 bg-green-50 text-green-900'
      : tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-950'
        : 'border-gray-200 bg-gray-50 text-gray-800';
  return <div className={`rounded-lg border px-3 py-2 text-sm leading-5 ${classes}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

function CandidateSourceStatus({ sources }) {
  const rows = Object.entries(sources || {});
  const unavailable = rows.filter(([, value]) => value?.status === 'unavailable');
  if (!unavailable.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-semibold">Some name suggestions are unavailable.</p>
      <ul className="mt-1 list-disc pl-5">
        {unavailable.map(([source, value]) => <li key={source}>{SOURCE_LABELS[source] || source}: {value?.reason || 'Directory lookup did not complete.'} You can still enter a name manually.</li>)}
      </ul>
    </div>
  );
}

function SpeakerEditor({ content, candidates, candidateSources, names, selectedSuggestions, onNameChange, onSuggestionChange, disabled }) {
  const speakers = getTranscriptSpeakers(content);
  const grouped = useMemo(() => {
    const sources = new Map();
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      if (!candidate || typeof candidate.id !== 'string' || typeof candidate.displayName !== 'string') continue;
      const source = SOURCE_LABELS[candidate.source] || 'Other suggestions';
      if (!sources.has(source)) sources.set(source, []);
      sources.get(source).push(candidate);
    }
    return [...sources.entries()];
  }, [candidates]);
  const repeatedLabels = useMemo(() => {
    const counts = new Map();
    for (const candidate of candidates || []) counts.set(candidate.displayName, (counts.get(candidate.displayName) || 0) + 1);
    return counts;
  }, [candidates]);
  const groups = groupTranscriptByMinute(content, names || {});
  const excerpts = new Map(speakers.map((id) => [id, groups.flatMap((group) => group.utterances).find((item) => item.speaker === id)?.text || '']));

  if (!speakers.length) return <p className="mt-4 text-sm text-gray-700">No timed speaker turns were detected. The transcript is available as text, but it cannot be published as a timed TXT/VTT bundle.</p>;
  return (
    <section className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4" aria-labelledby="meeting-transcription-speakers-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="meeting-transcription-speakers-title" className="text-sm font-semibold text-gray-950">Detected speakers ({speakers.length})</h3>
        <p className="text-xs text-gray-600">Choose a suggestion or enter a display name. Suggestions only fill the name; no identity is linked automatically.</p>
      </div>
      <CandidateSourceStatus sources={candidateSources} />
      <div className="mt-3 divide-y divide-gray-200">
        {speakers.map((speaker, index) => {
          const controlId = `meeting-transcription-speaker-${index}`;
          return (
            <div key={speaker} className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(9rem,0.8fr)_minmax(0,1.2fr)] sm:items-start">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">Speaker {speaker}</p>
                <p className="mt-1 break-words text-xs leading-5 text-gray-600">{excerpts.get(speaker) || 'No excerpt available.'}</p>
              </div>
              <div className="grid min-w-0 gap-2">
                <label htmlFor={`${controlId}-suggestion`} className="block text-xs font-medium text-gray-700">
                  Suggestions for Speaker {speaker}
                  <select
                    id={`${controlId}-suggestion`}
                    disabled={disabled}
                    value={selectedSuggestions?.[speaker] || ''}
                    onChange={(event) => {
                      const match = (candidates || []).find((candidate) => candidate.id === event.target.value);
                      onSuggestionChange(speaker, event.target.value);
                      if (match) onNameChange(speaker, match.displayName);
                    }}
                    className="mt-1 block min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-gray-100"
                  >
                    <option value="">Choose a suggestion…</option>
                    {grouped.map(([source, items]) => (
                      <optgroup key={source} label={source}>
                        {items.map((candidate) => {
                          const duplicate = repeatedLabels.get(candidate.displayName) > 1;
                          const duplicateIndex = duplicate ? items.filter((item) => item.displayName === candidate.displayName).findIndex((item) => item.id === candidate.id) + 1 : null;
                          return <option key={candidate.id} value={candidate.id}>{candidate.displayName}{duplicate ? ` · ${source} ${duplicateIndex}` : ''}</option>;
                        })}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label htmlFor={`${controlId}-name`} className="block text-xs font-medium text-gray-700">
                  Manual display name for Speaker {speaker}
                  <input
                    id={`${controlId}-name`}
                    value={names?.[speaker] || ''}
                    onChange={(event) => { onSuggestionChange(speaker, ''); onNameChange(speaker, event.target.value); }}
                    disabled={disabled}
                    maxLength={80}
                    placeholder={`Name for Speaker ${speaker}`}
                    className="mt-1 block min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-gray-100"
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TranscriptContent({ content, speakerNames }) {
  const groups = groupTranscriptByMinute(content, speakerNames || {});
  if (groups.length) return (
    <div className="mt-4 max-h-[32rem] overflow-y-auto rounded-lg border border-gray-200" aria-label="Transcript grouped by minute">
      {groups.map((group) => (
        <section key={group.minute} aria-labelledby={`meeting-transcription-minute-${group.minute}`} className="border-b border-gray-200 last:border-b-0">
          <h4 id={`meeting-transcription-minute-${group.minute}`} className="sticky top-0 border-b border-gray-200 bg-gray-100 px-4 py-2 text-xs font-semibold tabular-nums text-gray-700">{formatTranscriptMinuteHeading(group.minute)}</h4>
          <div className="space-y-3 px-4 py-3">
            {group.utterances.map((utterance, index) => <p key={`${utterance.start}-${utterance.end}-${index}`} className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-900">{utterance.speakerName && <span className="font-semibold">{utterance.speakerName}: </span>}{utterance.text}</p>)}
          </div>
        </section>
      ))}
    </div>
  );
  if (typeof content?.text === 'string' && content.text.trim()) return <pre className="mt-4 max-h-[32rem] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-4 font-sans text-sm leading-6 text-gray-900">{content.text}</pre>;
  return <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">No transcript text or timed speaker turns are available.</p>;
}

function MeetingTranscriptionPanelForRequest({ requestId, apiBasePath, reviewOnly = false }) {
  const [collection, setCollection] = useState(null);
  const [collectionCheckedAt, setCollectionCheckedAt] = useState(0);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [speakerNames, setSpeakerNames] = useState({});
  const [selectedSuggestions, setSelectedSuggestions] = useState({});
  const [selectedCorrectionId, setSelectedCorrectionId] = useState(null);
  const [correctionDetail, setCorrectionDetail] = useState(null);
  const [correctionNames, setCorrectionNames] = useState({});
  const [correctionSuggestions, setCorrectionSuggestions] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);
  const [providerRegion, setProviderRegion] = useState('us');
  const [acknowledged, setAcknowledged] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [closeAcknowledgedId, setCloseAcknowledgedId] = useState(null);
  const generationRef = useRef(0);
  const detailSequenceRef = useRef(0);
  const controllerRef = useRef(null);
  const mountedRef = useRef(false);
  const selectedJobIdRef = useRef(null);
  const selectedCorrectionIdRef = useRef(null);
  const selectJob = useCallback((jobId) => {
    selectedJobIdRef.current = jobId;
    selectedCorrectionIdRef.current = null;
    setSelectedJobId(jobId);
    setSelectedCorrectionId(null);
    setBusy(null);
  }, []);
  const selectCorrection = useCallback((operationId) => {
    selectedJobIdRef.current = null;
    selectedCorrectionIdRef.current = operationId;
    setSelectedJobId(null);
    setSelectedCorrectionId(operationId);
    setBusy(null);
  }, []);
  const basePath = useMemo(() => apiBasePath || `${API_PATH}/${encodeURIComponent(requestId || '')}/transcriptions`, [apiBasePath, requestId]);
  const jobs = collection?.jobs || [];
  const selectedJob = detail?.job?.id === selectedJobId
    ? detail.job
    : jobs.find((job) => job.id === selectedJobId) || null;
  const sourceList = useMemo(() => {
    const result = new Map();
    for (const candidate of correctionDetail?.candidates || collection?.candidates || detail?.candidates || []) {
      if (candidate?.id && candidate?.displayName) result.set(candidate.id, candidate);
    }
    return [...result.values()];
  }, [collection?.candidates, correctionDetail?.candidates, detail?.candidates]);
  const utterances = Array.isArray(detail?.content?.utterances) ? detail.content.utterances : [];
  const speakerIds = useMemo(() => getTranscriptSpeakers(detail?.content), [detail?.content]);
  const dirtyNames = useMemo(() => speakerIds.some((id) => String(speakerNames[id] || '') !== String(selectedJob?.speaker_names?.[id] || '')), [speakerIds, speakerNames, selectedJob?.speaker_names]);
  const correctionContent = useMemo(() => {
    const turns = Array.isArray(correctionDetail?.content?.utterances) ? correctionDetail.content.utterances : [];
    return {
      text: correctionDetail?.content?.text || '',
      utterances: turns.map((utterance) => ({ speaker: utterance.speakerId, start: utterance.startMs, end: utterance.endMs, text: utterance.text })),
    };
  }, [correctionDetail]);
  const correctionSpeakerIds = useMemo(() => getTranscriptSpeakers(correctionContent), [correctionContent]);
  const dirtyCorrectionNames = useMemo(() => correctionSpeakerIds.some((id) => String(correctionNames[id] || '') !== String(correctionDetail?.correction?.speakerNames?.[id] || '')), [correctionDetail?.correction?.speakerNames, correctionNames, correctionSpeakerIds]);
  const uploadError = filenameFormat(selectedFile);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      detailSequenceRef.current += 1;
      controllerRef.current?.abort();
    };
  }, []);

  const isCurrent = useCallback((generation, expectedRequestId) => mountedRef.current
    && generationRef.current === generation && requestId === expectedRequestId, [requestId]);
  const isActiveJob = useCallback((generation, expectedRequestId, sequence, jobId) => isCurrent(generation, expectedRequestId)
    && detailSequenceRef.current === sequence && selectedJobIdRef.current === jobId && selectedCorrectionIdRef.current === null, [isCurrent]);
  const isActiveCorrection = useCallback((generation, expectedRequestId, sequence, operationId) => isCurrent(generation, expectedRequestId)
    && detailSequenceRef.current === sequence && selectedCorrectionIdRef.current === operationId && selectedJobIdRef.current === null, [isCurrent]);
  const captureActiveContext = useCallback(() => ({
    sequence: detailSequenceRef.current,
    jobId: selectedJobIdRef.current,
    correctionId: selectedCorrectionIdRef.current,
  }), []);
  const isActiveContext = useCallback((generation, expectedRequestId, context) => isCurrent(generation, expectedRequestId)
    && detailSequenceRef.current === context.sequence
    && selectedJobIdRef.current === context.jobId
    && selectedCorrectionIdRef.current === context.correctionId, [isCurrent]);

  const loadCollection = useCallback(async ({ keepDetail = false } = {}) => {
    if (!requestId) return;
    const generation = generationRef.current;
    const expectedRequestId = requestId;
    setLoading(true);
    try {
      const body = await requestJson(basePath, { method: 'GET', fallbackMessage: 'Meeting transcription could not be loaded.' });
      if (!isCurrent(generation, expectedRequestId)) return;
      setCollection(body);
      setCollectionCheckedAt(Date.now());
      setError(null);
      setConflict(false);
      if (!keepDetail && !body.jobs?.some((job) => job.id === selectedJobIdRef.current)) {
        selectJob(null);
        setDetail(null);
        setSpeakerNames({});
        setSelectedSuggestions({});
      }
    } catch (loadError) {
      if (isCurrent(generation, expectedRequestId) && loadError?.name !== 'AbortError') setError(errorMessage(loadError, 'Meeting transcription could not be loaded.'));
    } finally {
      if (isCurrent(generation, expectedRequestId)) setLoading(false);
    }
  }, [basePath, isCurrent, requestId, selectJob]);

  useEffect(() => {
    generationRef.current += 1;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled && requestId) void loadCollection(); });
    return () => { cancelled = true; };
  }, [loadCollection, requestId]);

  const loadDetail = useCallback(async (jobId, { preserveDraft = false } = {}) => {
    if (!requestId || !jobId) return;
    const generation = generationRef.current;
    const expectedRequestId = requestId;
    const sequence = ++detailSequenceRef.current;
    const current = () => isActiveJob(generation, expectedRequestId, sequence, jobId);
    selectJob(jobId);
    if (!preserveDraft) {
      setDetail(null);
      setSpeakerNames({});
      setSelectedSuggestions({});
      setSelectedCorrectionId(null);
      setCorrectionDetail(null);
    }
    setBusy('loading-detail');
    try {
      const body = await requestJson(`${basePath}/${encodeURIComponent(jobId)}`, { method: 'GET', fallbackMessage: 'This transcription could not be opened.' });
      if (!current()) return;
      setDetail(body);
      if (!preserveDraft) setSpeakerNames(emptyNameDraft(body.job));
      if (!preserveDraft) setSelectedSuggestions({});
      setConflict(false);
      setError(null);
    } catch (loadError) {
      if (current() && loadError?.name !== 'AbortError') setError(errorMessage(loadError, 'This transcription could not be opened.'));
    } finally {
      if (current()) setBusy(null);
    }
  }, [basePath, isActiveJob, requestId, selectJob]);

  const loadCorrection = useCallback(async (operationId, { preserveDraft = false } = {}) => {
    if (reviewOnly || !requestId || !operationId) return;
    const generation = generationRef.current;
    const expectedRequestId = requestId;
    const sequence = ++detailSequenceRef.current;
    const current = () => isActiveCorrection(generation, expectedRequestId, sequence, operationId);
    selectCorrection(operationId);
    if (!preserveDraft) {
      setDetail(null);
      setCorrectionDetail(null);
      setCorrectionNames({});
      setCorrectionSuggestions({});
    }
    setBusy('loading-correction');
    try {
      const body = await requestJson(`${basePath}/corrections/${encodeURIComponent(operationId)}`, { method: 'GET', fallbackMessage: 'This correction draft could not be opened.' });
      if (!current()) return;
      setCorrectionDetail(body);
      if (!preserveDraft) setCorrectionNames({ ...(body.correction?.speakerNames || {}) });
      setError(null);
      setConflict(false);
    } catch (loadError) {
      if (current() && loadError?.name !== 'AbortError') setError(errorMessage(loadError, 'This correction draft could not be opened.'));
    } finally {
      if (current()) setBusy(null);
    }
  }, [basePath, isActiveCorrection, requestId, reviewOnly, selectCorrection]);

  const postJobAction = useCallback(async (action, body, label) => {
    if (!selectedJob || !requestId || (reviewOnly && action !== 'speakers')) return null;
    const generation = generationRef.current;
    const expectedRequestId = requestId;
    const sequence = detailSequenceRef.current;
    const current = () => isActiveJob(generation, expectedRequestId, sequence, selectedJob.id);
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson(`${basePath}/${encodeURIComponent(selectedJob.id)}/${action}`, { method: action === 'speakers' ? 'PATCH' : 'POST', body, fallbackMessage: `${label} could not be completed.` });
      if (!current()) return null;
      if (result.job) {
        setDetail((current) => current?.job?.id === selectedJob.id ? { ...current, job: result.job } : current);
        setCollection((current) => current ? { ...current, jobs: current.jobs.map((job) => job.id === result.job.id ? result.job : job) } : current);
      }
      return result;
    } catch (actionError) {
      if (!current() || actionError?.name === 'AbortError') return null;
      let refreshFailed = false;
      if (action === 'publish') {
        await loadCollection({ keepDetail: true });
        if (!current()) return null;
        try {
          const latest = await requestJson(`${basePath}/${encodeURIComponent(selectedJob.id)}`, {
            method: 'GET', fallbackMessage: 'Reload the draft before trying again.',
          });
          if (current()) setDetail(latest);
        } catch { refreshFailed = true; }
      }
      if (current()) {
        setConflict(actionError.status === 409 || refreshFailed);
        setError(errorMessage(actionError, `${label} could not be completed.`));
      }
      return null;
    } finally {
      if (current()) setBusy(null);
    }
  }, [basePath, isActiveJob, loadCollection, requestId, reviewOnly, selectedJob]);

  const uploadAndStart = async () => {
    if (reviewOnly || !selectedFile || uploadError || !acknowledged || busy || !requestId) return;
    if (selectedFile.size < 1 || selectedFile.size > MAX_AUDIO_BYTES) {
      setError('Choose an audio recording no larger than 50 MiB.');
      return;
    }
    const contentType = selectedFile.type || (selectedFile.name.toLowerCase().endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg');
    const generation = generationRef.current;
    const expectedRequestId = requestId;
    const context = captureActiveContext();
    const currentContext = () => isActiveContext(generation, expectedRequestId, context);
    const controller = new AbortController();
    let startRequested = false;
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setBusy('upload');
    setError(null);
    setNotice(null);
    setUploadProgress(0);
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.();
      if (!idempotencyKey) throw new Error('This browser cannot create a secure upload request. Use a current browser and try again.');
      const prepared = await requestJson(basePath, {
        method: 'POST', signal: controller.signal,
        body: { filename: selectedFile.name, contentType, bytes: selectedFile.size, idempotencyKey, providerRegion },
        fallbackMessage: 'A private upload could not be prepared.',
      });
      if (!isCurrent(generation, expectedRequestId)) return;
      const job = prepared.job;
      const upload = prepared.upload;
      if (!job?.id || !Number.isInteger(job.version) || typeof upload?.token !== 'string' || !upload.token || typeof upload?.pathname !== 'string' || !upload.pathname || upload.access !== 'private') {
        throw new Error('The private upload service returned an incomplete contract. Refresh this page before trying again.');
      }
      if (selectedFile.size > upload.maximumSizeInBytes) throw new Error('The recording exceeds the private upload limit. Choose a smaller file.');
      const { put } = await import('@vercel/blob/client');
      if (!isCurrent(generation, expectedRequestId)) return;
      await put(upload.pathname, selectedFile, {
        access: 'private', token: upload.token, multipart: true, contentType,
        abortSignal: controller.signal,
        onUploadProgress: ({ percentage }) => { if (isCurrent(generation, expectedRequestId)) setUploadProgress(Math.max(0, Math.min(100, Math.round(percentage)))); },
      });
      if (!isCurrent(generation, expectedRequestId)) return;
      startRequested = true;
      setBusy('starting');
      const started = await requestJson(`${basePath}/${encodeURIComponent(job.id)}/start`, {
        method: 'POST', signal: controller.signal,
        body: { expectedVersion: job.version, nonSensitiveAcknowledged: true },
        fallbackMessage: 'The recording uploaded, but the provider submission result needs attention.',
      });
      if (!isCurrent(generation, expectedRequestId)) return;
      if (!started.job?.id || !Number.isInteger(started.job.version)) {
        const uncertainResult = new Error('The recording uploaded, but the provider submission result could not be confirmed.');
        uncertainResult.status = 0;
        throw uncertainResult;
      }
      if (currentContext()) {
        setSelectedFile(null);
        setAcknowledged(false);
      }
      setUploadProgress(null);
      if (currentContext()) {
        setNotice(started.job.status === 'submission_uncertain' || started.job.needsAttention
          ? 'Submission outcome unknown. Do not upload the same recording again until this draft has been checked.'
          : 'The recording was queued for transcription. Refresh to see its latest status.');
        await Promise.all([loadCollection({ keepDetail: true }), loadDetail(started.job?.id || job.id)]);
      } else {
        await loadCollection({ keepDetail: true });
      }
    } catch (uploadFailure) {
      if (!isCurrent(generation, expectedRequestId) || uploadFailure?.name === 'AbortError') return;
      const uncertain = startRequested && (uploadFailure?.status === 0 || uploadFailure?.status >= 500 || uploadFailure?.payload?.code === 'transcription_dispatch_pending' || uploadFailure?.payload?.code === 'transcription_submission_uncertain');
      if (currentContext()) setNotice(uncertain ? 'Submission outcome unknown. Do not upload the same recording again until this draft has been checked.' : null);
      await loadCollection({ keepDetail: true });
      if (currentContext()) setError(uncertain
        ? `${uploadFailure.message || 'The provider submission result is not confirmed.'} Refresh the list to check this exact draft before starting another transcription.`
        : errorMessage(uploadFailure, 'The recording could not be uploaded.'));
    } finally {
      if (currentContext()) {
        setBusy(null);
      }
      if (isCurrent(generation, expectedRequestId) && controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const saveSpeakerNames = async () => {
    if (!selectedJob || !detail || !dirtyNames || busy) return;
    const generation = generationRef.current;
    const expectedRequestId = requestId;
    const sequence = detailSequenceRef.current;
    const current = () => isActiveJob(generation, expectedRequestId, sequence, selectedJob.id);
    const result = await postJobAction('speakers', { expectedVersion: selectedJob.version, speakerNames }, 'Speaker names');
    if (!current() || !result?.job) return;
    setDetail((current) => current?.job?.id === selectedJob.id ? { ...current, job: result.job } : current);
    setSpeakerNames(emptyNameDraft(result.job));
    setNotice('Speaker names saved.');
  };

  const beginCorrection = async () => {
    if (reviewOnly || !currentArtifact?.bundleEditable || busy) return;
    const generation = generationRef.current;
    const expectedRequestId = requestId;
    const context = captureActiveContext();
    const currentContext = () => isActiveContext(generation, expectedRequestId, context);
    setBusy('create-correction');
    setError(null);
    try {
      const created = await requestJson(`${basePath}/materials/${encodeURIComponent(currentArtifact.id)}/corrections`, { method: 'POST', body: {}, fallbackMessage: 'A correction draft could not be created.' });
      if (!isCurrent(generation, expectedRequestId)) return;
      const operationId = created.correction?.operationId;
      if (!operationId) throw new Error('The correction service returned an incomplete draft. Refresh this page before trying again.');
      if (!currentContext()) {
        await loadCollection({ keepDetail: true });
        return;
      }
      detailSequenceRef.current += 1;
      selectCorrection(operationId);
      setBusy(null);
      setCorrectionDetail(created);
      setCorrectionNames({ ...(created.correction?.speakerNames || {}) });
      setDetail(null);
      setSpeakerNames({});
      setNotice('Correction draft created from the current published transcript. Saving labels will not call the transcription provider.');
      await loadCollection({ keepDetail: true });
    } catch (createError) {
      if (currentContext()) setError(errorMessage(createError, 'A correction draft could not be created.'));
    } finally {
      if (currentContext()) setBusy(null);
    }
  };

  const saveCorrection = async () => {
    if (reviewOnly) return;
    const correction = correctionDetail?.correction;
    if (!correction || !dirtyCorrectionNames || busy) return;
    const generation = generationRef.current;
    const expectedRequestId = requestId;
    const sequence = detailSequenceRef.current;
    const current = () => isActiveCorrection(generation, expectedRequestId, sequence, correction.operationId);
    setBusy('save-correction');
    setError(null);
    try {
      const result = await requestJson(`${basePath}/corrections/${encodeURIComponent(correction.operationId)}`, {
        method: 'PATCH', body: { expectedVersion: correction.version, speakerNames: correctionNames },
        fallbackMessage: 'Correction labels could not be saved.',
      });
      if (!current()) return;
      setCorrectionDetail((current) => current ? { ...current, correction: result.correction } : current);
      setCorrectionNames({ ...(result.correction?.speakerNames || {}) });
      setNotice('Correction labels saved.');
      setConflict(false);
      await loadCollection({ keepDetail: true });
    } catch (saveError) {
      if (current()) {
        setConflict(saveError?.status === 409);
        setError(errorMessage(saveError, 'Correction labels could not be saved.'));
      }
    } finally {
      if (current()) setBusy(null);
    }
  };

  const publishCorrection = async () => {
    if (reviewOnly) return;
    const correction = correctionDetail?.correction;
    const artifact = correctionDetail?.currentArtifact;
    if (!correction || !artifact || dirtyCorrectionNames || !correctionSpeakerIds.length || correction.state !== 'draft' || busy) return;
    if (artifact.id !== correction.expectedCurrentArtifactId || artifact.fingerprint !== correction.expectedCurrentFingerprint) {
      setError('The published transcript changed after this correction draft was created. Reload the current transcript and start a new correction.');
      return;
    }
    const generation = generationRef.current;
    const expectedRequestId = requestId;
    const sequence = detailSequenceRef.current;
    const current = () => isActiveCorrection(generation, expectedRequestId, sequence, correction.operationId);
    setBusy('publish-correction');
    setError(null);
    try {
      const result = await requestJson(`${basePath}/corrections/${encodeURIComponent(correction.operationId)}/publish`, { method: 'POST', body: { expectedVersion: correction.version }, fallbackMessage: 'The correction could not be published.' });
      if (!current()) return;
      setCorrectionDetail((current) => current ? { ...current, correction: { ...current.correction, state: result.publication?.state || current.correction.state }, currentArtifact: result.currentArtifact } : current);
      if (result.currentArtifact) setCollection((current) => current ? { ...current, currentArtifact: result.currentArtifact } : current);
      const publicationState = result.publication?.state;
      setNotice(publicationState === 'published'
        ? 'Correction published. The finalized downloads now include the saved labels.'
        : publicationState === 'published_reconcile'
          ? 'Correction is published, but finalization needs reconciliation.'
          : publicationState === 'unknown'
            ? 'The correction publication result is unknown. Reconcile the publication before retrying.'
            : `Correction was not published${result.publication?.errorCode ? ` (${result.publication.errorCode})` : ''}.`);
      await loadCollection({ keepDetail: true });
      if (current()) await loadCorrection(correction.operationId, { preserveDraft: true });
    } catch (publishError) {
      if (current()) {
        setConflict(publishError?.status === 409);
        await loadCollection({ keepDetail: true });
        if (current()) setError(errorMessage(publishError, 'The correction could not be published.'));
      }
    } finally {
      if (current()) setBusy(null);
    }
  };

  const publish = async () => {
    if (reviewOnly || !selectedJob || !collection || !detail || dirtyNames || !utterances.length || busy) return;
    const generation = generationRef.current;
    const expectedRequestId = requestId;
    const sequence = detailSequenceRef.current;
    const isStillSelected = () => isActiveJob(generation, expectedRequestId, sequence, selectedJob.id);
    const currentArtifactExpected = collection.currentArtifact || null;
    const result = await postJobAction('publish', {
      expectedVersion: selectedJob.version,
      expectedCurrentArtifactId: currentArtifactExpected?.id || null,
      expectedCurrentFingerprint: currentArtifactExpected?.fingerprint || null,
    }, 'Publishing');
    if (!isStillSelected()) return;
    if (!result?.publication) return;
    const publication = result.publication;
    if (result.currentArtifact) setCollection((state) => state ? { ...state, currentArtifact: result.currentArtifact } : state);
    if (publication.state === 'published' && result.superseded) setNotice('This publication was verified, but a newer transcript is current. The newer transcript remains unchanged.');
    else if (publication.state === 'published') setNotice('Transcript published. The finalized downloads are now available below.');
    else if (publication.state === 'published_reconcile') setNotice('Transcript is published, but finalization needs reconciliation. The published transcript remains available.');
    else if (publication.state === 'unknown') setNotice('The publication result is unknown. Reconcile this publication before trying again.');
    else setError(`Publication did not complete${publication.errorCode ? ` (${publication.errorCode})` : ''}. Review the draft and retry when ready.`);
    await loadCollection({ keepDetail: true });
  };

  const deleteDraft = async () => {
    if (reviewOnly || !selectedJob || busy || !globalThis.confirm?.('Delete this temporary transcription draft?')) return;
    const generation = generationRef.current;
    const expectedRequestId = requestId;
    const sequence = detailSequenceRef.current;
    const current = () => isActiveJob(generation, expectedRequestId, sequence, selectedJob.id);
    setBusy('delete');
    setError(null);
    try {
      await requestJson(`${basePath}/${encodeURIComponent(selectedJob.id)}`, { method: 'DELETE', body: { expectedVersion: selectedJob.version }, fallbackMessage: 'The draft could not be deleted.' });
      if (!current()) return;
      selectJob(null);
      setDetail(null);
      setSpeakerNames({});
      setSelectedSuggestions({});
      setNotice('Temporary draft deleted.');
      await loadCollection();
    } catch (deleteError) {
      if (current()) {
        setConflict(deleteError?.status === 409);
        setError(errorMessage(deleteError, 'The draft could not be deleted.'));
      }
    } finally {
      if (current()) setBusy(null);
    }
  };

  const reconcile = async (publication) => {
    if (reviewOnly || !publication?.operationId || busy) return;
    const generation = generationRef.current;
    const expectedRequestId = requestId;
    const context = captureActiveContext();
    const current = () => isActiveContext(generation, expectedRequestId, context);
    setBusy(`reconcile-${publication.operationId}`);
    setError(null);
    try {
      const result = await requestJson(`${basePath}/publications/${encodeURIComponent(publication.operationId)}/reconcile`, { method: 'POST', body: {}, fallbackMessage: 'Publication reconciliation could not be completed.' });
      if (!current()) return;
      setNotice(result.superseded
        ? 'This publication was verified, but a newer transcript is current. The newer transcript remains unchanged.'
        : result.requiresAttention
          ? 'This attempt still needs attention. You can close it and retain its files after the waiting period.'
          : result.publication?.state === 'published'
            ? 'Publication reconciled. Finalized downloads are available.'
            : 'Reconciliation checked the saved publication receipt.');
      await loadCollection({ keepDetail: true });
    } catch (reconcileError) {
      if (current()) setError(errorMessage(reconcileError, 'Publication reconciliation could not be completed.'));
    } finally {
      if (current()) setBusy(null);
    }
  };

  const closePublication = async (publication) => {
    if (reviewOnly || !publication?.operationId || closeAcknowledgedId !== publication.operationId || busy) return;
    const generation = generationRef.current;
    const expectedRequestId = requestId;
    const context = captureActiveContext();
    const current = () => isActiveContext(generation, expectedRequestId, context);
    setBusy(`close-${publication.operationId}`);
    setError(null);
    try {
      const result = await requestJson(`${basePath}/publications/${encodeURIComponent(publication.operationId)}/close`, {
        method: 'POST', body: { acknowledgeRetainedFiles: true },
        fallbackMessage: 'The publication attempt could not be safely closed.',
      });
      if (!current()) return;
      setCloseAcknowledgedId(null);
      setNotice(result.closed
        ? 'The attempt is closed. Candidate files, if any, remain in SharePoint and were not deleted.'
        : result.superseded
          ? 'The publication was verified, but a newer transcript is current. The newer transcript remains unchanged.'
          : result.requiresAttention
            ? 'The receipt still needs reconciliation. No candidate files were deleted.'
            : 'The publication was reconciled.');
      await loadCollection({ keepDetail: true });
    } catch (closeError) {
      if (current()) {
        setCloseAcknowledgedId(null);
        setConflict(closeError?.status === 409);
        setError(errorMessage(closeError, 'The publication attempt could not be safely closed.'));
        await loadCollection({ keepDetail: true });
        if (current()) setError(errorMessage(closeError, 'The publication attempt could not be safely closed.'));
      }
    } finally {
      if (current()) setBusy(null);
    }
  };

  if (!requestId) return null;
  if (loading && !collection) return <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5 sm:p-6" aria-labelledby="meeting-transcription-title"><h2 id="meeting-transcription-title" className="text-lg font-semibold text-gray-950">Meeting transcription</h2><div className="mt-4 h-16 animate-pulse rounded-lg bg-gray-100" aria-label="Loading meeting transcription" /></section>;
  if (collection && collection.featureState !== 'enabled') return (
    <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5 sm:p-6" data-testid="meeting-transcription-panel" aria-labelledby="meeting-transcription-title">
      <h2 id="meeting-transcription-title" className="text-lg font-semibold text-gray-950">Meeting transcription</h2>
      <p className="mt-2 text-sm leading-6 text-gray-700">Transcription is not available for this request. Existing recording links and transcript uploads are unchanged.</p>
    </section>
  );
  if (!collection) return (
    <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5 sm:p-6" data-testid="meeting-transcription-panel" aria-labelledby="meeting-transcription-title">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="meeting-transcription-title" className="text-lg font-semibold text-gray-950">Meeting transcription</h2><p className="mt-2 text-sm text-gray-700">Transcription availability could not be loaded for this request.</p></div><button type="button" onClick={() => void loadCollection()} disabled={loading} className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{loading ? 'Loading…' : 'Try again'}</button></div>
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
    </section>
  );

  const currentArtifact = reviewOnly ? null : collection?.currentArtifact || null;
  const visibleCorrectionDrafts = reviewOnly ? [] : collection?.correctionDrafts || [];
  const status = selectedJob?.status;
  const canReview = status === 'ready' && selectedJob?.contentAccessAllowed === true && Boolean(detail?.content);
  const unresolvedPublication = (collection?.publications || []).find((publication) => ['publishing', 'retryable', 'unknown', 'published_reconcile'].includes(publication.state));
  const alreadyPublished = (collection?.publications || []).some((publication) => publication.inputJobId === selectedJob?.id && ['published', 'published_reconcile', 'unknown'].includes(publication.state));
  const hasText = typeof detail?.content?.text === 'string' && detail.content.text.trim().length > 0;
  const publishBlockedReason = !utterances.length
    ? 'Publishing requires timed speaker turns. This text-only result can still be read and downloaded as a temporary TXT.'
    : unresolvedPublication ? 'Resolve the existing transcript publication before starting another publication.'
      : dirtyNames ? 'Save speaker-name changes before publishing.'
      : alreadyPublished ? 'This draft already has a publication. Reconcile it or review the published version before publishing again.'
        : status !== 'ready' ? 'Only a ready draft can be published.'
        : null;

  return (
    <section className="mt-8 min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6" data-testid="meeting-transcription-panel" aria-labelledby="meeting-transcription-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="meeting-transcription-title" className="text-lg font-semibold text-gray-950">Meeting transcription</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-700">{reviewOnly ? 'Review the synthetic transcript and save speaker display names.' : 'Upload an M4A or MP3 recording, review the temporary draft, then publish the finalized transcript when it is ready.'}</p>
        </div>
        <button type="button" onClick={() => void loadCollection({ keepDetail: true })} disabled={loading || Boolean(busy)} className="min-h-10 shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60">{loading ? 'Refreshing…' : 'Refresh status'}</button>
      </div>
      {error && <div className="mt-4 space-y-2"><Notice>{error}</Notice>{conflict && <button type="button" onClick={() => selectedJobId && void loadDetail(selectedJobId, { preserveDraft: true })} className="min-h-10 rounded-lg border border-amber-700 bg-white px-3 py-2 text-sm font-semibold text-amber-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700">Reload latest job</button>}</div>}
      {notice && <div className="mt-4"><Notice tone={notice.includes('unknown') || notice.includes('reconciliation') ? 'warning' : 'success'}>{notice}</Notice></div>}

      <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]">
        <div className="min-w-0 space-y-4">
          {!reviewOnly && <div>
            <h3 className="text-sm font-semibold text-gray-900">Upload a recording</h3>
            <p className="mt-1 text-xs leading-5 text-gray-600">Maximum 50 MiB. The file uploads directly to private storage and is sent to AssemblyAI when you start transcription. Do not upload sensitive material.</p>
            <label htmlFor="meeting-transcription-file" className="mt-3 block text-xs font-medium text-gray-700">Audio file</label>
            <input id="meeting-transcription-file" type="file" accept=".m4a,.mp3,audio/mp4,audio/x-m4a,audio/mpeg" disabled={Boolean(busy)} onChange={(event) => { setSelectedFile(event.target.files?.[0] || null); setError(null); }} className="mt-1 block w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:bg-gray-100" />
            {selectedFile && <p className="mt-2 break-all text-xs text-gray-700">{selectedFile.name} · {(selectedFile.size / (1024 * 1024)).toFixed(1)} MiB</p>}
            {uploadError && <p className="mt-2 text-sm text-red-800" role="alert">{uploadError}</p>}
            {selectedFile && (selectedFile.size < 1 || selectedFile.size > MAX_AUDIO_BYTES) && <p className="mt-2 text-sm text-red-800" role="alert">Choose an audio recording larger than 0 bytes and no larger than 50 MiB.</p>}
            <label htmlFor="meeting-transcription-region" className="mt-3 block text-xs font-medium text-gray-700">Provider region</label>
            <select id="meeting-transcription-region" value={providerRegion} disabled={Boolean(busy)} onChange={(event) => setProviderRegion(event.target.value)} className="mt-1 block min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"><option value="us">United States</option><option value="eu">European Union</option></select>
            <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-gray-800"><input type="checkbox" checked={acknowledged} disabled={Boolean(busy)} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-2 focus:ring-blue-600" /><span>I confirm the recording is non-sensitive and approved for third-party processing. I understand starting transcription may consume paid credits.</span></label>
            {uploadProgress !== null && <div className="mt-3" aria-live="polite"><div className="flex justify-between text-xs text-gray-700"><span>{uploadProgress < 100 ? 'Uploading to private storage' : 'Upload complete'}</span><span>{uploadProgress}%</span></div><progress className="mt-1 h-2 w-full accent-gray-900" max="100" value={uploadProgress} aria-label="Private audio upload progress" /></div>}
            <button type="button" onClick={uploadAndStart} disabled={!selectedFile || Boolean(uploadError) || selectedFile.size < 1 || selectedFile.size > MAX_AUDIO_BYTES || !acknowledged || Boolean(busy)} className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700">{busy === 'upload' ? 'Uploading…' : busy === 'starting' ? 'Starting transcription…' : 'Upload and start transcription'}</button>
          </div>}

          <div>
            <h3 className="text-sm font-semibold text-gray-900">Temporary drafts</h3>
            {loading && !jobs.length ? <p className="mt-2 text-sm text-gray-600">Loading drafts…</p> : jobs.length ? (
              <ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200">
                {jobs.map((job) => <li key={job.id}><button type="button" onClick={() => void loadDetail(job.id)} aria-current={job.id === selectedJobId ? 'true' : undefined} className={`flex min-h-14 w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-inset ${job.id === selectedJobId ? 'bg-gray-100' : 'hover:bg-gray-50'}`}><span className="min-w-0"><span className="block break-all text-sm font-medium text-gray-900">{job.original_filename || 'Audio recording'}</span><span className="text-xs text-gray-600">{job.ready_at ? `Ready ${new Date(job.ready_at).toLocaleString()}` : 'Temporary draft'}</span></span><span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-semibold ${jobTone(job.status)}`}>{job.label || JOB_STATE_LABELS[job.status] || 'Unknown status'}</span></button></li>)}
              </ul>
            ) : <p className="mt-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm leading-5 text-gray-700">No temporary drafts yet. Uploaded recordings appear here while processing and review.</p>}
          </div>

          {!reviewOnly && !!(collection?.publications || []).length && <div><h3 className="text-sm font-semibold text-gray-900">Publication status</h3><ul className="mt-2 space-y-2">{collection.publications.map((publication) => {
            const unresolved = ['publishing', 'retryable', 'unknown', 'published_reconcile'].includes(publication.state);
            const quarantinePassed = Boolean(publication.quarantineUntil) && new Date(publication.quarantineUntil).getTime() <= collectionCheckedAt
              && (!publication.leaseExpiresAt || new Date(publication.leaseExpiresAt).getTime() <= collectionCheckedAt);
            const label = publication.state === 'published' && publication.errorCode === 'publication_superseded'
              ? 'Published · superseded by a newer transcript'
              : publication.state === 'published' ? 'Published'
                : publication.state === 'closed' ? 'Closed · candidate files retained'
                  : publication.state === 'published_reconcile' ? 'Published · reconciliation needed'
                    : publication.state === 'unknown' ? 'Publication outcome unknown'
                      : publication.state === 'retryable' ? 'Publication can be retried'
                        : publication.state === 'publishing' ? 'Publication may still be running' : 'Publication status';
            return <li key={publication.operationId} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-950">{label}</p>
              {publication.errorCode && <p className="mt-1 break-all text-xs text-amber-900">Reference: {publication.errorCode}</p>}
              {unresolved && <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => void reconcile(publication)} disabled={Boolean(busy)} className="min-h-9 rounded-lg border border-amber-800 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:cursor-wait disabled:opacity-60">{busy === `reconcile-${publication.operationId}` ? 'Checking…' : 'Reconcile publication'}</button>
                {quarantinePassed && <button type="button" onClick={() => void closePublication(publication)} disabled={Boolean(busy) || closeAcknowledgedId !== publication.operationId} className="min-h-9 rounded-lg border border-gray-500 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-700 disabled:cursor-not-allowed disabled:opacity-50">{busy === `close-${publication.operationId}` ? 'Closing…' : 'Close attempt — keep files'}</button>}
              </div>}
              {unresolved && quarantinePassed && <div className="mt-2">
                <label className="flex items-start gap-2 text-xs leading-5 text-amber-950"><input type="checkbox" checked={closeAcknowledgedId === publication.operationId} disabled={Boolean(busy)} onChange={(event) => setCloseAcknowledgedId(event.target.checked ? publication.operationId : null)} className="mt-0.5 h-4 w-4 rounded border-amber-500 focus:ring-2 focus:ring-amber-700" /><span>Closing ends retries for this receipt. Any candidate SharePoint files will be retained, not deleted. The current transcript will not be changed.</span></label>
              </div>}
              {unresolved && !quarantinePassed && publication.quarantineUntil && <p className="mt-2 text-xs leading-5 text-amber-950">Close with files retained becomes available after {new Date(publication.quarantineUntil).toLocaleString()}, once its lease has expired.</p>}
            </li>;
          })}</ul></div>}
        </div>

        <div className="min-w-0">
          {!reviewOnly && currentArtifact && <section className="rounded-lg border border-green-200 bg-green-50 p-4" aria-labelledby="meeting-transcription-published-title"><h3 id="meeting-transcription-published-title" className="text-sm font-semibold text-green-950">Current published transcript</h3><p className="mt-1 break-all text-xs text-green-900">Current version · {currentArtifact.id}</p><div className="mt-3 flex flex-wrap gap-2"><a className="inline-flex min-h-9 items-center rounded-lg border border-green-800 bg-white px-3 py-1.5 text-sm font-medium text-green-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700" href={`${basePath}/materials/${encodeURIComponent(currentArtifact.id)}/download?format=txt`}>Download TXT</a><a className="inline-flex min-h-9 items-center rounded-lg border border-green-800 bg-white px-3 py-1.5 text-sm font-medium text-green-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700" href={`${basePath}/materials/${encodeURIComponent(currentArtifact.id)}/download?format=vtt`}>Download VTT</a>{currentArtifact.bundleEditable && <button type="button" onClick={beginCorrection} disabled={Boolean(busy)} className="inline-flex min-h-9 items-center rounded-lg border border-green-800 bg-white px-3 py-1.5 text-sm font-medium text-green-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700 disabled:opacity-50">{busy === 'create-correction' ? 'Creating correction…' : 'Correct transcript'}</button>}</div>{!currentArtifact.bundleEditable && <p className="mt-2 text-xs leading-5 text-green-950">This transcript can be downloaded but has no editable source bundle. A correction draft is not available.</p>}</section>}
          {!!visibleCorrectionDrafts.length && <section className="mt-4" aria-labelledby="meeting-transcription-corrections-title"><h3 id="meeting-transcription-corrections-title" className="text-sm font-semibold text-gray-900">Correction drafts</h3><ul className="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200">{visibleCorrectionDrafts.map((correction) => <li key={correction.operationId}><button type="button" onClick={() => void loadCorrection(correction.operationId)} aria-current={correction.operationId === selectedCorrectionId ? 'true' : undefined} className={`flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-inset ${correction.operationId === selectedCorrectionId ? 'bg-gray-100' : 'hover:bg-gray-50'}`}><span className="break-all text-sm font-medium text-gray-900">Correction · {correction.sourceRevisionId || 'current transcript'}</span><span className="shrink-0 text-xs text-gray-600">{correction.state === 'draft' ? 'Draft' : correction.state === 'published_reconcile' ? 'Reconciliation needed' : correction.state}</span></button></li>)}</ul></section>}
          {!selectedJob && <div className="rounded-lg bg-gray-50 px-4 py-8 text-center text-sm leading-6 text-gray-700">Choose a draft to review its processing state and transcript.</div>}
          {selectedJob && <section className="mt-4 min-w-0 rounded-lg border border-gray-200 p-4" aria-labelledby="meeting-transcription-review-title">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 id="meeting-transcription-review-title" className="break-words text-base font-semibold text-gray-950">{selectedJob.original_filename || 'Transcription draft'}</h3><p className="mt-1 text-sm text-gray-700">{JOB_STATE_LABELS[status] || selectedJob.label || 'Unknown status'}{selectedJob.needsAttention ? ' · Needs attention' : ''}</p></div><button type="button" onClick={() => void loadDetail(selectedJob.id, { preserveDraft: true })} disabled={Boolean(busy)} className="min-h-9 shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Reload draft</button></div>
            {status === 'submission_uncertain' && <div className="mt-4"><Notice tone="warning">The provider may have accepted this recording, but the result is not confirmed. Do not start another transcription for the same recording until this draft has been resolved.</Notice></div>}
            {ACTIVE_STATUSES.has(status) && <div className="mt-4"><Notice tone="info">Transcription is still processing. Refresh status to check for an update.</Notice></div>}
            {status === 'failed' && <div className="mt-4"><Notice>This draft could not be transcribed. You can delete it or contact an administrator if the problem continues.</Notice></div>}
            {status === 'expired' && <div className="mt-4"><Notice tone="warning">The temporary transcript has expired and its content is no longer available.</Notice></div>}
            {busy === 'loading-detail' && <div className="mt-4 h-20 animate-pulse rounded-lg bg-gray-100" aria-label="Loading draft details" />}
            {canReview && <>
              <p className="mt-3 text-xs text-gray-600">Temporary draft. It is not visible as a published Meeting Tracker material. {selectedJob.expires_at ? `Draft content expires ${new Date(selectedJob.expires_at).toLocaleString()}.` : ''}</p>
              <div className="mt-3 flex flex-wrap gap-2"><a className="inline-flex min-h-9 items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" href={`${basePath}/${encodeURIComponent(selectedJob.id)}/download?format=txt`}>Download draft TXT</a>{utterances.length > 0 && <a className="inline-flex min-h-9 items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" href={`${basePath}/${encodeURIComponent(selectedJob.id)}/download?format=vtt`}>Download draft VTT</a>}</div>
              <SpeakerEditor content={detail.content} candidates={sourceList} candidateSources={collection?.candidateSources} names={speakerNames} selectedSuggestions={selectedSuggestions} onSuggestionChange={(speaker, candidateId) => setSelectedSuggestions((current) => ({ ...current, [speaker]: candidateId }))} onNameChange={(speaker, name) => setSpeakerNames((current) => ({ ...current, [speaker]: name }))} disabled={Boolean(busy)} />
              <div className="mt-3 flex flex-wrap items-center gap-2"><span className="mr-auto text-xs text-gray-600">{dirtyNames ? 'Unsaved speaker-name changes' : 'Speaker names saved'}</span><button type="button" onClick={saveSpeakerNames} disabled={!dirtyNames || Boolean(busy)} className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500">{busy === 'speakers' ? 'Saving names…' : 'Save names'}</button><button type="button" onClick={publish} hidden={reviewOnly} disabled={Boolean(publishBlockedReason) || Boolean(busy)} className="min-h-10 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700">{busy === 'publish' ? 'Publishing…' : alreadyPublished ? 'Publication already started' : 'Publish transcript'}</button></div>
              {!reviewOnly && publishBlockedReason && <p className="mt-2 text-xs leading-5 text-gray-600">{publishBlockedReason}</p>}
              {hasText && <TranscriptContent content={detail.content} speakerNames={speakerNames} />}
            </>}
            {selectedJob.contentAccessAllowed === false && ['ready', 'failed', 'expired'].includes(status) && <p className="mt-4 text-sm text-gray-700">This temporary result is not currently readable.</p>}
            {!canReview && selectedJob.contentAccessAllowed !== false && !ACTIVE_STATUSES.has(status) && !['submission_uncertain', 'failed', 'expired'].includes(status) && <p className="mt-4 text-sm text-gray-700">Open this draft to load its current details.</p>}
            {status === 'ready' && <button type="button" onClick={deleteDraft} hidden={reviewOnly} disabled={Boolean(busy)} className="mt-4 min-h-9 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50">Delete temporary draft</button>}
          </section>}
          {correctionDetail?.correction?.operationId === selectedCorrectionId && <section className="mt-4 min-w-0 rounded-lg border border-gray-200 p-4" aria-labelledby="meeting-transcription-correction-title">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 id="meeting-transcription-correction-title" className="text-base font-semibold text-gray-950">Correct published transcript</h3><p className="mt-1 text-xs leading-5 text-gray-600">This draft keeps the original wording and timestamps. Changes here only update speaker display names.</p></div><button type="button" onClick={() => void loadCorrection(selectedCorrectionId, { preserveDraft: true })} disabled={Boolean(busy)} className="min-h-9 shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Reload correction</button></div>
            {correctionDetail.correction?.expiresAt && <p className="mt-2 text-xs text-gray-600">Correction draft expires {new Date(correctionDetail.correction.expiresAt).toLocaleString()}.</p>}
            {(correctionDetail.currentArtifact?.id !== correctionDetail.correction?.expectedCurrentArtifactId || correctionDetail.currentArtifact?.fingerprint !== correctionDetail.correction?.expectedCurrentFingerprint) && <div className="mt-3"><Notice tone="warning">The current published transcript changed after this correction draft was created. Start a new correction from the current version.</Notice></div>}
            <SpeakerEditor content={correctionContent} candidates={correctionDetail.candidates || sourceList} candidateSources={collection?.candidateSources} names={correctionNames} selectedSuggestions={correctionSuggestions} onSuggestionChange={(speaker, candidateId) => setCorrectionSuggestions((current) => ({ ...current, [speaker]: candidateId }))} onNameChange={(speaker, name) => setCorrectionNames((current) => ({ ...current, [speaker]: name }))} disabled={Boolean(busy) || correctionDetail.correction?.state !== 'draft'} />
            <div className="mt-3 flex flex-wrap items-center gap-2"><span className="mr-auto text-xs text-gray-600">{dirtyCorrectionNames ? 'Unsaved correction changes' : 'Correction labels saved'}</span><button type="button" onClick={saveCorrection} disabled={!dirtyCorrectionNames || Boolean(busy) || correctionDetail.correction?.state !== 'draft'} className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500">{busy === 'save-correction' ? 'Saving correction…' : 'Save correction'}</button><button type="button" onClick={publishCorrection} disabled={Boolean(busy) || dirtyCorrectionNames || !correctionSpeakerIds.length || correctionDetail.correction?.state !== 'draft' || correctionDetail.currentArtifact?.id !== correctionDetail.correction?.expectedCurrentArtifactId || correctionDetail.currentArtifact?.fingerprint !== correctionDetail.correction?.expectedCurrentFingerprint} className="min-h-10 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700">{busy === 'publish-correction' ? 'Publishing correction…' : 'Publish correction'}</button></div>
            {correctionDetail.content?.text && <TranscriptContent content={correctionContent} speakerNames={correctionNames} />}
          </section>}
          {conflict && <p className="mt-3 text-sm text-amber-950" role="alert">A version conflict was detected. Reload the latest saved version before saving names or publishing.</p>}
        </div>
      </div>
    </section>
  );
}

export default function MeetingTranscriptionPanel({ requestId, apiBasePath, reviewOnly = false }) {
  if (!requestId) return null;
  return <MeetingTranscriptionPanelForRequest key={`${requestId}:${apiBasePath || ''}:${reviewOnly ? 'review' : 'full'}`} requestId={requestId} apiBasePath={apiBasePath} reviewOnly={reviewOnly} />;
}
