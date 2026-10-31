/** Confirmed J27 AI-input subset only; not staff/reviewer-package readiness.
 * Pure validation shared by source discovery, bundle reads and copy planning.
 * Destination filenames remain the existing canonical names/ledger grammar.
 */
import {
  acceptedProposalNarrativeFilenames,
  acceptedProposalBibliographyFilenames,
} from '../../utils/proposal-document-names.js';

export const J27_AI_INPUT_PROFILE = 'j27-ai-inputs-v1';
const INPUT_NAMES = Object.freeze({
  proposalNarrative: acceptedProposalNarrativeFilenames,
  proposalBibliography: acceptedProposalBibliographyFilenames,
});

export function isJ27AiAlias(document, requestNumber) {
  return INPUT_NAMES[document?.kind]?.(requestNumber).slice(1).includes(document.name) || false;
}

export function assertJ27AiInputs(documents, requestNumber) {
  if (!Array.isArray(documents)) throw new Error('J27 AI inputs require a document inventory.');
  for (const [kind, names] of Object.entries(INPUT_NAMES)) {
    const matches = documents.filter(document => document.kind === kind);
    if (matches.length !== 1) throw new Error(`J27 AI inputs require exactly one ${kind}; found ${matches.length}.`);
    const document = matches[0];
    if (!names(requestNumber).includes(document.name)
        || String(document.folder || '').split('/').filter(Boolean).at(-1)?.toLowerCase() !== 'ai materials'
        || document.mimeType !== 'application/pdf') {
      throw new Error(`J27 AI input ${kind} must be an exact named PDF in AI Materials.`);
    }
  }
}

export function assertBundleDocumentProfile(bundle) {
  if (bundle?.version === 6) {
    if (bundle.documentProfile !== J27_AI_INPUT_PROFILE || bundle.source?.cycleCode !== 'J27') {
      throw new Error('Unknown or invalid J27 source document profile.');
    }
    assertJ27AiInputs(bundle.documents, bundle.source?.request?.akoya_requestnum);
  } else if (bundle?.documentProfile !== undefined || bundle?.source?.cycleCode !== undefined
      || bundle?.documents?.some(document => isJ27AiAlias(document, bundle.source?.request?.akoya_requestnum))) {
    throw new Error('J27 source documents require the version 6 document profile.');
  }
}

/** Keep legacy abstract behavior explicit at every create/readback fence. */
export function bundleHasApplicantAbstract(bundle) {
  return bundle?.version === 5 || bundle?.version === 6;
}
