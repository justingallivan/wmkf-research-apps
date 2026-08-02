/**
 * Exact Graph proposal authority for the Reviewer Find cold path.
 *
 * This intentionally wraps (rather than changes) the legacy load/upload
 * service: it proves the selected Graph item and its metadata version before
 * and after that service handles the bytes. A filename/listing/blob URL is not
 * authority on its own.
 */

import { GraphService } from '../graph-service';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { ServiceHttpError } from '../service-http-error';
import {
  parseProposalBindingKey,
  proposalContentVersionForMetadata,
} from './search-authority-attestation';

export class ProposalAuthorityError extends ServiceHttpError {
  constructor(message, code = 'authority_changed') {
    super(message, { httpStatus: 409, body: { error: message, code } });
    this.name = 'ProposalAuthorityError';
  }
}

function joinPath(base, leaf) {
  return [String(base || '').replace(/\/+$/, ''), leaf].filter(Boolean).join('/');
}

function activeRequestBuckets(buckets) {
  return (Array.isArray(buckets) ? buckets : []).filter((bucket) => (
    bucket?.source === 'dynamics'
    && String(bucket?.library || '').toLowerCase() === 'akoya_request'
    && typeof bucket?.folder === 'string'
    && bucket.folder.trim()
  ));
}

async function metadataForBinding(requestId, binding) {
  let metadata;
  try {
    metadata = await GraphService.getFileMetadataByPath(binding.library, binding.folder, binding.filename);
  } catch {
    throw new ProposalAuthorityError('Proposal authority could not be verified. Reload the proposal before searching.');
  }
  const proposalContentVersion = proposalContentVersionForMetadata(requestId, metadata);
  if (!proposalContentVersion) {
    throw new ProposalAuthorityError('Proposal authority could not be verified. Reload the proposal before searching.');
  }
  return { ...binding, proposalContentVersion };
}

async function metadataMatches(requestId, candidates) {
  const found = [];
  for (const candidate of candidates) {
    try {
      const authority = await metadataForBinding(requestId, candidate);
      if (authority) found.push(authority);
    } catch (error) {
      if (error instanceof ProposalAuthorityError) continue;
      throw error;
    }
  }
  return found;
}

/** Resolve exactly the binding the legacy load service is permitted to select. */
export async function resolveProposalAuthorityBeforeLoad({ requestId, fileKey = null } = {}) {
  const request = await grantRequestAdapter.getById(requestId, {
    select: grantRequestAdapter.SELECT_PROFILES.IDENTITY,
  });
  const requestNumber = String(request?.akoya_requestnum || '').trim();
  if (!requestNumber) throw new ProposalAuthorityError('Proposal request authority is unavailable.', 'authority_stale');

  if (fileKey) {
    const explicit = parseProposalBindingKey(fileKey);
    if (!explicit) throw new ProposalAuthorityError('Selected proposal binding is invalid. Reload the proposal before searching.');
    return { ...(await metadataForBinding(requestId, explicit)), manualOverride: true };
  }

  let buckets;
  try {
    buckets = await getRequestSharePointBuckets(requestId, requestNumber);
  } catch {
    throw new ProposalAuthorityError('Proposal authority could not be verified. Reload the proposal before searching.', 'authority_stale');
  }
  const active = activeRequestBuckets(buckets);
  const canonical = await metadataMatches(requestId, active.map((bucket) => ({
    library: bucket.library,
    folder: joinPath(bucket.folder, 'Reviewer Materials'),
    filename: `Proposal_${requestNumber}.pdf`,
    bindingKey: `${bucket.library}::${joinPath(bucket.folder, 'Reviewer Materials')}::Proposal_${requestNumber}.pdf`,
  })));
  if (canonical.length === 1) return { ...canonical[0], manualOverride: false };
  if (canonical.length > 1) throw new ProposalAuthorityError('Multiple active canonical reviewer proposals were found. Reload and choose an explicit file.');

  const fallback = await metadataMatches(requestId, active.map((bucket) => ({
    library: bucket.library,
    folder: joinPath(bucket.folder, 'Phase I'),
    filename: 'ProjectDescription.pdf',
    bindingKey: `${bucket.library}::${joinPath(bucket.folder, 'Phase I')}::ProjectDescription.pdf`,
  })));
  if (fallback.length === 1) return { ...fallback[0], manualOverride: false };
  throw new ProposalAuthorityError('Proposal authority could not be verified. Reload the proposal before searching.');
}

export async function captureProposalAuthority({ requestId, bindingKey } = {}) {
  const binding = parseProposalBindingKey(bindingKey);
  if (!binding) throw new ProposalAuthorityError('Proposal binding is invalid. Reload the proposal before searching.');
  return metadataForBinding(requestId, binding);
}

/**
 * The caller captures Graph metadata on both sides of a byte-consuming
 * operation.  A changed item, binding, or opaque content version means the
 * bytes cannot be treated as the proposal that was just authorized.
 */
export function assertProposalAuthorityStable({ before, after } = {}) {
  const prior = before && typeof before === 'object' ? before : null;
  const current = after && typeof after === 'object' ? after : null;
  if (!prior || !current
    || prior.bindingKey !== current.bindingKey
    || prior.proposalContentVersion !== current.proposalContentVersion) {
    throw new ProposalAuthorityError(
      'The proposal changed while it was being read. Reload it before searching.',
      'authority_changed',
    );
  }
  return current;
}
