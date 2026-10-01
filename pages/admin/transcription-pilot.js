import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import Layout from '../../shared/components/Layout';
import { AdminWorkspaceNavigation } from '../../shared/components/admin/AdminWorkspaceNavigation';
import { useAppAccess } from '../../shared/context/AppAccessContext';
import { useProfile } from '../../shared/context/ProfileContext';
import { requestEnvelope } from '../../shared/utils/api-request';
import { TRANSCRIPTION_JOB_LABELS } from '../../lib/services/transcription-pilot/model';

const API_ROOT = '/api/admin/transcription-pilot';
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const POLL_MS = 5000;
const IN_PROGRESS_STATUSES = new Set(['uploading', 'queued', 'submitting', 'processing', 'saving']);
const STATUS_LABELS = TRANSCRIPTION_JOB_LABELS;

export function isCurrentPilotGeneration(expected, current, expectedOwner, currentOwner) {
  return expected === current && expectedOwner === currentOwner;
}

export function validateAudioFile(file) {
  if (!file) return 'Choose an audio file.';
  if (file.size < 1 || file.size > MAX_AUDIO_BYTES) return 'Choose an audio file no larger than 50 MiB.';
  const extension = file.name.toLowerCase().split('.').pop();
  const acceptedTypes = extension === 'm4a'
    ? ['audio/mp4', 'audio/x-m4a']
    : extension === 'mp3'
      ? ['audio/mpeg']
      : [];
  if (!acceptedTypes.length) return 'Choose an M4A or MP3 file.';
  if (file.type && !acceptedTypes.includes(file.type)) return 'The selected file type does not match its M4A or MP3 extension.';
  return null;
}

export function formatAudioDuration(durationMs) {
  if (!Number.isFinite(Number(durationMs)) || Number(durationMs) < 0) return '—';
  const totalSeconds = Math.floor(Number(durationMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatTranscriptTimestamp(milliseconds) {
  if (!Number.isFinite(Number(milliseconds)) || Number(milliseconds) < 0) return '—';
  const totalSeconds = Math.floor(Number(milliseconds) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(Number(milliseconds) % 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function formatPilotDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function getEarliestReceiptExportDeadline(jobs, now = Date.now()) {
  const deadlines = (Array.isArray(jobs) ? jobs : [])
    .map((job) => Date.parse(job?.receipt_expires_at || ''))
    .filter((date) => Number.isFinite(date) && date > now);
  return deadlines.length ? new Date(Math.min(...deadlines)) : null;
}

async function pilotApi(url, options = {}) {
  const envelope = await requestEnvelope(url, { ...options, tolerantBody: true });
  const data = envelope.data && typeof envelope.data === 'object' ? envelope.data : {};
  if (!envelope.ok) {
    const error = new Error(data.message || data.error || `Request failed (${envelope.status || 'network error'}).`);
    error.code = data.code || null;
    error.status = envelope.status || 0;
    error.payload = data;
    throw error;
  }
  return data;
}

function statusTone(status) {
  if (status === 'ready') return 'green';
  if (status === 'failed' || status === 'expired') return 'gray';
  if (status === 'submission_uncertain') return 'amber';
  if (IN_PROGRESS_STATUSES.has(status)) return 'blue';
  return 'gray';
}

function StatusChip({ job }) {
  const label = STATUS_LABELS[job?.status] || 'Unknown status';
  const tone = statusTone(job?.status);
  const classes = {
    green: 'border-green-200 bg-green-50 text-green-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
    gray: 'border-gray-200 bg-gray-100 text-gray-700',
  };
  return <span className={`inline-flex min-h-6 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${classes[tone]}`}>{label}</span>;
}

function ErrorNotice({ children, id }) {
  if (!children) return null;
  return <div id={id} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-900">{children}</div>;
}

function InfoNotice({ children }) {
  return <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-800">{children}</div>;
}

function AudioUpload({
  busy,
  disabled,
  file,
  onFile,
  onStart,
  nonSensitiveAcknowledged,
  onNonSensitiveAcknowledged,
  creditsAcknowledged,
  onCreditsAcknowledged,
  progress,
  error,
  submissionsEnabled,
  message,
}) {
  return (
    <section aria-labelledby="transcription-upload-title" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="max-w-3xl">
        <h2 id="transcription-upload-title" className="text-lg font-semibold text-gray-950">Start a transcription</h2>
        <p className="mt-1 text-sm leading-6 text-gray-700">Use only an M4A or MP3 recording that contains no sensitive information and is approved for third-party processing.</p>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div>
          <label htmlFor="transcription-audio-file" className="block text-sm font-semibold text-gray-900">Recording</label>
          <input
            id="transcription-audio-file"
            type="file"
            accept=".m4a,.mp3,audio/mp4,audio/x-m4a,audio/mpeg"
            disabled={disabled || busy}
            onChange={(event) => onFile(event.target.files?.[0] || null)}
            className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-100"
          />
          <p className="mt-2 text-xs leading-5 text-gray-600">Maximum 50 MiB and four hours. Audio is uploaded directly to private storage; the browser does not send the recording through an app server request.</p>
          {file && <p className="mt-2 break-all text-sm text-gray-800">Selected: <span className="font-medium">{file.name}</span> · {(file.size / (1024 * 1024)).toFixed(1)} MiB</p>}

          <div className="mt-5 space-y-3">
            <label className="flex items-start gap-3 text-sm leading-5 text-gray-800">
              <input
                type="checkbox"
                checked={nonSensitiveAcknowledged}
                onChange={(event) => onNonSensitiveAcknowledged(event.target.checked)}
                disabled={disabled || busy}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-2 focus:ring-blue-600"
              />
              <span>I confirm this recording is non-sensitive and approved for third-party processing.</span>
            </label>
            <label className="flex items-start gap-3 text-sm leading-5 text-gray-800">
              <input
                type="checkbox"
                checked={creditsAcknowledged}
                onChange={(event) => onCreditsAcknowledged(event.target.checked)}
                disabled={disabled || busy}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-2 focus:ring-blue-600"
              />
              <span>I understand that starting transcription sends audio to AssemblyAI and may consume paid credits.</span>
            </label>
          </div>

          {progress !== null && (
            <div className="mt-4" aria-live="polite">
              <div className="flex items-center justify-between text-xs text-gray-700">
                <span>{progress < 100 ? 'Uploading to private storage' : 'Upload complete'}</span>
                <span>{progress}%</span>
              </div>
              <progress className="mt-1 h-2 w-full accent-gray-900" max="100" value={progress} aria-label="Audio upload progress" />
            </div>
          )}
          <ErrorNotice id="transcription-upload-error">{error}</ErrorNotice>
          {message && <p className="mt-3 text-sm leading-5 text-amber-900" role="status">{message}</p>}
          <button
            type="button"
            onClick={onStart}
            disabled={disabled || busy || !file || !nonSensitiveAcknowledged || !creditsAcknowledged || submissionsEnabled === false}
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700"
          >
            {busy ? 'Preparing and uploading…' : 'Upload and start transcription'}
          </button>
        </div>

        <aside className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950" aria-label="Pilot processing limits">
          <h3 className="font-semibold">Pilot limits</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>M4A or MP3 only</li>
            <li>50 MiB maximum</li>
            <li>Four hours maximum</li>
            <li>One provider job at a time</li>
          </ul>
          <p className="mt-3 border-t border-amber-200 pt-3 text-xs leading-5">The provider’s account-level retention settings have not been independently verified for this pilot. Do not upload confidential recordings.</p>
        </aside>
      </div>
    </section>
  );
}

function JobList({ jobs, selectedId, onSelect, loading, error, onRefresh }) {
  return (
    <section aria-labelledby="transcription-jobs-title" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="transcription-jobs-title" className="text-lg font-semibold text-gray-950">Your recordings</h2>
          <p className="mt-1 text-sm text-gray-700">Only jobs owned by your current profile are shown.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <ErrorNotice>{error}</ErrorNotice>
      {loading && jobs.length === 0 ? (
        <div className="mt-5 space-y-3" aria-label="Loading recordings">
          <div className="h-14 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-14 animate-pulse rounded-lg bg-gray-100" />
        </div>
      ) : jobs.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm leading-6 text-gray-800">No recordings yet. Upload a non-sensitive recording when you are ready to begin.</p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-200">
          {jobs.map((job) => {
            const active = job.id === selectedId;
            return (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => onSelect(job.id)}
                  aria-current={active ? 'true' : undefined}
                  className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${active ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-gray-950">{job.original_filename || 'Audio recording'}</span>
                    <span className="mt-1 block text-xs text-gray-600">{formatPilotDate(job.created_at)} · {formatAudioDuration(job.audio_duration_ms)}</span>
                  </span>
                  <StatusChip job={job} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function EvaluationForm({ job, draft, onDraft, onSave, saving, error }) {
  const editable = job.status === 'ready' && job.contentAccessAllowed === true
    && !job.cleanup_requested_at && !job.content_purged_at;
  const changed = Number(draft.wordAccuracyScore || 0) !== Number(job.word_accuracy_score || 0)
    || Number(draft.speakerAccuracyScore || 0) !== Number(job.speaker_accuracy_score || 0)
    || draft.correctionNotes !== (job.correction_notes || '');
  return (
    <section aria-labelledby="transcription-evaluation-title" className="border-t border-gray-200 pt-5">
      <h3 id="transcription-evaluation-title" className="text-base font-semibold text-gray-950">Evaluation</h3>
      <p className="mt-1 text-sm leading-5 text-gray-700">Numeric scores are retained for up to 30 days from ready. Free-text correction notes expire with the transcript content, no later than 7 days from ready.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {[
          ['wordAccuracyScore', 'Word accuracy'],
          ['speakerAccuracyScore', 'Speaker accuracy'],
        ].map(([key, label]) => (
          <label key={key} className="block text-sm font-medium text-gray-800">
            {label}
            <select
              value={draft[key]}
              onChange={(event) => onDraft({ ...draft, [key]: event.target.value })}
              disabled={!editable || saving}
              className="mt-1 block min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              <option value="">Not scored</option>
              {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score} / 5</option>)}
            </select>
          </label>
        ))}
      </div>
      <label htmlFor="transcription-correction-notes" className="mt-4 block text-sm font-medium text-gray-800">Correction examples or notes <span className="font-normal text-gray-600">(optional, 4,000 characters max)</span></label>
      <textarea
        id="transcription-correction-notes"
        rows={4}
        maxLength={4000}
        value={draft.correctionNotes}
        onChange={(event) => onDraft({ ...draft, correctionNotes: event.target.value })}
        disabled={!editable || saving}
        className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-900 focus:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-gray-100"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-gray-600">{draft.correctionNotes.length} / 4,000 characters</span>
        <button type="button" onClick={onSave} disabled={!editable || saving || !changed} className="min-h-10 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700">
          {saving ? 'Saving…' : 'Save evaluation'}
        </button>
      </div>
      <ErrorNotice>{error}</ErrorNotice>
      {!editable && <p className="mt-2 text-xs leading-5 text-gray-600">Evaluation is available only while a ready result and its receipt are available.</p>}
    </section>
  );
}

function TranscriptView({ job, transcript, processingDurationMs }) {
  const utterances = Array.isArray(transcript?.utterances) ? transcript.utterances : [];
  const hasTranscriptText = typeof transcript?.text === 'string' && transcript.text.length > 0;
  return (
    <section aria-labelledby="transcription-result-title" className="border-t border-gray-200 pt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="transcription-result-title" className="text-base font-semibold text-gray-950">Transcript</h3>
          <p className="mt-1 text-xs leading-5 text-gray-600">
            {formatAudioDuration(job.audio_duration_ms)} audio
            {processingDurationMs != null ? ` · ${formatAudioDuration(processingDurationMs)} processing` : ''}
            {' · '}Requested model: {job.requested_model || 'not reported'}
            {job.returned_model ? ` · Returned model: ${job.returned_model}` : ''}
          </p>
          <p className="mt-1 text-xs text-gray-600">Result expires {formatPilotDate(job.expires_at)}.</p>
        </div>
        {job.contentAccessAllowed === true && <div className="flex flex-wrap gap-2">
          <a href={`${API_ROOT}/jobs/${encodeURIComponent(job.id)}/download?format=txt`} className="inline-flex min-h-10 items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">Download TXT</a>
          <a href={`${API_ROOT}/jobs/${encodeURIComponent(job.id)}/download?format=vtt`} className="inline-flex min-h-10 items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">Download VTT</a>
        </div>}
      </div>
      {utterances.length > 0 ? (
        <ol className="mt-4 max-h-[34rem] divide-y divide-gray-200 overflow-y-auto rounded-lg border border-gray-200" aria-label="Timestamped transcript utterances">
          {utterances.map((utterance, index) => (
            <li key={`${utterance.start}-${utterance.end}-${index}`} className="grid gap-2 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <div className="text-xs font-medium tabular-nums text-gray-700">
                {formatTranscriptTimestamp(utterance.start)}–{formatTranscriptTimestamp(utterance.end)}
                {utterance.speaker ? <span className="mt-1 block text-gray-600">Speaker {utterance.speaker}</span> : null}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-900">{utterance.text || ''}</p>
            </li>
          ))}
        </ol>
      ) : hasTranscriptText ? (
        <pre className="mt-4 max-h-[34rem] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-4 font-sans text-sm leading-6 text-gray-900">{transcript.text}</pre>
      ) : (
        <p className="mt-4 rounded-lg bg-gray-50 px-4 py-4 text-sm leading-6 text-gray-800">
          {transcript?.outcome === 'no_speech' ? 'No speech was detected in this recording.' : 'No transcript text or utterances were returned.'}
        </p>
      )}
    </section>
  );
}

function RecoveryPanel({ job, onReconcile, onAbandon, busy, error }) {
  const [providerTranscriptId, setProviderTranscriptId] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const canReconcile = job.status === 'submission_uncertain'
    && !job.verificationReferenceExpired && !job.reference_purged_at;
  if (job.status !== 'submission_uncertain' && !job.needsAttention) return null;
  return (
    <section aria-labelledby="transcription-recovery-title" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h3 id="transcription-recovery-title" className="text-base font-semibold text-amber-950">Needs attention</h3>
      <p className="mt-1 text-sm leading-6 text-amber-950">The provider may have accepted this request, but the result is not confirmed. Do not submit the same recording again until this attempt is resolved.</p>
      {job.cleanup_requested_at ? (
        <>
          <p className="mt-3 text-sm leading-6 text-amber-950">Cleanup has been requested. If the verification reference remains available, you can verify this exact provider ID for cleanup only; this will not restore or publish a transcript.</p>
          {canReconcile && (
            <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); onReconcile(providerTranscriptId, true); }}>
              <label htmlFor="transcription-cleanup-provider-id" className="block text-sm font-medium text-amber-950">Provider transcript ID for cleanup</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input id="transcription-cleanup-provider-id" value={providerTranscriptId} onChange={(event) => setProviderTranscriptId(event.target.value)} maxLength={128} required disabled={busy} className="min-h-11 min-w-0 flex-1 rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm text-gray-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:cursor-not-allowed disabled:bg-gray-100" />
                <button type="submit" disabled={busy || !providerTranscriptId.trim()} className="min-h-11 rounded-lg border border-amber-700 bg-white px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Checking…' : 'Verify and clean up'}</button>
              </div>
              <p className="text-xs leading-5 text-amber-900">The server checks this ID against the uploaded audio and can request exact provider deletion. No transcript is retrieved or made available.</p>
            </form>
          )}
          {!canReconcile && (job.verificationReferenceExpired || job.reference_purged_at)
            && <p className="mt-2 text-sm text-amber-950">The verification reference has expired; only explicit abandonment can resolve this uncertain slot.</p>}
        </>
      ) : job.verificationReferenceExpired || job.reference_purged_at ? (
        <p className="mt-3 text-sm leading-6 text-amber-950">The verification reference has expired. The provider attempt cannot be verified automatically. You may explicitly abandon the attempt below; remote work may still be active.</p>
      ) : (
        <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); onReconcile(providerTranscriptId); }}>
          <label htmlFor="transcription-provider-id" className="block text-sm font-medium text-amber-950">Provider transcript ID</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="transcription-provider-id" value={providerTranscriptId} onChange={(event) => setProviderTranscriptId(event.target.value)} maxLength={128} required disabled={busy || !canReconcile} className="min-h-11 min-w-0 flex-1 rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm text-gray-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:cursor-not-allowed disabled:bg-gray-100" />
            <button type="submit" disabled={busy || !canReconcile || !providerTranscriptId.trim()} className="min-h-11 rounded-lg border border-amber-700 bg-white px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Checking…' : 'Verify provider attempt'}</button>
          </div>
          <p className="text-xs leading-5 text-amber-900">The server verifies this exact ID with AssemblyAI and checks that it belongs to this uploaded recording. Do not enter a URL.</p>
        </form>
      )}
      <div className="mt-4 border-t border-amber-300 pt-4">
        <label className="flex items-start gap-3 text-sm leading-5 text-amber-950">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 rounded border-amber-500 text-amber-900 focus:ring-2 focus:ring-amber-700" />
          <span>I understand provider work may still be active and a later submission could incur another charge.</span>
        </label>
        <button type="button" onClick={onAbandon} disabled={busy || !acknowledged} className="mt-3 min-h-10 rounded-lg border border-amber-700 bg-white px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">Abandon this attempt</button>
        <p className="mt-2 text-xs leading-5 text-amber-900">Abandoning does not contact or stop the provider. It records the uncertainty, requests cleanup, and releases the local pilot slot. It does not start another transcription.</p>
      </div>
      <ErrorNotice>{error}</ErrorNotice>
    </section>
  );
}

function JobDetail({ job, transcript, processingDurationMs, onSaveEvaluation, onReconcile, onAbandon, onDelete, onRetryStart, busy, actionError, actionMessage, evaluationDraft, onEvaluationDraft }) {
  if (!job) {
    return <section className="rounded-xl border border-gray-200 bg-white px-5 py-8 text-sm leading-6 text-gray-700" aria-live="polite">Select a recording to review its status and transcript.</section>;
  }
  const cleanupRequested = Boolean(job.cleanup_requested_at);
  return (
    <section aria-labelledby="transcription-job-detail-title" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="transcription-job-detail-title" className="break-words text-lg font-semibold text-gray-950">{job.original_filename || 'Audio recording'}</h2>
          <p className="mt-1 text-sm text-gray-700">Created {formatPilotDate(job.created_at)}</p>
        </div>
        <StatusChip job={job} />
      </div>
      {job.sanitized_error_code && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-900">Processing ended with code <code className="font-mono text-xs">{job.sanitized_error_code}</code>. No automatic resubmission was made.</p>}
      {job.failedContentDeleted && <p className="mt-3 text-sm leading-5 text-gray-800">Failed — content deleted.</p>}
      {job.verificationReferenceExpired && <p className="mt-3 text-sm leading-5 text-amber-950">Needs attention — the verification reference has expired.</p>}
      {job.status === 'expired' && <p className="mt-3 text-sm leading-5 text-gray-800">This result has expired and is no longer available.</p>}
      {cleanupRequested && (
        <InfoNotice>
          Cleanup was requested {formatPilotDate(job.cleanup_requested_at)}. This blocks further content access, but does not confirm immediate local erasure or provider cancellation.
          <span className="mt-1 block">Local cleanup: {job.local_cleanup_completed_at ? `confirmed ${formatPilotDate(job.local_cleanup_completed_at)}` : 'pending'}. Provider cleanup: {job.provider_cleanup_completed_at ? `confirmed ${formatPilotDate(job.provider_cleanup_completed_at)}` : 'pending or not confirmed'}.</span>
        </InfoNotice>
      )}
      {actionMessage && <div className="mt-4"><InfoNotice>{actionMessage}</InfoNotice></div>}
      <ErrorNotice>{actionError}</ErrorNotice>

      <div className="mt-5 space-y-5">
        {job.status === 'queued' && !cleanupRequested && (
          <div className="border-t border-gray-200 pt-4">
            <button type="button" onClick={onRetryStart} disabled={Boolean(busy)} className="min-h-10 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{busy === 'dispatch' ? 'Retrying start…' : 'Retry start'}</button>
            <p className="mt-2 text-xs leading-5 text-gray-700">Retries delivery of this existing queued job. It does not upload audio again or create another provider submission.</p>
          </div>
        )}
        {job.status === 'ready' && job.contentAccessAllowed === true && !cleanupRequested && !job.content_purged_at && transcript && (
          <TranscriptView job={job} transcript={transcript} processingDurationMs={processingDurationMs} />
        )}
        {job.status === 'ready' && job.contentAccessAllowed === true && !cleanupRequested && !job.content_purged_at && !transcript && (
          <p className="rounded-lg bg-gray-50 px-4 py-4 text-sm leading-6 text-gray-800">The transcript is not available yet. Refresh to check its current state.</p>
        )}
        {job.status === 'ready' && job.contentAccessAllowed === true && evaluationDraft && (
          <EvaluationForm job={job} draft={evaluationDraft} onDraft={onEvaluationDraft} onSave={onSaveEvaluation} saving={busy === 'evaluation'} error={busy === 'evaluation-error' ? actionError : null} />
        )}
        <RecoveryPanel key={job.id} job={job} onReconcile={onReconcile} onAbandon={onAbandon} busy={busy === 'recovery'} error={busy === 'recovery-error' ? actionError : null} />
        {!cleanupRequested && job.status !== 'expired' && (
          <div className="border-t border-gray-200 pt-4">
            <button type="button" onClick={onDelete} disabled={Boolean(busy)} className="min-h-10 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">Request deletion and cleanup</button>
            <p className="mt-2 text-xs leading-5 text-gray-700">This blocks access and requests cleanup. It does not promise immediate erasure or remote cancellation.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default function TranscriptionPilotPage() {
  const { data: session, status: sessionStatus } = useSession();
  const { currentProfile, status: profileStatus } = useProfile();
  const { isSuperuser, isLoading: accessLoading, error: accessError, refreshAccess } = useAppAccess();
  const profileId = currentProfile?.id == null ? null : String(currentProfile.id);
  const sessionProfileId = session?.user?.profileId == null ? null : String(session.user.profileId);
  const profileMatchesSession = Boolean(profileId && sessionProfileId && profileId === sessionProfileId);
  const ownerKey = isSuperuser && sessionStatus === 'authenticated' && profileMatchesSession ? sessionProfileId : null;
  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;
  const generationRef = useRef(0);
  const operationControllerRef = useRef(null);
  const evaluationDraftJobRef = useRef(null);
  const jobSnapshotsRef = useRef(new Map());
  const [pilotState, setPilotState] = useState('loading');
  const [submissionsEnabled, setSubmissionsEnabled] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const selectedJobIdRef = useRef(selectedId);
  selectedJobIdRef.current = selectedId;
  const [detail, setDetail] = useState(null);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);
  const [busy, setBusy] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [uploadMessage, setUploadMessage] = useState(null);
  const [nonSensitiveAcknowledged, setNonSensitiveAcknowledged] = useState(false);
  const [creditsAcknowledged, setCreditsAcknowledged] = useState(false);
  const [evaluationDraft, setEvaluationDraft] = useState(null);

  const authorized = Boolean(ownerKey && profileStatus === 'ready' && !accessLoading);
  const activeJob = detail?.job?.id === selectedId ? detail.job : null;
  const current = useCallback((generation, expectedOwner) => (
    isCurrentPilotGeneration(generation, generationRef.current, expectedOwner, ownerKeyRef.current)
  ), []);
  const rememberJob = useCallback((job) => {
    if (!job?.id || !Number.isFinite(Number(job.version))) return { job, stale: false };
    const version = Number(job.version);
    const existing = jobSnapshotsRef.current.get(job.id);
    if (existing && existing.version > version) return { job: existing.job, stale: true };
    jobSnapshotsRef.current.set(job.id, { version, job });
    return { job, stale: false };
  }, []);

  const loadJobs = useCallback(async ({ generation, expectedOwner, signal, quiet = false }) => {
    if (!quiet) setListLoading(true);
    setListError(null);
    try {
      const data = await pilotApi(`${API_ROOT}/jobs?limit=50`, { method: 'GET', signal });
      if (!current(generation, expectedOwner)) return;
      if (data.pilotEnabled !== true) {
        setPilotState('disabled');
        setSubmissionsEnabled(false);
        setJobs([]);
        setSelectedId(null);
        setDetail(null);
        return;
      }
      setPilotState('enabled');
      setSubmissionsEnabled(data.submissionsEnabled === true);
      const nextJobs = (Array.isArray(data.jobs) ? data.jobs : [])
        .map((job) => rememberJob(job).job);
      setJobs(nextJobs);
      setDetail((currentDetail) => {
        if (!currentDetail?.job?.id) return currentDetail;
        const latestJob = nextJobs.find((job) => job.id === currentDetail.job.id);
        if (!latestJob) return currentDetail;
        const canKeepTranscript = latestJob.status === 'ready'
          && latestJob.contentAccessAllowed === true
          && !latestJob.cleanup_requested_at
          && !latestJob.content_purged_at;
        return {
          ...currentDetail,
          job: latestJob,
          transcript: canKeepTranscript ? currentDetail.transcript : null,
        };
      });
      setSelectedId((currentId) => nextJobs.some((job) => job.id === currentId)
        ? currentId
        : (nextJobs[0]?.id || null));
    } catch (error) {
      if (!current(generation, expectedOwner) || error.name === 'AbortError') return;
      if (error.code === 'transcription_pilot_disabled') {
        setPilotState('disabled');
        setSubmissionsEnabled(false);
        setJobs([]);
        setSelectedId(null);
        setDetail(null);
      } else {
        setListError(error.message || 'Unable to load your recordings.');
        setPilotState('error');
      }
    } finally {
      if (current(generation, expectedOwner) && !quiet) setListLoading(false);
    }
  }, [current, rememberJob]);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    operationControllerRef.current?.abort();
    operationControllerRef.current = null;
    setJobs([]);
    setSelectedId(null);
    setDetail(null);
    setEvaluationDraft(null);
    evaluationDraftJobRef.current = null;
    selectedJobIdRef.current = null;
    setListError(null);
    setDetailError(null);
    setActionError(null);
    setActionMessage(null);
    setBusy(null);
    setSelectedFile(null);
    setUploadProgress(null);
    setUploadError(null);
    setUploadMessage(null);
    setNonSensitiveAcknowledged(false);
    setCreditsAcknowledged(false);
    setSubmissionsEnabled(null);
    jobSnapshotsRef.current.clear();
    if (!authorized || !ownerKey) {
      setPilotState('unavailable');
      setListLoading(false);
      return () => {
        controller.abort();
        if (generationRef.current === generation) generationRef.current += 1;
      };
    }
    setPilotState('loading');
    void loadJobs({ generation, expectedOwner: ownerKey, signal: controller.signal });
    return () => {
      controller.abort();
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [authorized, loadJobs, ownerKey]);

  const refresh = useCallback(() => {
    if (!ownerKey || pilotState !== 'enabled') return;
    void loadJobs({ generation: generationRef.current, expectedOwner: ownerKey });
  }, [loadJobs, ownerKey, pilotState]);

  useEffect(() => {
    setDetail(null);
    setDetailError(null);
    setEvaluationDraft(null);
    evaluationDraftJobRef.current = null;
    setActionError(null);
    setActionMessage(null);
    if (!ownerKey || !selectedId || pilotState !== 'enabled') {
      setDetailLoading(false);
      return undefined;
    }
    const generation = generationRef.current;
    const expectedOwner = ownerKey;
    const controller = new AbortController();
    let stopped = false;
    let inFlight = false;

    const loadDetail = async (quiet = false) => {
      if (inFlight || stopped) return;
      inFlight = true;
      if (!quiet) setDetailLoading(true);
      try {
        const data = await pilotApi(`${API_ROOT}/jobs/${encodeURIComponent(selectedId)}`, { method: 'GET', signal: controller.signal });
        if (!current(generation, expectedOwner) || stopped) return;
        const remembered = rememberJob(data.job);
        if (remembered.stale) return;
        const nextDetail = { job: remembered.job, transcript: data.transcript || null, processingDurationMs: data.processing_duration_ms ?? null };
        setDetail(nextDetail);
        setJobs((currentJobs) => currentJobs.map((job) => job.id === remembered.job.id ? remembered.job : job));
        if (evaluationDraftJobRef.current !== remembered.job.id) {
          evaluationDraftJobRef.current = remembered.job.id;
          setEvaluationDraft({
            wordAccuracyScore: remembered.job.word_accuracy_score == null ? '' : String(remembered.job.word_accuracy_score),
            speakerAccuracyScore: remembered.job.speaker_accuracy_score == null ? '' : String(remembered.job.speaker_accuracy_score),
            correctionNotes: remembered.job.correction_notes || '',
          });
        }
        setDetailError(null);
      } catch (error) {
        if (!current(generation, expectedOwner) || stopped || error.name === 'AbortError') return;
        setDetailError(error.message || 'Unable to load this recording.');
        if (error.code === 'transcription_pilot_disabled') {
          setPilotState('disabled');
          setJobs([]);
          setSelectedId(null);
          setDetail(null);
        }
      } finally {
        inFlight = false;
        if (current(generation, expectedOwner) && !stopped && !quiet) setDetailLoading(false);
      }
    };

    void loadDetail();
    const poll = window.setInterval(() => { void loadDetail(true); }, POLL_MS);
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(poll);
    };
  }, [current, ownerKey, pilotState, rememberJob, selectedId]);

  useEffect(() => {
    if (!ownerKey || pilotState !== 'enabled') return undefined;
    const generation = generationRef.current;
    const expectedOwner = ownerKey;
    const controller = new AbortController();
    const poll = window.setInterval(() => {
      void loadJobs({ generation, expectedOwner, signal: controller.signal, quiet: true });
    }, POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(poll);
    };
  }, [loadJobs, ownerKey, pilotState]);

  const selectFile = (file) => {
    setUploadError(file ? validateAudioFile(file) : null);
    setSelectedFile(file);
    setUploadProgress(null);
    setUploadMessage(null);
  };

  const startTranscription = async () => {
    if (!ownerKey || !selectedFile || !nonSensitiveAcknowledged || !creditsAcknowledged || submissionsEnabled !== true || busy) return;
    const validationError = validateAudioFile(selectedFile);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    const generation = generationRef.current;
    const expectedOwner = ownerKey;
    const controller = new AbortController();
    operationControllerRef.current?.abort();
    operationControllerRef.current = controller;
    setBusy('upload');
    setUploadError(null);
    setUploadMessage(null);
    setUploadProgress(0);
    try {
      const extension = selectedFile.name.toLowerCase().endsWith('.m4a') ? 'm4a' : 'mp3';
      const contentType = selectedFile.type || (extension === 'm4a' ? 'audio/mp4' : 'audio/mpeg');
      const idempotencyKey = globalThis.crypto?.randomUUID?.();
      if (!idempotencyKey) throw new Error('This browser cannot create a secure upload request. Use a current browser and try again.');
      const prepared = await pilotApi(`${API_ROOT}/jobs`, {
        method: 'POST',
        body: {
          filename: selectedFile.name,
          contentType,
          bytes: selectedFile.size,
          idempotencyKey,
          providerRegion: 'us',
        },
        signal: controller.signal,
      });
      if (!current(generation, expectedOwner)) return;
      const job = prepared.job;
      const upload = prepared.upload;
      if (!job?.id || !Number.isInteger(job.version)
        || typeof upload?.token !== 'string' || !upload.token
        || typeof upload?.pathname !== 'string' || !upload.pathname) {
        throw new Error('The private upload service returned an incomplete upload contract. Refresh the page before trying again.');
      }
      const { put } = await import('@vercel/blob/client');
      if (!current(generation, expectedOwner)) return;
      await put(upload.pathname, selectedFile, {
        access: 'private',
        token: upload.token,
        multipart: true,
        contentType,
        abortSignal: controller.signal,
        onUploadProgress: ({ percentage }) => {
          if (current(generation, expectedOwner)) setUploadProgress(Math.max(0, Math.min(100, Math.round(percentage))));
        },
      });
      if (!current(generation, expectedOwner)) return;
      setUploadProgress(100);
      setBusy('starting');
      const started = await pilotApi(`${API_ROOT}/jobs/${encodeURIComponent(job.id)}/start`, {
        method: 'POST',
        body: { expectedVersion: job.version, acknowledgeNonSensitive: true },
        signal: controller.signal,
      });
      if (!current(generation, expectedOwner)) return;
      const startedJob = rememberJob(started.job).job;
      setSelectedId(startedJob.id);
      setSelectedFile(null);
      setNonSensitiveAcknowledged(false);
      setCreditsAcknowledged(false);
      setUploadProgress(null);
      setUploadMessage('The recording was queued. You can leave this page; progress is saved.');
      await loadJobs({ generation, expectedOwner });
    } catch (error) {
      if (!current(generation, expectedOwner) || error.name === 'AbortError') return;
      if (error.code === 'transcription_pilot_disabled') {
        setPilotState('disabled');
        setSubmissionsEnabled(false);
        setJobs([]);
        setDetail(null);
        setUploadMessage('The transcription pilot is disabled. The uploaded file will remain subject to the server cleanup schedule.');
      } else if (error.code === 'transcription_submissions_disabled') {
        setSubmissionsEnabled(false);
        setUploadMessage('New submissions are disabled. The uploaded file remains subject to the server cleanup schedule.');
      } else if (error.code === 'transcription_dispatch_pending' && error.payload?.job?.id) {
        const queuedJob = rememberJob(error.payload.job).job;
        setJobs((currentJobs) => currentJobs.some((job) => job.id === queuedJob.id)
          ? currentJobs.map((job) => job.id === queuedJob.id ? queuedJob : job)
          : [queuedJob, ...currentJobs]);
        setSelectedId(queuedJob.id);
        setSelectedFile(null);
        setNonSensitiveAcknowledged(false);
        setCreditsAcknowledged(false);
        setUploadProgress(null);
        setUploadError('The upload is already queued, but background start delivery is still pending.');
        setUploadMessage('The uploaded recording is saved as this queued job. Use Retry start below; do not upload it again.');
      } else {
        setUploadError(error.message || 'The upload or start request could not be completed.');
        if (error.status === 0 || error.name === 'TypeError') {
          setUploadMessage('The server may not have confirmed the start request. Refresh your recordings before trying again.');
        }
      }
      if (pilotState === 'enabled') {
        void loadJobs({ generation, expectedOwner, quiet: true });
      }
    } finally {
      if (current(generation, expectedOwner)) setBusy(null);
      if (operationControllerRef.current === controller) operationControllerRef.current = null;
    }
  };

  const action = async ({ kind, url, method = 'POST', body, cleanupOnly = false, onSuccess, onFailure }) => {
    if (!ownerKey || !activeJob || busy) return;
    const generation = generationRef.current;
    const expectedOwner = ownerKey;
    const expectedJobId = activeJob.id;
    const controller = new AbortController();
    operationControllerRef.current?.abort();
    operationControllerRef.current = controller;
    setBusy(kind);
    if (selectedJobIdRef.current === expectedJobId) {
      setActionError(null);
      setActionMessage(null);
    }
    try {
      const result = await pilotApi(url, { method, body, signal: controller.signal });
      if (!current(generation, expectedOwner)) return;
      if (result.job) {
        const remembered = rememberJob(result.job).job;
        setDetail((currentDetail) => currentDetail?.job?.id === remembered.id
          ? { ...currentDetail, job: remembered, transcript: method === 'DELETE' ? null : currentDetail.transcript }
          : currentDetail);
        setJobs((currentJobs) => currentJobs.map((job) => job.id === remembered.id ? remembered : job));
        if (kind === 'evaluation' && selectedJobIdRef.current === expectedJobId) {
          evaluationDraftJobRef.current = remembered.id;
          setEvaluationDraft({
            wordAccuracyScore: remembered.word_accuracy_score == null ? '' : String(remembered.word_accuracy_score),
            speakerAccuracyScore: remembered.speaker_accuracy_score == null ? '' : String(remembered.speaker_accuracy_score),
            correctionNotes: remembered.correction_notes || '',
          });
        }
      }
      if (selectedJobIdRef.current === expectedJobId) {
        if (cleanupOnly && result.cleanupOnly === true) {
          setActionMessage('The provider attempt was verified for cleanup. No transcript was retrieved or restored.');
        }
        if (onSuccess) onSuccess(result);
      }
      await loadJobs({ generation, expectedOwner, quiet: true });
    } catch (error) {
      if (!current(generation, expectedOwner) || error.name === 'AbortError') return;
      if (selectedJobIdRef.current === expectedJobId) {
        setActionError(error.message || 'The action could not be completed.');
        if (onFailure) onFailure(error);
      }
      if (error.status === 409) {
        void loadJobs({ generation, expectedOwner, quiet: true });
      }
    } finally {
      if (current(generation, expectedOwner)) setBusy(null);
      if (operationControllerRef.current === controller) operationControllerRef.current = null;
    }
  };

  const saveEvaluation = () => {
    if (!activeJob || !evaluationDraft) return;
    void action({
      kind: 'evaluation',
      url: `${API_ROOT}/jobs/${encodeURIComponent(activeJob.id)}/evaluation`,
      method: 'PATCH',
      body: {
        expectedVersion: activeJob.version,
        wordAccuracyScore: evaluationDraft.wordAccuracyScore === '' ? null : Number(evaluationDraft.wordAccuracyScore),
        speakerAccuracyScore: evaluationDraft.speakerAccuracyScore === '' ? null : Number(evaluationDraft.speakerAccuracyScore),
        correctionNotes: evaluationDraft.correctionNotes,
      },
    });
  };

  const retryQueuedStart = () => {
    if (!activeJob || activeJob.status !== 'queued') return;
    void action({
      kind: 'dispatch',
      url: `${API_ROOT}/jobs/${encodeURIComponent(activeJob.id)}/start`,
      body: { expectedVersion: activeJob.version, acknowledgeNonSensitive: true },
      onSuccess: () => setActionMessage('Start delivery was accepted for this existing queued job. No audio was uploaded again.'),
      onFailure: (error) => {
        if (error.code === 'transcription_dispatch_pending' && error.payload?.job?.id === activeJob.id) {
          setActionMessage('Start delivery is still pending for this queued job. Retry start only retries delivery; it does not upload or submit the audio again.');
        }
      },
    });
  };

  const reconcile = (providerTranscriptId, cleanupOnly = false) => {
    if (!activeJob) return;
    const cleanupOnlyMode = cleanupOnly || Boolean(activeJob.cleanup_requested_at);
    void action({
      kind: 'recovery',
      url: `${API_ROOT}/jobs/${encodeURIComponent(activeJob.id)}/reconcile`,
      body: {
        expectedVersion: activeJob.version,
        providerTranscriptId: providerTranscriptId.trim(),
        ...(cleanupOnlyMode ? { mode: 'cleanup' } : {}),
      },
      cleanupOnly: cleanupOnlyMode,
    });
  };

  const abandon = () => {
    if (!activeJob || !window.confirm('Abandon this uncertain provider attempt? Provider work may still be active, and a later submission could incur another charge. This action does not start a new transcription.')) return;
    void action({
      kind: 'recovery',
      url: `${API_ROOT}/jobs/${encodeURIComponent(activeJob.id)}/abandon`,
      body: { expectedVersion: activeJob.version, acknowledgePotentialDuplicateCharge: true },
    });
  };

  const deleteJob = () => {
    if (!activeJob || !window.confirm('Request deletion and cleanup for this recording? This blocks access but does not confirm immediate erasure or provider cancellation.')) return;
    void action({
      kind: 'delete',
      url: `${API_ROOT}/jobs/${encodeURIComponent(activeJob.id)}`,
      method: 'DELETE',
      body: { expectedVersion: activeJob.version },
    });
  };

  const exportHref = `${API_ROOT}/evaluation-export`;
  const contextBusy = accessLoading || profileStatus === 'loading' || sessionStatus === 'loading';
  const profileError = profileStatus === 'error';
  const showDenied = !contextBusy && (!isSuperuser || !profileId || sessionStatus !== 'authenticated' || !profileMatchesSession);
  const visibleJobs = useMemo(() => ownerKey ? jobs : [], [jobs, ownerKey]);
  const exportDeadline = useMemo(() => getEarliestReceiptExportDeadline(visibleJobs), [visibleJobs]);

  return (
    <Layout title="Transcription Pilot · Admin" description="Non-sensitive audio transcription pilot for internal evaluation">
      <div className="py-6 sm:py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin" className="text-sm font-medium text-gray-700 underline decoration-gray-400 underline-offset-4 hover:text-gray-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">Back to Admin</Link>
          {authorized && pilotState === 'enabled' && <a href={exportHref} className="inline-flex min-h-10 items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">Export approved evaluation data</a>}
        </div>
        <AdminWorkspaceNavigation activeWorkspace="transcription-pilot" />
        <header className="mt-6 max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-950 sm:text-3xl">Transcription Pilot</h1>
          <p className="mt-2 text-sm leading-6 text-gray-700 sm:text-base">Compare timestamped transcripts and speaker separation from a small set of approved, non-sensitive recordings. Transcripts remain pilot evidence; they are not published to grant records.</p>
        </header>

        {contextBusy && <div className="mt-6 rounded-lg border border-gray-200 bg-white px-4 py-5 text-sm text-gray-700" role="status">Checking your Admin access…</div>}
        {profileError && <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900">Your staff profile could not be loaded. Refresh Admin access before opening owner-scoped pilot records.</div>}
        {showDenied && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950">
            <p className="font-semibold">A real superuser profile is required.</p>
            <p className="mt-1">Development profile selection without an authenticated staff profile cannot own transcription jobs.</p>
            {accessError && <button type="button" onClick={refreshAccess} className="mt-3 min-h-10 rounded-lg border border-amber-700 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700">Retry Admin access check</button>}
          </div>
        )}
        {authorized && pilotState === 'loading' && <div className="mt-6 rounded-lg border border-gray-200 bg-white px-4 py-5 text-sm text-gray-700" role="status">Checking pilot availability…</div>}
        {authorized && pilotState === 'disabled' && (
          <div className="mt-6 rounded-lg border border-gray-300 bg-white px-5 py-5">
            <h2 className="text-base font-semibold text-gray-950">Transcription pilot is disabled</h2>
            <p className="mt-1 text-sm leading-6 text-gray-700">The server pilot flag is off or this environment has not enabled the pilot. Existing jobs remain subject to server-side cleanup.</p>
          </div>
        )}
        {authorized && pilotState === 'error' && (
          <div className="mt-6 space-y-3">
            <ErrorNotice>{listError || 'Pilot status could not be confirmed.'}</ErrorNotice>
            <button type="button" onClick={() => { setPilotState('loading'); if (ownerKey) void loadJobs({ generation: generationRef.current, expectedOwner: ownerKey }); }} className="min-h-10 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Retry status check</button>
          </div>
        )}
        {authorized && pilotState === 'enabled' && (
          <div className="mt-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
              <span className="font-medium text-gray-900">Pilot: enabled</span>
              <span className={`font-medium ${submissionsEnabled ? 'text-green-800' : 'text-amber-900'}`}>New submissions: {submissionsEnabled ? 'enabled' : 'disabled'}</span>
              <span className="text-gray-700">Scores are retained for up to 30 days; free-text notes expire with content within 7 days.</span>
              <span className="text-gray-700">{exportDeadline
                ? `Export approved aggregate evidence by ${formatPilotDate(exportDeadline)} (earliest receipt expiry).`
                : 'No evaluation receipt expiry is currently available.'}</span>
            </div>
            <AudioUpload
              busy={Boolean(busy === 'upload' || busy === 'starting')}
              disabled={!submissionsEnabled}
              file={selectedFile}
              onFile={selectFile}
              onStart={startTranscription}
              nonSensitiveAcknowledged={nonSensitiveAcknowledged}
              onNonSensitiveAcknowledged={setNonSensitiveAcknowledged}
              creditsAcknowledged={creditsAcknowledged}
              onCreditsAcknowledged={setCreditsAcknowledged}
              progress={uploadProgress}
              error={uploadError}
              submissionsEnabled={submissionsEnabled}
              message={uploadMessage}
            />
            {!submissionsEnabled && <InfoNotice>New provider submissions are disabled. You can continue reviewing existing results and resolving attention items.</InfoNotice>}
            <div className="grid gap-6 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
              <JobList jobs={visibleJobs} selectedId={selectedId} onSelect={setSelectedId} loading={listLoading} error={listError} onRefresh={refresh} />
              <div className="space-y-4">
                {detailLoading && !activeJob && <div className="rounded-lg border border-gray-200 bg-white px-4 py-5 text-sm text-gray-700" role="status">Loading recording…</div>}
                {detailError && <ErrorNotice>{detailError}</ErrorNotice>}
                <JobDetail
                  job={activeJob}
                  transcript={detail?.transcript}
                  processingDurationMs={detail?.processingDurationMs}
                  onSaveEvaluation={saveEvaluation}
                  onReconcile={reconcile}
                  onAbandon={abandon}
                  onDelete={deleteJob}
                  onRetryStart={retryQueuedStart}
                  busy={busy}
                  actionError={actionError}
                  actionMessage={actionMessage}
                  evaluationDraft={evaluationDraft}
                  onEvaluationDraft={setEvaluationDraft}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
