/**
 * Pure, non-writing file-plan compiler for the Basic Test Request recipe.
 *
 * sourceDocuments and filePolicy must come from trusted server-side discovery
 * and configuration. The browser may submit only selected source IDs. This
 * module performs no Graph, Dataverse, Blob, database, or provider work and
 * never claims that a plan is execution-ready.
 */

import {
  expectedProposalBibliographyFilename,
  expectedProposalNarrativeFilename,
  expectedReviewerProposalFilename,
} from '../../utils/proposal-document-names.js';

const PHASE_I_FOLDER = 'Phase I';
const AI_MATERIALS_FOLDER = 'AI Materials';
const REVIEWER_MATERIALS_FOLDER = 'Reviewer Materials';

const PHASE_I_KINDS = Object.freeze({
  projectDescription: Object.freeze({ folder: PHASE_I_FOLDER, filename: 'ProjectDescription.pdf' }),
  biosketches: Object.freeze({ folder: PHASE_I_FOLDER, filename: 'Biosketches.pdf' }),
  projectBudget: Object.freeze({ folder: PHASE_I_FOLDER, filename: 'ProjectBudget.pdf' }),
  projectBudgetSpreadsheet: Object.freeze({ folder: PHASE_I_FOLDER, filename: 'Project Budget spreadsheet.xlsx' }),
});

const GENERATED_KINDS = Object.freeze({
  reviewerProposal: Object.freeze({
    folder: REVIEWER_MATERIALS_FOLDER,
    filename: expectedReviewerProposalFilename,
    filenameTemplate: 'Proposal_{new-request-number}.pdf',
  }),
  proposalNarrative: Object.freeze({
    folder: AI_MATERIALS_FOLDER,
    filename: expectedProposalNarrativeFilename,
    filenameTemplate: 'ProposalNarrative_{new-request-number}.pdf',
  }),
  proposalBibliography: Object.freeze({
    folder: AI_MATERIALS_FOLDER,
    filename: expectedProposalBibliographyFilename,
    filenameTemplate: 'ProposalBibliography_{new-request-number}.pdf',
  }),
});

const DOCUMENT_KINDS = new Set([...Object.keys(PHASE_I_KINDS), ...Object.keys(GENERATED_KINDS)]);
const INPUT_KEYS = new Set(['filePolicy', 'selectedDocumentIds', 'sourceDocuments', 'sourceRequestNumber']);
const DOCUMENT_KEYS = new Set([
  'contentHash',
  'folder',
  'id',
  'kind',
  'library',
  'mimeType',
  'name',
  'size',
  'versionId',
]);
const POLICY_KEYS = new Set(['allowedMimeTypes', 'maxFileBytes', 'maxFiles', 'maxTotalBytes']);
const SHA256 = /^[a-f0-9]{64}$/i;
const SAFE_REQUEST_NUMBER = /^[A-Za-z0-9-]{1,80}$/;

function blocker(code, field, detail) {
  return { code, ...(field ? { field } : {}), detail };
}

function folderEndsWith(folder, expected) {
  const segments = String(folder || '').split('/').filter(Boolean);
  return segments.at(-1)?.toLowerCase() === expected.toLowerCase();
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateFilePolicy(filePolicy, blockers) {
  if (!filePolicy || typeof filePolicy !== 'object' || Array.isArray(filePolicy)) {
    blockers.push(blocker('FILE_POLICY_UNKNOWN', 'filePolicy', 'Trusted server file policy is required.'));
    return null;
  }
  for (const key of Object.keys(filePolicy)) {
    if (!POLICY_KEYS.has(key)) blockers.push(blocker('FILE_POLICY_INVALID', key, 'Unknown file policy key.'));
  }
  for (const key of ['maxFiles', 'maxFileBytes', 'maxTotalBytes']) {
    if (!positiveInteger(filePolicy[key])) {
      blockers.push(blocker('FILE_POLICY_INVALID', key, 'File policy limits must be positive safe integers.'));
    }
  }
  if (!Array.isArray(filePolicy.allowedMimeTypes)
      || filePolicy.allowedMimeTypes.length < 1
      || filePolicy.allowedMimeTypes.some(type => typeof type !== 'string' || type.trim() !== type || !type)) {
    blockers.push(blocker('FILE_POLICY_INVALID', 'allowedMimeTypes', 'At least one normalized MIME type is required.'));
  }
  return blockers.some(item => item.code === 'FILE_POLICY_INVALID' || item.code === 'FILE_POLICY_UNKNOWN')
    ? null
    : {
      ...filePolicy,
      allowedMimeTypes: new Set(filePolicy.allowedMimeTypes),
    };
}

function validateDocumentShape(document, index, blockers) {
  const field = `sourceDocuments[${index}]`;
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    blockers.push(blocker('SOURCE_DOCUMENT_INVALID', field, 'Source document must be an object.'));
    return false;
  }
  for (const key of Object.keys(document)) {
    if (!DOCUMENT_KEYS.has(key)) blockers.push(blocker('SOURCE_DOCUMENT_INVALID', `${field}.${key}`, 'Unknown source document key.'));
  }
  const strings = ['id', 'versionId', 'library', 'folder', 'name', 'mimeType'];
  for (const key of strings) {
    if (typeof document[key] !== 'string' || !document[key]) {
      blockers.push(blocker('SOURCE_DOCUMENT_INVALID', `${field}.${key}`, 'A non-empty string is required.'));
    }
  }
  if (!DOCUMENT_KINDS.has(document.kind)) {
    blockers.push(blocker('SOURCE_DOCUMENT_KIND_UNSUPPORTED', `${field}.kind`, 'Document kind is not allowlisted.'));
  }
  if (!Number.isSafeInteger(document.size) || document.size < 0) {
    blockers.push(blocker('SOURCE_DOCUMENT_INVALID', `${field}.size`, 'Size must be a non-negative safe integer.'));
  }
  if (typeof document.contentHash !== 'string' || !SHA256.test(document.contentHash)) {
    blockers.push(blocker('SOURCE_DOCUMENT_INVALID', `${field}.contentHash`, 'A SHA-256 content hash is required.'));
  }
  return !blockers.some(item => item.field?.startsWith(field));
}

function expectedSource(document, sourceRequestNumber) {
  const phase = PHASE_I_KINDS[document.kind];
  if (phase) return phase;
  const generated = GENERATED_KINDS[document.kind];
  if (!generated) return null;
  return {
    folder: generated.folder,
    filename: generated.filename(sourceRequestNumber),
  };
}

export function resolveTestRequestDocumentDestination(kind, destinationRequestNumber) {
  const phase = PHASE_I_KINDS[kind];
  if (phase) return { ...phase };
  const generated = GENERATED_KINDS[kind];
  if (!generated) return null;
  const normalized = String(destinationRequestNumber ?? '').trim();
  if (!SAFE_REQUEST_NUMBER.test(normalized)) return null;
  const filename = generated.filename(normalized);
  return filename ? { folder: generated.folder, filename } : null;
}

function destinationTemplate(kind) {
  const phase = PHASE_I_KINDS[kind];
  if (phase) return { ...phase };
  const generated = GENERATED_KINDS[kind];
  return generated
    ? { folder: generated.folder, filename: generated.filenameTemplate }
    : null;
}

export function compileBasicCloneFilePlan(input = {}) {
  const blockers = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      blockers: [blocker('FILE_PLAN_INPUT_INVALID', null, 'File-plan input must be an object.')],
      disclosures: [],
      executionReady: false,
      planReady: false,
      plannedFiles: [],
    };
  }
  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) blockers.push(blocker('FILE_PLAN_INPUT_INVALID', key, 'Unknown file-plan input key.'));
  }

  const policy = validateFilePolicy(input.filePolicy, blockers);
  if (!Array.isArray(input.sourceDocuments)) {
    blockers.push(blocker('FILE_PLAN_INPUT_INVALID', 'sourceDocuments', 'Trusted source document inventory is required.'));
  }
  if (!Array.isArray(input.selectedDocumentIds)) {
    blockers.push(blocker('FILE_PLAN_INPUT_INVALID', 'selectedDocumentIds', 'Selected document IDs must be an array.'));
  }

  const documents = Array.isArray(input.sourceDocuments) ? input.sourceDocuments : [];
  const selectedIds = Array.isArray(input.selectedDocumentIds) ? input.selectedDocumentIds : [];
  const inventory = new Map();
  documents.forEach((document, index) => {
    if (!validateDocumentShape(document, index, blockers)) return;
    if (inventory.has(document.id)) {
      blockers.push(blocker('SOURCE_DOCUMENT_DUPLICATE', 'sourceDocuments', `Duplicate source document ID: ${document.id}.`));
      return;
    }
    inventory.set(document.id, document);
  });

  const selected = new Set();
  for (const [index, id] of selectedIds.entries()) {
    if (typeof id !== 'string' || !id) {
      blockers.push(blocker('FILE_SELECTION_INVALID', `selectedDocumentIds[${index}]`, 'Selected document ID must be a non-empty string.'));
    } else if (selected.has(id)) {
      blockers.push(blocker('FILE_SELECTION_DUPLICATE', 'selectedDocumentIds', `Document selected more than once: ${id}.`));
    } else if (!inventory.has(id)) {
      blockers.push(blocker('FILE_SELECTION_UNKNOWN', 'selectedDocumentIds', `Selected document is not in the trusted inventory: ${id}.`));
    }
    selected.add(id);
  }

  if (policy && selectedIds.length > policy.maxFiles) {
    blockers.push(blocker('FILE_COUNT_EXCEEDED', 'selectedDocumentIds', `Selection exceeds the configured ${policy.maxFiles}-file limit.`));
  }

  let totalBytes = 0;
  const plannedFiles = [];
  for (const id of [...selected].sort()) {
    const document = inventory.get(id);
    if (!document) continue;
    if (GENERATED_KINDS[document.kind]
        && !SAFE_REQUEST_NUMBER.test(String(input.sourceRequestNumber ?? '').trim())) {
      blockers.push(blocker('SOURCE_REQUEST_NUMBER_INVALID', 'sourceRequestNumber', 'A safe source request number is required for generated documents.'));
      continue;
    }
    const expected = expectedSource(document, input.sourceRequestNumber);
    if (!expected?.filename
        || document.name !== expected.filename
        || !folderEndsWith(document.folder, expected.folder)) {
      blockers.push(blocker('SOURCE_DOCUMENT_MISMATCH', id, 'Source filename/folder does not match its allowlisted document kind.'));
      continue;
    }
    if (policy) {
      if (document.size > policy.maxFileBytes) {
        blockers.push(blocker('FILE_SIZE_EXCEEDED', id, 'Source document exceeds the configured per-file limit.'));
      }
      if (!policy.allowedMimeTypes.has(document.mimeType)) {
        blockers.push(blocker('FILE_TYPE_UNSUPPORTED', id, 'Source document MIME type is not allowlisted.'));
      }
    }
    totalBytes += document.size;
    const requiresTransformation = Boolean(GENERATED_KINDS[document.kind]);
    if (requiresTransformation) {
      blockers.push(blocker(
        'DOCUMENT_TRANSFORMER_REQUIRED',
        id,
        'Generated document may contain the source request identity and cannot be copied or merely renamed.',
      ));
    }
    plannedFiles.push({
      source: {
        contentHash: document.contentHash,
        folder: document.folder,
        id: document.id,
        library: document.library,
        mimeType: document.mimeType,
        name: document.name,
        size: document.size,
        versionId: document.versionId,
      },
      destination: destinationTemplate(document.kind),
      kind: document.kind,
      operation: requiresTransformation ? 'transform' : 'copy',
    });
  }
  if (policy && totalBytes > policy.maxTotalBytes) {
    blockers.push(blocker('FILE_TOTAL_SIZE_EXCEEDED', 'selectedDocumentIds', 'Selection exceeds the configured total-byte limit.'));
  }

  return {
    blockers,
    disclosures: selectedIds.length ? [
      'Selected source files may contain real names or confidential information; cloning does not anonymize their contents.',
      'The source versions and SHA-256 hashes must be revalidated before any copy begins.',
    ] : [],
    executionReady: false,
    planReady: blockers.length === 0,
    plannedFiles,
  };
}

export const TEST_REQUEST_DOCUMENT_KINDS = Object.freeze({
  ...Object.fromEntries(Object.keys(PHASE_I_KINDS).map(key => [key, key])),
  ...Object.fromEntries(Object.keys(GENERATED_KINDS).map(key => [key, key])),
});
