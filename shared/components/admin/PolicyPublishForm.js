/** Policy draft editing, preview, confirmation, and publication. */
import { useState } from 'react';
import { renderPolicyMarkdown } from '../../utils/policy-markdown-client';
import { requestEnvelope } from '../../utils/api-request';
import { Button } from '../Layout';
import DiffBlock from './PolicyDiffBlock';

const INPUT_CLASS = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-gray-500';
const TEXTAREA_CLASS = `${INPUT_CLASS} font-mono`;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Labels are unique per slot (Dataverse alternate key; server-enforced).
// Comparison mirrors the server: trimmed, and case-insensitive like the
// Dataverse OData label lookup. slot.versions is capped at the 50 newest,
// so this set is advisory — the server remains the enforcer.
function takenLabelSet(versions) {
  return new Set((versions || []).map(v => (v.versionLabel || '').trim().toLowerCase()));
}

function isLabelTaken(label, taken) {
  return taken.has((label || '').trim().toLowerCase());
}

function suggestUniqueLabel(base, taken) {
  const root = (base || todayISO()).trim();
  if (!isLabelTaken(root, taken)) return root;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${root}-${i}`;
    if (candidate.length <= 50 && !isLabelTaken(candidate, taken)) return candidate;
  }
  return root;
}

function buildDiffSide(versionLabel, title, effectiveDate, body) {
  return {
    versionLabel,
    title,
    effectiveDate,
    bodyLength: (body || '').length,
    bodyExcerpt: (body || '').slice(0, 200),
  };
}

export default function PublishForm({ slot, onSuccess, onOutcome }) {
  const taken = takenLabelSet(slot.versions);
  const [versionLabel, setVersionLabel] = useState(() => suggestUniqueLabel(todayISO(), taken));
  const [title, setTitle] = useState(slot.activeVersion?.title || '');
  const [body, setBody] = useState(slot.activeVersion?.body || '');
  const [effectiveDate, setEffectiveDate] = useState(todayISO());
  const [submitting, setSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const resetToActive = () => {
    setTitle(slot.activeVersion?.title || '');
    setBody(slot.activeVersion?.body || '');
    setEffectiveDate(todayISO());
    setVersionLabel(suggestUniqueLabel(todayISO(), taken));
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      // D1 fix: a non-2xx body still carries a structured `data.status`
      // (label_conflict, concurrency_conflict, etc.) that STATUS_COPY
      // already renders correctly, so that path is unchanged. The bug was a
      // non-2xx body with NO `status` field (a plain `{error}` body, or an
      // unparseable gateway page) falling through to `onOutcome(data)` with
      // `status: undefined`, rendering a blank banner. That case now routes
      // to the same failed-outcome shape the catch below already uses
      // (docs/plans/CLIENT_REQUEST_LAYER_D1_UNGUARDED_RESPONSES_2026-09-20.md).
      const envelope = await requestEnvelope('/api/admin/policies', {
        method: 'POST',
        body: {
          slotCode: slot.code,
          versionLabel,
          title,
          body,
          effectiveDate,
          parentEtag: slot.parentEtag,
        },
      });
      const { data } = envelope;
      if (data.status === 'completed' || data.status === 'already_published') {
        onSuccess(data);
      } else if (!envelope.ok && !data.status) {
        onOutcome({ status: 'failed', warnings: [envelope.error.message] });
      } else {
        onOutcome(data);
      }
    } catch (err) {
      onOutcome({ status: 'failed', warnings: [err.message] });
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  };

  const bodyTooShort = body.length < 50;
  const labelTaken = isLabelTaken(versionLabel, taken);
  const suggestedLabel = suggestUniqueLabel(versionLabel, taken);
  const canPublish = !submitting && title.trim() && !bodyTooShort && versionLabel.trim();

  if (confirming) {
    const existing = slot.activeVersion
      ? buildDiffSide(slot.activeVersion.versionLabel, slot.activeVersion.title, slot.activeVersion.effectiveDate, slot.activeVersion.body)
      : null;
    const submitted = buildDiffSide(versionLabel, title, effectiveDate, body);
    const fieldsMatch = existing ? {
      title: existing.title === submitted.title,
      effectiveDate: existing.effectiveDate === submitted.effectiveDate,
      body: (slot.activeVersion.body || '') === body,
    } : undefined;

    return (
      <div className="space-y-3 rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-gray-800">
          Publish version <strong>{versionLabel}</strong>, effective {effectiveDate}? Published versions cannot be edited later.
        </p>
        {existing ? (
          <DiffBlock existing={existing} submitted={submitted} fieldsMatch={fieldsMatch} />
        ) : (
          <p className="text-xs text-gray-500">This will be the first version.</p>
        )}
        <div className="flex items-center gap-2">
          <Button type="button" variant="primary" size="sm" onClick={submit} disabled={submitting}>
            {submitting ? 'Publishing…' : 'Publish'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={submitting}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium text-gray-700">
          Version label
          <input
            value={versionLabel}
            onChange={e => setVersionLabel(e.target.value)}
            maxLength={50}
            className={`mt-1 ${INPUT_CLASS}`}
          />
          {labelTaken && (
            <span className="mt-1 block text-xs text-amber-700">
              Already used by a published version. Identical content is a no-op; changed
              content will be rejected — versions are immutable.{' '}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setVersionLabel(suggestedLabel)}
                className="mt-1"
              >
                Use “{suggestedLabel}”
              </Button>
            </span>
          )}
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Effective date
          <input
            type="date"
            value={effectiveDate}
            onChange={e => setEffectiveDate(e.target.value)}
            className={`mt-1 ${INPUT_CLASS}`}
          />
        </label>
      </div>

      <label className="block text-sm font-medium text-gray-700">
        Title
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={300}
          className={`mt-1 ${INPUT_CLASS}`}
        />
      </label>

      <label className="block text-sm font-medium text-gray-700">
        Body (markdown)
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={12}
          maxLength={64 * 1024}
          className={`mt-1 ${TEXTAREA_CLASS}`}
          placeholder="Paste or write the policy text. Markdown is supported (headings, lists, bold/italic, links). Raw HTML is rejected by the server."
        />
        <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
          <span>{body.length} chars (min 50)</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen(p => !p)}>
            {previewOpen ? 'Hide preview' : 'Show preview'}
          </Button>
        </div>
      </label>

      {previewOpen && (
        <div className="rounded-lg border border-gray-200 p-3 bg-white">
          <div className="text-xs uppercase text-gray-500 mb-2">Preview</div>
          <div
            className="prose prose-sm max-w-none text-gray-800"
            dangerouslySetInnerHTML={/* nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml -- renderPolicyMarkdown sanitizes via DOMPurify strict allowlist; server validator rejects raw HTML */ { __html: renderPolicyMarkdown(body) }}
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={resetToActive}
          disabled={!slot.activeVersion}
        >
          Reset to active version
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => setConfirming(true)}
          disabled={!canPublish}
        >
          Publish
        </Button>
      </div>
    </div>
  );
}
