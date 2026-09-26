/**
 * Reviewer-upload file copy planning for the Test Request Factory `reviews`
 * recipe (slice 6c-ii Stage C). Sibling to `bundle-file-copy.js` (which stays
 * scoped to the Basic recipe's PDF/XLSX documents, per its own module
 * docblock and P3, Opus round 1, 6c-ii Stage A: `planBundleFileCopies` and
 * the Basic manifest count check read only `bundle.documents`, never
 * `bundle.reviewers[].files`).
 *
 * Design doc: docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md,
 * "Recipe dimension (slice 6c-i, mirrors 6a)" and the Stage C brief's C1.
 *
 * Planning is pure; the copy step (`copy_review_file` in run-runner.js) owns
 * journaling the per-review attempt id and dispatching through
 * `copyBundleFiles` (bundle-file-copy.js), reusing that engine's per-MIME
 * integrity mode (mimeType-derived: PDF/DOC stay exact-hash, DOCX switches
 * to `attestDocxPackageAgainstSource`) unchanged.
 */

import crypto from 'node:crypto';
import { COPY_DESTINATION_LIBRARY } from './bundle-file-copy.js';
import { buildReviewerSubfolder } from '../reviewer-subfolder.js';

/**
 * Write policy for the reviews recipe's file copies -- deliberately SEPARATE
 * from `SANDBOX_REHEARSAL_COPY_POLICY` (Basic recipe, PDF/XLSX only, no
 * kind<->extension<->MIME binding needed because it never carries a
 * `reviewerUpload` document). This policy binds every allowed extension to
 * exactly one MIME type, closing the gap Codex adversarial round 1 (slice
 * 6c-i) found: a DOCX-shaped MIME under a `.pdf` destination would otherwise
 * be accepted by extension alone.
 */
export const REVIEW_FILE_COPY_POLICY = Object.freeze({
  version: 'reviews-copy-2026-09-25-r2',
  allowedKinds: Object.freeze(['reviewerUpload']),
  extensionMimeTypes: Object.freeze({
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
  }),
  // The uploader's own per-review limit (review-upload.js:50-51).
  maxFilesPerReview: 5,
  // Reconciled with the terminal census (Codex slice review round 2): the
  // verifier's folder census is bounded at SHAREPOINT_CENSUS_DEFAULTS.maxFiles
  // (100) and fails closed past it, so maxReviewers * maxFilesPerReview plus
  // the Basic copy policy's maxFiles plus the two Initial Assessment files
  // must fit under it -- otherwise a plan the reservation accepts could
  // never verify. tests/unit/test-request-review-file-copy.test.js pins the
  // arithmetic against the live constants. (The ledger's own 100-row
  // assignment ceiling is a serialization bound, not a plan bound.)
  maxReviewers: 10,
  maxFileBytes: 25 * 1024 * 1024,
  // NOT maxReviewers * maxFilesPerReview * maxFileBytes (100 * 5 * 25 MB =
  // 12.5 GB): an unreconciled ceiling nobody would actually hit, and one
  // that would let a single run hold gigabytes of confidential reviewer
  // content in flight at once. 250 MB is a stated, defensible total for the
  // sandbox rehearsal CLI -- comfortably above any real request-shaped run
  // (1003222's two uploaded reviews, one file each) while still bounding a
  // pathological bundle to something this process can hold in memory
  // alongside the DOCX package-attestation budget.
  maxTotalBytes: 250 * 1024 * 1024,
});

export function reviewFileCopyPolicyDigest(policy = REVIEW_FILE_COPY_POLICY) {
  return crypto.createHash('sha256').update(JSON.stringify(policy)).digest('hex');
}

function extensionOf(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(String(filename || ''));
  return match ? match[1].toLowerCase() : null;
}

/**
 * Structural kind/extension/MIME validation at PLAN time (before any bytes
 * are downloaded -- the bundle carries only metadata and a content hash,
 * never raw bytes). The byte-level half (magic-byte sniff of the actual
 * downloaded bytes) runs later, inside the copy step: `stepCopyReviewFile`
 * (run-runner.js) supplies a `validateBytes` hook that `copyOne`
 * (bundle-file-copy.js) calls with `validateReviewFile` (file-magic.js) on
 * the verified source buffer, before `ensureFolderPath`/upload -- refusing
 * with the `file_rejected` reason code (Opus round 1, P1-2; prior to that
 * fix this docblock's claim was aspirational, not real).
 */
function assertReviewFilePolicy(file, policy) {
  if (!policy.allowedKinds.includes(file.kind)) {
    throw new Error(`Review file ${file.name} has an unsupported kind (${file.kind}).`);
  }
  const ext = extensionOf(file.name);
  const expectedMime = ext && policy.extensionMimeTypes[ext];
  if (!expectedMime) {
    throw new Error(`Review file ${file.name} has an unsupported extension.`);
  }
  if (file.mimeType !== expectedMime) {
    throw new Error(`Review file ${file.name} MIME type (${file.mimeType}) does not match its extension (.${ext}).`);
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > policy.maxFileBytes) {
    throw new Error(`Review file ${file.name} size is invalid or exceeds the ${policy.maxFileBytes}-byte ceiling.`);
  }
}

const ATTEMPT_ID = /^[0-9a-f]{32}$/;

/**
 * The per-review, per-file policy checks shared by `planOneReviewerFiles`
 * (which also needs destination data to plan copies) and
 * `validateReviewFilePlan` (which validates the SAME bundle-derived checks
 * at reservation time, before any destination identity exists). Returns the
 * reviewer's files unchanged (or `[]` for a reviewer with none -- e.g.
 * `received_no_file`/`unreceived`, which have nothing to check).
 */
function validateReviewerFiles(bundleReviewer, policy) {
  const files = Array.isArray(bundleReviewer?.files) ? bundleReviewer.files : [];
  if (files.length === 0) return [];
  if (files.length > policy.maxFilesPerReview) {
    throw new Error(`Reviewer has ${files.length} files, exceeding the ${policy.maxFilesPerReview}-file-per-review ceiling.`);
  }
  for (const file of files) assertReviewFilePolicy(file, policy);
  return files;
}

/**
 * Plan the destination copies for one reviewer's uploaded files.
 * `review` is `{ sourcePersonId, destinationSuggestionId, destinationPersonName, attemptId }`:
 *   - `destinationPersonName` is `{ wmkf_lastname, wmkf_name }` (or
 *     equivalent), exactly what `buildReviewerSubfolder` reads;
 *   - `attemptId` is the 32-hex attempt id the copy step journals once per
 *     review BEFORE calling this planner (stable across resumes: read from
 *     the ledger resource if already journaled, else generated and
 *     journaled first) -- this function is pure and never journals.
 * Files are ordered exactly as the bundle carries them (primary file first
 * -- source-bundle-reviewers.js orders the source's own primary filename
 * first); ordinal `n` = array index + 1, `n` in 1..maxFilesPerReview.
 */
function planOneReviewerFiles(bundleReviewer, review, policy) {
  const files = validateReviewerFiles(bundleReviewer, policy);
  if (files.length === 0) return [];
  if (!ATTEMPT_ID.test(String(review.attemptId || ''))) {
    throw new Error('Review file plan requires a 32-hex attempt id.');
  }
  if (!review.destinationSuggestionId) {
    throw new Error('Review file plan requires a destination suggestion id.');
  }
  const subfolder = buildReviewerSubfolder(review.destinationSuggestionId, review.destinationPersonName || null);
  const folder = `Reviewer_Uploads/${subfolder}/attempt_${review.attemptId}`;
  return files.map((file, index) => {
    const ext = extensionOf(file.name);
    return {
      kind: 'reviewerUpload',
      source: { ...file },
      destination: {
        library: COPY_DESTINATION_LIBRARY,
        folder,
        filename: `Review_${index + 1}.${ext}`,
      },
    };
  });
}

/**
 * Validate the review-file policy for a bundle's uploaded reviewers WITHOUT
 * any destination data (no suggestion id, person name, or attempt id exists
 * yet at reservation time). Shares `validateReviewerFiles`'s per-review/
 * per-file checks with `planOneReviewerFiles`, plus the same reviewer-count
 * and total-bytes ceilings `planReviewFileCopies` enforces, so a bundle that
 * would later fail to plan is refused before the manifest or ledger
 * reservation is ever written (F2, Codex slice 6c-ii Stage C round 1).
 * `sourcePersonIds` is every reviewer assignment's source person id
 * (unfiltered): a reviewer whose bundle entry's `reviewForm` is not
 * `uploaded` -- i.e. a `received_no_file`/`unreceived` review -- contributes
 * nothing to the check, exactly as `copy_review_file`'s own
 * `uploadedAssignments` filter (run-runner.js) skips it and never plans it,
 * REGARDLESS of whether its bundle entry happens to carry a non-empty
 * `files` array (an inconsistent bundle a plan-time check must not
 * over-refuse for data the copy step will never read).
 */
export function validateReviewFilePlan(bundle, sourcePersonIds, policy = REVIEW_FILE_COPY_POLICY) {
  const reviewers = Array.isArray(bundle?.reviewers) ? bundle.reviewers : null;
  if (!reviewers) throw new Error('Source bundle reviewers are missing.');
  if (!Array.isArray(sourcePersonIds)) throw new Error('Review file plan validation requires a sourcePersonIds array.');
  if (sourcePersonIds.length > policy.maxReviewers) {
    throw new Error(`${sourcePersonIds.length} reviewer(s) exceeds the ${policy.maxReviewers}-reviewer ceiling.`);
  }
  let totalBytes = 0;
  for (const sourcePersonId of sourcePersonIds) {
    const bundleReviewer = reviewers.find(
      (candidate) => String(candidate.personId).toLowerCase() === String(sourcePersonId).toLowerCase(),
    );
    if (!bundleReviewer) throw new Error(`Source bundle has no reviewer for person ${sourcePersonId}.`);
    if (bundleReviewer.reviewForm !== 'uploaded') continue;
    const files = validateReviewerFiles(bundleReviewer, policy);
    for (const file of files) totalBytes += file.size;
  }
  if (totalBytes > policy.maxTotalBytes) {
    throw new Error(`Review file plan totals ${totalBytes} bytes, exceeding the ${policy.maxTotalBytes}-byte ceiling.`);
  }
}

/**
 * Plan every reviewer-file copy for the bundle (plan "Recipe
 * dimension"/"Seeder" 3a): one plan entry per file, grouped by review,
 * reusing `copyBundleFiles`'s generic `{kind, source, destination}` shape so
 * the copy step dispatches reviewer files through the exact same engine
 * (and its per-MIME integrity mode) as the Basic recipe's documents.
 *
 * `reviews` is an array of the shape documented on `planOneReviewerFiles`
 * above, one entry per reviewer whose review form is `uploaded` -- the
 * caller (the runner) excludes `received_no_file`/`unreceived` reviewers,
 * since they have no files to plan.
 */
export function planReviewFileCopies(bundle, { reviews }, policy = REVIEW_FILE_COPY_POLICY) {
  const reviewers = Array.isArray(bundle?.reviewers) ? bundle.reviewers : null;
  if (!reviewers) throw new Error('Source bundle reviewers are missing.');
  if (!Array.isArray(reviews)) throw new Error('Review file plan requires a reviews array.');
  if (reviews.length > policy.maxReviewers) {
    throw new Error(`${reviews.length} reviewer(s) exceeds the ${policy.maxReviewers}-reviewer ceiling.`);
  }
  const plan = [];
  let totalBytes = 0;
  const seenFolders = new Set();
  for (const review of reviews) {
    const bundleReviewer = reviewers.find(
      (candidate) => String(candidate.personId).toLowerCase() === String(review.sourcePersonId).toLowerCase(),
    );
    if (!bundleReviewer) throw new Error(`Source bundle has no reviewer for person ${review.sourcePersonId}.`);
    const files = planOneReviewerFiles(bundleReviewer, review, policy);
    if (files.length === 0) continue;
    const folderKey = files[0].destination.folder.toLowerCase();
    if (seenFolders.has(folderKey)) throw new Error(`Two reviewers resolve to the same destination folder (${folderKey}).`);
    seenFolders.add(folderKey);
    for (const file of files) totalBytes += file.source.size;
    plan.push(...files);
  }
  if (totalBytes > policy.maxTotalBytes) {
    throw new Error(`Review file plan totals ${totalBytes} bytes, exceeding the ${policy.maxTotalBytes}-byte ceiling.`);
  }
  return plan;
}
