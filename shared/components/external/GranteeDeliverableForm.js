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

// Publication-consent waiver wording. As of 2026-07-09 the LIVE text comes from
// the versioned `grantee-waiver` policy (rendered from `waiverPolicy.body`); this
// constant is only a last-resort fallback if the policy body is somehow absent
// (the context route fails closed, so on the edit view it normally isn't). The
// waiver remains a CLIENT-SIDE submit gate — the checkbox is never sent; the
// server records the acknowledged version (bound in `waiverToken`).
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
  const [waiver, setWaiver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  // An image is satisfied by a new upload OR one already on file (replacing is optional).
  const hasImage = imageFile != null || Boolean(init.hasImage);
  // The versioned waiver text + its binding token must be present to submit. The
  // context route fails closed, so on the edit view these are normally set; this
  // is a defensive gate against a partial payload.
  const waiverText = waiverPolicy?.body || WAIVER_LABEL;
  const canSubmit =
    waiver &&
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

      <label style={{ display: 'block', marginTop: '1rem' }}>
        <input type="checkbox" checked={waiver} onChange={(e) => setWaiver(e.target.checked)} />{' '}
        {waiverText}
      </label>

      {error && <p role="alert" style={{ color: '#b00' }}>{error}</p>}

      <button type="submit" disabled={!canSubmit} style={{ marginTop: '1rem' }}>
        {submitting ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  );
}
