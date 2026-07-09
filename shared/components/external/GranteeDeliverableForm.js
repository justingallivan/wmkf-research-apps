/**
 * Grantee deliverables edit form (chunk 4).
 *
 * Rendered in the `view === 'edit'` branch of pages/external/grantee/[token].js.
 * The grantee reviews/edits the AI-formatted abstract, uploads a graphical image
 * + caption, and acknowledges the publication-consent waiver. Per the design
 * (docs/GRANTEE_PORTAL_SPEC.md): the waiver is a CLIENT-SIDE SUBMIT GATE — the
 * checkbox enables the submit button and is NEVER sent/persisted; a submitted
 * package IS the consent record.
 *
 * Submit contract (implemented by chunk 5 — the submit route is not built yet):
 *   POST /api/external/grantee/{token}/submit  (multipart/form-data)
 *     editedAbstract: string   caption: string   image: File (optional if one is
 *     already on file). Returns { ok: true } on success.
 */

import { useState } from 'react';
import PolicyAckModal from './PolicyAckModal';

// Publication-consent waiver wording. As of 2026-07-09 the LIVE text comes from
// the versioned `grantee-waiver` policy (shown in the acknowledgment modal from
// `waiverPolicy.body`); this constant is only a last-resort fallback if the
// policy body is somehow absent (the context route fails closed, so on the edit
// view it normally isn't). The waiver remains a CLIENT-SIDE submit gate — the
// acknowledgment is never sent; the server records the acknowledged version
// (bound in `waiverToken`).
const WAIVER_LABEL =
  "By submitting, I give the W. M. Keck Foundation permission to publish the abstract, project title, my name and institution, and the image and caption I provide here in materials announcing this award, in print and online. I further confirm that I have the right to share the image I've uploaded.";

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp';

// Client-side size cap for a friendly pre-upload error. MUST match the server cap
// (MAX_IMAGE_BYTES in lib/services/grantee-upload.js) — the server is the
// enforcement of record; this is UX only.
const MAX_IMAGE_MB = 10;
const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;

// Visible text-box styling so the fields read as inputs (the surrounding page
// strips the default textarea border, leaving them white-on-white).
const FIELD_STYLE = {
  width: '100%',
  marginTop: '.25rem',
  padding: '.5rem',
  border: '1px solid #b0b0b0',
  borderRadius: 4,
  fontFamily: 'inherit',
  fontSize: '.95rem',
  boxSizing: 'border-box',
};

export default function GranteeDeliverableForm({ token, deliverable, waiverPolicy, waiverToken, onSubmitted }) {
  const init = deliverable || {};
  const [abstract, setAbstract] = useState(init.abstractApproved || init.abstractFormatted || '');
  const [caption, setCaption] = useState(init.caption || '');
  const [imageFile, setImageFile] = useState(null);
  const [waiverAcknowledged, setWaiverAcknowledged] = useState(false);
  const [waiverModalOpen, setWaiverModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  // An image is satisfied by a new upload OR one already on file (replacing is optional).
  const hasImage = imageFile != null || Boolean(init.hasImage);
  // The versioned waiver text + its binding token must be present to submit. The
  // context route fails closed, so on the edit view these are normally set; this
  // is a defensive gate against a partial payload.
  // The versioned waiver shown in the acknowledgment modal. Title/body/version
  // come from the `grantee-waiver` policy; WAIVER_LABEL is the last-resort body
  // fallback (context fails closed, so on the edit view the policy is present).
  const waiverModalPolicy = {
    title: waiverPolicy?.title || 'Publication consent',
    body: waiverPolicy?.body || WAIVER_LABEL,
    versionLabel: waiverPolicy?.versionLabel || '—',
  };
  const canSubmit =
    waiverAcknowledged &&
    Boolean(waiverToken) &&
    abstract.trim().length > 0 &&
    caption.trim().length > 0 &&
    hasImage &&
    !submitting;

  function handleImageChange(e) {
    const file = e.target.files?.[0] || null;
    if (file && file.size > MAX_IMAGE_BYTES) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_IMAGE_MB} MB. Please upload a smaller file.`);
      setImageFile(null);
      e.target.value = ''; // let the grantee re-select the same file after shrinking it
      return;
    }
    setError(null);
    setImageFile(file);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('editedAbstract', abstract);
      fd.append('caption', caption);
      // Echo the signed render token so the server records the exact waiver
      // version the grantee saw (server verifies + extracts the version id).
      if (waiverToken) fd.append('waiverToken', waiverToken);
      if (imageFile) fd.append('image', imageFile);
      const res = await fetch(`/api/external/grantee/${token}/submit`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || 'Submission failed. Please try again.');
        setSubmitting(false);
        return;
      }
      setDone(true);
      if (onSubmitted) onSubmitted();
    } catch {
      setError('Submission failed. Please try again.');
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <p>Thank you — your materials have been submitted. Foundation staff will review them.</p>
    );
  }

  return (
    <form onSubmit={handleSubmit} aria-label="grantee-deliverables">
      <p>Please review and edit the abstract below, upload a graphical image with a caption, and
        confirm the publication waiver to submit.</p>

      <label style={{ display: 'block', marginTop: '1rem' }}>
        <strong>Abstract</strong>
        <textarea
          aria-label="Abstract"
          value={abstract}
          onChange={(e) => setAbstract(e.target.value)}
          rows={12}
          placeholder="Review and edit your award abstract here."
          style={FIELD_STYLE}
        />
      </label>

      <label style={{ display: 'block', marginTop: '1rem' }}>
        <strong>Graphical image</strong>
        <input aria-label="Graphical image" type="file" accept={ACCEPTED_IMAGE_TYPES} onChange={handleImageChange} />
      </label>
      <p style={{ margin: '.25rem 0 0', fontSize: '.85rem', color: '#555' }}>
        JPEG, PNG, or WEBP (max {MAX_IMAGE_MB} MB) — not embedded in a Word or PowerPoint file. Use 16:9 for landscape photos.
      </p>
      {init.hasImage && !imageFile && (
        <p><em>An image is already on file; upload a new one only if you want to replace it.</em></p>
      )}

      <label style={{ display: 'block', marginTop: '1rem' }}>
        <strong>Image caption</strong>
        <textarea
          aria-label="Image caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={3}
          placeholder="Type a caption describing the image (required)."
          style={FIELD_STYLE}
        />
      </label>

      {/* Publication-consent waiver — read + acknowledge in a modal (mirrors the
          reviewer policy-acknowledgment UX). The acknowledgment is the client-side
          submit gate; the signed waiverToken (echoed on submit) is what records
          the acknowledged version server-side. */}
      <div style={{ marginTop: '1rem' }}>
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">{waiverModalPolicy.title}</h4>
            {waiverAcknowledged ? (
              <p className="text-xs text-green-700 mt-1">
                ✓ Acknowledged · v{waiverModalPolicy.versionLabel}{' '}
                <button
                  type="button"
                  onClick={() => setWaiverModalOpen(true)}
                  className="ml-2 text-xs text-gray-500 underline hover:text-gray-700"
                >
                  View again
                </button>
              </p>
            ) : (
              <p className="text-xs text-gray-500 mt-1">Read and acknowledge to submit.</p>
            )}
          </div>
          {!waiverAcknowledged && (
            <button
              type="button"
              onClick={() => setWaiverModalOpen(true)}
              className="flex-shrink-0 px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
            >
              Read waiver →
            </button>
          )}
        </div>
      </div>

      {error && <p role="alert" style={{ color: '#b00' }}>{error}</p>}

      {/* Prominent primary submit, matching the suite's primary buttons (e.g. the
          reviewer Stage 2a "Accept and continue"). Gated by `canSubmit`: abstract +
          caption filled, an image present, the waiver acknowledged, and the signed
          waiverToken — disabled state is visually distinct (greyed, not-allowed). */}
      <button
        type="submit"
        disabled={!canSubmit}
        className="mt-4 w-full sm:w-auto px-6 py-3 text-sm font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
      >
        {submitting ? 'Submitting…' : 'Submit'}
      </button>

      {waiverModalOpen && (
        <PolicyAckModal
          policy={waiverModalPolicy}
          isAcknowledged={waiverAcknowledged}
          onAcknowledge={() => { setWaiverAcknowledged(true); setWaiverModalOpen(false); }}
          onClose={() => setWaiverModalOpen(false)}
        />
      )}
    </form>
  );
}
