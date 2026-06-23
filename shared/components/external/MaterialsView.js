/**
 * Stage 2b / submitted view — proposal-materials list + review-form upload.
 * Extracted unchanged from the prior monolithic ExternalReviewPage.ReadyPanel
 * so the dispatcher can route to it for `view === 'stage2b'` or
 * `view === 'submitted'`. Behavior preserved verbatim — this slice doesn't
 * touch the Stage 2b flow.
 */

import { useEffect, useRef, useState } from 'react';
import ReviewFormFields from './ReviewFormFields';

export default function MaterialsView({ data, token }) {
  const submitted = !!data.submission?.receivedAt;
  const headingRef = useRef(null);
  useEffect(() => {
    if (headingRef.current) headingRef.current.focus();
  }, []);
  return (
    <div className="space-y-6">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold text-gray-900 outline-none sr-only"
      >
        {submitted ? 'Review submitted' : 'Submit your review'}
      </h2>
      <ProposalCard data={data} />
      <FilesCard data={data} token={token} />
      {submitted && <SubmittedNotice data={data} />}
      <UploadCard data={data} token={token} alreadySubmitted={submitted} />
    </div>
  );
}

function ProposalCard({ data }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <p className="text-xs uppercase tracking-wide text-gray-500">Proposal</p>
      <h2 className="text-lg font-semibold text-gray-900 mt-1">{data.proposal.title}</h2>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-gray-500">Reviewer</p>
          <p className="text-gray-900">{data.reviewer.name || '—'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Submission deadline</p>
          <p className="text-gray-900">
            {data.tokenExpiresAt
              ? new Date(data.tokenExpiresAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
              : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}

function FilesCard({ data, token }) {
  if (!data.files || data.files.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="text-base font-semibold text-gray-900">Proposal materials</h3>
        <p className="text-sm text-gray-600 mt-2">
          The Foundation hasn&apos;t shared materials for this review yet. Please contact us if you need them.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-gray-900">Proposal materials</h3>
      <ul className="mt-3 divide-y divide-gray-100">
        {data.files.map((f) => {
          const downloadUrl = `/api/external/review/${encodeURIComponent(token)}/proposal?fileId=${encodeURIComponent(f.id)}&library=${encodeURIComponent(f.library)}`;
          return (
            <li key={`${f.library}::${f.id}`} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900 truncate">{f.name}</p>
                <p className="text-xs text-gray-500">{formatBytes(f.size)}</p>
              </div>
              <a
                href={downloadUrl}
                className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
              >
                Download
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SubmittedNotice({ data }) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
      <p className="text-sm font-semibold text-green-900">Review received</p>
      <p className="text-sm text-green-800 mt-1">
        We received your review on{' '}
        {new Date(data.submission.receivedAt).toLocaleString(undefined, {
          dateStyle: 'long',
          timeStyle: 'short',
        })}
        {data.submission.filename ? ` (${data.submission.filename})` : ''}.
        Re-uploading below will replace what you submitted.
      </p>
    </div>
  );
}

function UploadCard({ data, token, alreadySubmitted }) {
  const formRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState(null);
  const [infectedDetail, setInfectedDetail] = useState(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors(null);
    setInfectedDetail(null);
    setSuccess(false);

    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);

    const fileEntries = formData.getAll('files').filter((f) => f && f.size > 0);
    if (fileEntries.length === 0) {
      setErrors(['Please attach at least one file.']);
      return;
    }

    setSubmitting(true);
    try {
      const resp = await fetch(`/api/external/review/${encodeURIComponent(token)}/upload`, {
        method: 'POST',
        body: formData,
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.ok) {
        if (json.reason === 'infected') {
          // Form fields are uncontrolled and remain populated — the typed
          // review is preserved automatically. Surface a dedicated banner
          // so the reviewer understands the file was rejected (not their
          // review text) and what to do next.
          setInfectedDetail(Array.isArray(json.errors) ? json.errors : []);
        } else {
          setErrors(json.errors || [json.reason || 'Upload failed. Please try again.']);
        }
      } else {
        setSuccess(true);
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (e) {
      setErrors(['Network error. Please try again.']);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-gray-900">
        {alreadySubmitted ? 'Replace your submission' : 'Submit your review'}
      </h3>
      <p className="text-sm text-gray-600 mt-2">
        Upload up to 5 files (PDF, DOCX, or DOC). Each file must be under 25&nbsp;MB. Then complete the short form below.
      </p>

      <form ref={formRef} onSubmit={handleSubmit} className="mt-5 space-y-6">
        <div>
          <label htmlFor="ext-files" className="block text-sm font-semibold text-gray-900">
            Review file(s) <span className="text-red-600">*</span>
          </label>
          <input
            id="ext-files"
            name="files"
            type="file"
            accept=".pdf,.doc,.docx"
            multiple
            required
            disabled={submitting}
            className="mt-2 block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:bg-gray-900 file:text-white hover:file:bg-gray-800 disabled:opacity-50"
          />
        </div>

        <ReviewFormFields initialValues={data.prefill} disabled={submitting} idPrefix="ext" />

        {errors && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <p className="font-semibold">Please fix the following:</p>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              {errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {infectedDetail && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-900 space-y-2">
            <p className="font-semibold">We could not accept that file</p>
            <p>
              Our virus scanner flagged what you uploaded as potentially malicious, so it was not stored.
              Your typed review on this page has been preserved — please replace just the file and resubmit.
            </p>
            <p>
              Before uploading again, please run an antivirus scan on your computer.
              If you keep seeing this message with a file you believe is safe, contact The Foundation and we can help.
            </p>
            {infectedDetail.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-red-800 underline">Technical detail</summary>
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  {infectedDetail.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
            Submitted — thank you. Reloading…
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 disabled:bg-gray-400"
          >
            {submitting ? 'Uploading…' : alreadySubmitted ? 'Replace submission' : 'Submit review'}
          </button>
        </div>
      </form>
    </div>
  );
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
