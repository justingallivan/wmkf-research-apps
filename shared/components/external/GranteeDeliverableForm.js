/**
 * Grantee deliverables edit form (chunk 4).
 *
 * Rendered in the `view === 'edit'` branch of pages/external/grantee/[token].js.
 * The grantee reviews/edits the AI-formatted abstract, uploads a graphical image
 * + caption, and acknowledges the publication-consent waiver. Per the design
 * (docs/GRANTEE_PORTAL_SPEC.md): the acknowledgment is a CLIENT-SIDE SUBMIT
 * GATE, while a signed waiver render token binds the exact displayed policy
 * version/body hash to the request. The server verifies that token and persists
 * the version lookup, acknowledgment time, and body hash with the package.
 *
 * Submit contract: mint an actor-bound private Blob token, upload browser →
 * Blob, then POST a small JSON finalization payload. The image bytes never
 * traverse a Vercel Function request body.
 */

import { useRef, useState } from 'react';
import PolicyAckModal from './PolicyAckModal';
import GranteeAbstractEditor from './GranteeAbstractEditor';
import {
  MAX_GRANTEE_ABSTRACT_MARKDOWN_LENGTH,
  MAX_GRANTEE_CAPTION_MARKDOWN_LENGTH,
} from '../../config/granteeAbstract';

// Publication-consent waiver wording. As of 2026-07-09 the LIVE text comes from
// the versioned `grantee-waiver` policy (shown in the acknowledgment modal from
// `waiverPolicy.body`); this constant is only a last-resort fallback if the
// policy body is somehow absent (the context route fails closed, so on the edit
// view it normally isn't). The waiver remains a CLIENT-SIDE submit gate; the
// signed `waiverToken` is sent and the server records its bound version/body hash.
const WAIVER_LABEL =
  "By submitting, I give the W. M. Keck Foundation permission to publish the abstract, project title, my name and institution, and the image and caption I provide here in materials announcing this award, in print and online. I further confirm that I have the right to share the image I've uploaded.";

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp';
const ACCEPTED_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)$/i;
const ACCEPTED_IMAGE_TYPE_SET = new Set(ACCEPTED_IMAGE_TYPES.split(','));

// Client-side size cap for a friendly pre-upload error. MUST match the server cap
// (MAX_IMAGE_BYTES in lib/services/grantee-upload.js) — the server is the
// enforcement of record; this is UX only.
const MAX_IMAGE_MB = 10;
const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;

function isAcceptedImageFile(file) {
  if (!file) return true;
  if (file.type && ACCEPTED_IMAGE_TYPE_SET.has(file.type)) return true;
  return ACCEPTED_IMAGE_EXTENSIONS.test(file.name || '');
}

function declaredImageContentType(file) {
  if (file?.type && ACCEPTED_IMAGE_TYPE_SET.has(file.type)) return file.type;
  const name = file?.name || '';
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  return '';
}

function submitErrorMessage(data) {
  const reason = data?.reason;
  if (data?.error) return data.error;
  const imageTypes = 'JPEG, PNG, or WEBP';
  const messages = {
    image_invalid: `That image could not be accepted. Please upload a ${imageTypes} file, not a TIFF, HEIC, GIF, Word, or PowerPoint file.`,
    image_too_large: `That image is too large. Please upload a ${imageTypes} file under ${MAX_IMAGE_MB} MB.`,
    empty_image: `That image appears to be empty. Please upload a ${imageTypes} file under ${MAX_IMAGE_MB} MB.`,
    image_required: `Please upload a ${imageTypes} image before submitting.`,
    too_many_files: 'Please upload one image file only.',
    caption_required: 'Please add an image caption before submitting.',
    caption_too_long: 'The image caption is too long. Please shorten it and submit again.',
    abstract_required: 'Please include the abstract text before submitting.',
    abstract_too_long: 'The abstract is too long. Please shorten it and submit again.',
    waiver_invalid: 'Your publication-consent session expired. Please refresh the page, acknowledge the waiver again, and submit.',
    conflict: 'This page is out of date. Please refresh and try again.',
    not_editable: 'This request is no longer open for editing. Please contact Foundation staff for help.',
    sharepoint_failed: 'The image upload service was unavailable. Please try again in a few minutes.',
    scan_unavailable: 'The image safety scan was unavailable. Please try again in a few minutes.',
    staging_expired: 'The temporary image upload expired. Select Submit again to re-upload the selected image.',
    staging_not_found: 'The temporary image upload is no longer available. Select Submit again to re-upload the selected image.',
    staged_upload_missing: 'The temporary image could not be found. Select Submit again to re-upload the selected image.',
    staging_publicly_readable: 'The temporary image did not meet the private-storage requirement. Please select the image again and retry.',
    staging_privacy_unverified: 'The image privacy check is temporarily unavailable. Please try again in a few minutes.',
    finalize_in_progress: 'This submission is still being finalized. Please wait a moment and select Submit again.',
    reconciliation_unavailable: 'The prior save could not yet be confirmed safely. Please wait a moment and select Submit again.',
  };
  return messages[reason] || 'Submission failed. Please try again.';
}

export default function GranteeDeliverableForm({ token, deliverable, waiverPolicy, waiverToken, onSubmitted }) {
  const init = deliverable || {};
  const [abstract, setAbstract] = useState(init.abstractApproved || init.abstractFormatted || '');
  const [caption, setCaption] = useState(init.caption || '');
  const [imageFile, setImageFile] = useState(null);
  const [stagedUpload, setStagedUpload] = useState(null);
  const [waiverAcknowledged, setWaiverAcknowledged] = useState(false);
  const [waiverModalOpen, setWaiverModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const imageInputRef = useRef(null);

  // An image is satisfied by a new upload OR one already on file (replacing is optional).
  const hasImage = imageFile != null || Boolean(init.hasImage);
  const abstractOverLimit = abstract.length > MAX_GRANTEE_ABSTRACT_MARKDOWN_LENGTH;
  const captionOverLimit = caption.length > MAX_GRANTEE_CAPTION_MARKDOWN_LENGTH;
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
    !abstractOverLimit &&
    caption.trim().length > 0 &&
    !captionOverLimit &&
    hasImage &&
    !submitting;

  function handleImageChange(e) {
    const file = e.target.files?.[0] || null;
    if (file && !isAcceptedImageFile(file)) {
      setError('Please upload a JPEG, PNG, or WEBP image file. TIFF, HEIC, GIF, Word, and PowerPoint files cannot be submitted here.');
      setImageFile(null);
      e.target.value = ''; // let the grantee re-select the same file after converting it
      return;
    }
    if (file && file.size > MAX_IMAGE_BYTES) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_IMAGE_MB} MB. Please upload a smaller file.`);
      setImageFile(null);
      e.target.value = ''; // let the grantee re-select the same file after shrinking it
      return;
    }
    setError(null);
    setImageFile(file);
    setStagedUpload(null);
    setUploadProgress(null);
  }

  function reportUploadFailure(stage, category, httpStatus = null) {
    const status = Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
      ? httpStatus
      : null;
    void fetch(`/api/external/grantee/${token}/upload-failure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage,
        category,
        httpStatus: status,
        declaredBytes: imageFile?.size ?? null,
        contentType: imageFile ? declaredImageContentType(imageFile) : null,
      }),
      keepalive: true,
    }).catch(() => {});
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setUploadProgress(null);
    let activeStage = 'token_request';
    try {
      let staged = stagedUpload;
      if (imageFile && !staged) {
        const tokenRes = await fetch(`/api/external/grantee/${token}/upload-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: imageFile.name,
            contentType: declaredImageContentType(imageFile),
            size: imageFile.size,
          }),
        });
        const tokenData = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenData.ok) {
          if (tokenRes.status === 413) reportUploadFailure(activeStage, 'http_rejected', tokenRes.status);
          setError(submitErrorMessage(tokenData));
          setSubmitting(false);
          return;
        }
        activeStage = 'blob_put';
        const { put } = await import('@vercel/blob/client');
        await put(tokenData.pathname, imageFile, {
          access: 'private',
          token: tokenData.clientToken,
          contentType: tokenData.contentType,
          onUploadProgress: ({ percentage }) => setUploadProgress(Math.round(percentage)),
        });
        staged = { stagingId: tokenData.stagingId };
        setStagedUpload(staged);
      }

      activeStage = 'finalize';
      const res = await fetch(`/api/external/grantee/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          editedAbstract: abstract,
          caption,
          waiverToken,
          stagingId: staged?.stagingId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (res.status === 413) reportUploadFailure(activeStage, 'http_rejected', res.status);
        const terminalStaging = new Set([
          'staging_expired', 'staging_not_found', 'staged_upload_missing',
          'staging_publicly_readable', 'image_invalid', 'image_too_large',
          'empty_image', 'conflict', 'not_editable',
        ]);
        if (terminalStaging.has(data.reason)) setStagedUpload(null);
        if (['staging_publicly_readable', 'image_invalid', 'image_too_large', 'empty_image'].includes(data.reason)) {
          setImageFile(null);
          if (imageInputRef.current) imageInputRef.current.value = '';
        }
        setError(submitErrorMessage(data));
        setSubmitting(false);
        return;
      }
      setDone(true);
      setUploadProgress(null);
      if (onSubmitted) onSubmitted();
    } catch (caught) {
      const status = Number(caught?.status || caught?.statusCode);
      reportUploadFailure(
        activeStage,
        Number.isInteger(status) ? 'http_rejected' : (activeStage === 'blob_put' ? 'sdk_failure' : 'network'),
        status,
      );
      setError(activeStage === 'blob_put'
        ? 'The image could not be uploaded, so nothing was submitted. Please try again; if this repeats, contact Foundation staff.'
        : activeStage === 'finalize'
          ? 'The final confirmation could not be received. Please select Submit again; the uploaded image will be reused.'
          : 'The upload could not be prepared. Please try again; if this repeats, contact Foundation staff.');
      setUploadProgress(null);
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

      <div style={{ marginTop: '1rem' }}>
        <strong>Abstract</strong>
        <GranteeAbstractEditor
          ariaLabel="Abstract"
          value={abstract}
          htmlValue={init.abstractHtml || ''}
          onChange={setAbstract}
          required
          invalid={abstractOverLimit}
          maxLength={MAX_GRANTEE_ABSTRACT_MARKDOWN_LENGTH}
        />
      </div>

      <label style={{ display: 'block', marginTop: '1rem' }}>
        <strong>Graphical image</strong>
        <input
          ref={imageInputRef}
          aria-label="Graphical image"
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          onChange={handleImageChange}
          disabled={submitting}
        />
      </label>
      <p style={{ margin: '.25rem 0 0', fontSize: '.85rem', color: '#555' }}>
        JPEG, PNG, or WEBP (max {MAX_IMAGE_MB} MB) — not embedded in a Word or PowerPoint file. Use 16:9 for landscape photos.
      </p>
      {init.hasImage && !imageFile && (
        <p><em>An image is already on file; upload a new one only if you want to replace it.</em></p>
      )}

      <div style={{ marginTop: '1rem' }}>
        <strong>Image caption</strong>
        <GranteeAbstractEditor
          ariaLabel="Image caption"
          value={caption}
          htmlValue={init.captionHtml || ''}
          onChange={setCaption}
          required
          invalid={captionOverLimit}
          maxLength={MAX_GRANTEE_CAPTION_MARKDOWN_LENGTH}
          toolbarLabel="Caption formatting"
          compact
        />
      </div>

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

      {uploadProgress !== null && submitting && (
        <p role="status">Uploading image: {uploadProgress}%</p>
      )}
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
