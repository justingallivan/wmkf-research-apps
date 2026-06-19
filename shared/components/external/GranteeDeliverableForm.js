/**
 * Grantee deliverables edit form (chunk 4).
 *
 * Rendered in the `view === 'edit'` branch of pages/external/grantee/[token].js.
 * The grantee reviews/edits the AI-formatted abstract, uploads a graphical image
 * + caption, and acknowledges the image-publication waiver. Per the design
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

// Interim waiver wording — exact legal text is an open item in the spec.
const WAIVER_LABEL =
  'I grant the W. M. Keck Foundation permission to publish the image above.';

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

export default function GranteeDeliverableForm({ token, deliverable, onSubmitted }) {
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
  const canSubmit =
    waiver &&
    abstract.trim().length > 0 &&
    caption.trim().length > 0 &&
    hasImage &&
    !submitting;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('editedAbstract', abstract);
      fd.append('caption', caption);
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
      <p>Thank you — your deliverables have been submitted. Foundation staff will review them.</p>
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
          style={{ width: '100%' }}
        />
      </label>

      <label style={{ display: 'block', marginTop: '1rem' }}>
        <strong>Graphical image</strong>
        <input aria-label="Graphical image" type="file" accept={ACCEPTED_IMAGE_TYPES} onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
      </label>
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
          style={{ width: '100%' }}
        />
      </label>

      <label style={{ display: 'block', marginTop: '1rem' }}>
        <input type="checkbox" checked={waiver} onChange={(e) => setWaiver(e.target.checked)} />{' '}
        {WAIVER_LABEL}
      </label>

      {error && <p role="alert" style={{ color: '#b00' }}>{error}</p>}

      <button type="submit" disabled={!canSubmit} style={{ marginTop: '1rem' }}>
        {submitting ? 'Submitting…' : 'Submit deliverables'}
      </button>
    </form>
  );
}
