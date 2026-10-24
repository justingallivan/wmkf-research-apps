/** Frozen presentation-member identities. Current staff winners and approved Board editions are deliberately separate. */
import crypto from 'node:crypto';
import { isGuid } from '../../utils/guid.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE as TYPE, REQUEST_DOCUMENT_OPERATION_STATUS as STATUS } from '../../../shared/config/requestDocument.js';
import { POST_PRESENTATION_PRODUCER } from './presentation-transcript-binding.js';
import { materialBacking } from './material-model.js';

export const EDITION_TYPES = Object.freeze([TYPE.PRESENTATION_TRANSCRIPT, TYPE.TRANSCRIPT_SUMMARY, TYPE.PRESENTATION_VIDEO]);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const bounded = (v, max = 1024) => typeof v === 'string' && v.length > 0 && v.length <= max;
const SHA = /^[a-f0-9]{64}$/;

export function freezeEditionMember(row, cut = null) {
  const type = Number(row?.wmkf_artifacttype);
  if (!EDITION_TYPES.includes(type) || !isGuid(row?.wmkf_requestdocumentid) || !isGuid(row?._wmkf_request_value)
    || row.wmkf_producer !== POST_PRESENTATION_PRODUCER || row.wmkf_operationstatus !== STATUS.READY
    || materialBacking(row).kind !== 'file') throw new TypeError('invalid_edition_member');
  const member = {
    documentId: row.wmkf_requestdocumentid.toLowerCase(), requestId: row._wmkf_request_value.toLowerCase(), type,
    driveId: row.wmkf_sharepointdriveid, itemId: row.wmkf_sharepointitemid,
    versionId: row.wmkf_sharepointversionid || null, eTag: row.wmkf_sharepointetag || null,
    filename: row.wmkf_filename, contentType: row.wmkf_contenttype,
    size: Number(row.wmkf_filesize), sha256: row.wmkf_contenthash || null,
    splitId: null, quickXorHash: null,
  };
  if (type === TYPE.PRESENTATION_VIDEO) {
    if (!cut || !isGuid(cut.id) || !same(cut.request_document_id, member.documentId)
      || cut.output_drive_id !== member.driveId || cut.output_item_id !== member.itemId
      || Number(cut.output_size) !== member.size || !bounded(cut.output_quickxor_hash, 128)) throw new TypeError('invalid_edition_video');
    member.splitId = cut.id; member.quickXorHash = cut.output_quickxor_hash;
  }
  validateEditionMembers([member], { complete: false });
  return member;
}

export function validateEditionMembers(members, { complete = true, requestId = null } = {}) {
  if (!Array.isArray(members) || members.length > 3 || (complete && members.length !== 3)) throw new TypeError('invalid_edition_members');
  const types = new Set(); const ids = new Set();
  for (const m of members) {
    if (!m || !EDITION_TYPES.includes(m.type) || types.has(m.type) || ids.has(m.documentId)
      || !isGuid(m.documentId) || !isGuid(m.requestId) || (requestId && !same(m.requestId, requestId))
      || !bounded(m.driveId) || !bounded(m.itemId) || !bounded(m.filename, 255) || !bounded(m.contentType, 200)
      || !Number.isSafeInteger(m.size) || m.size < 1
      || (m.type === TYPE.PRESENTATION_VIDEO
        ? !isGuid(m.splitId) || !bounded(m.quickXorHash, 128)
        : !SHA.test(m.sha256 || '') || !bounded(m.eTag))) throw new TypeError('invalid_edition_members');
    types.add(m.type); ids.add(m.documentId);
  }
  return members;
}

export function editionFingerprint({ revisionId, endMs, members }) {
  if (!isGuid(revisionId) || !Number.isSafeInteger(endMs) || endMs < 0) throw new TypeError('invalid_edition_source');
  validateEditionMembers(members);
  return sha(JSON.stringify({ revisionId, endMs, members: [...members].sort((a, b) => a.type - b.type) }));
}

/** Resolve exact retained rows, including superseded rows, only for an explicit active approval receipt. */
export function approvedEditionRows(rows, requestId, visibility) {
  if (!visibility?.active_edition_id) return [];
  if (!same(visibility.request_id, requestId) || !same(visibility.edition_request_id, requestId)
    || !same(visibility.edition_id, visibility.active_edition_id)) throw new TypeError('invalid_edition_visibility');
  const members = validateEditionMembers(visibility.members, { requestId });
  return members.flatMap(member => {
    const row = (rows || []).find(r => same(r.wmkf_requestdocumentid, member.documentId));
    if (!row || !same(row._wmkf_request_value, requestId) || Number(row.wmkf_artifacttype) !== member.type
      || row.wmkf_producer !== POST_PRESENTATION_PRODUCER || row.wmkf_operationstatus !== STATUS.READY
      || row.wmkf_externalurl || row.wmkf_sharepointdriveid !== member.driveId || row.wmkf_sharepointitemid !== member.itemId
      || Number(row.wmkf_filesize) !== member.size
      || (member.type !== TYPE.PRESENTATION_VIDEO && (row.wmkf_contenthash !== member.sha256 || row.wmkf_sharepointetag !== member.eTag))) return [];
    return [{ ...row, wmkf_filename: member.filename, wmkf_contenttype: member.contentType, _approvedEditionMember: member }];
  });
}

export function editionMemberBytesMatch(member, media) {
  if (!member || !media || media.malware || media.driveId !== member.driveId || media.itemId !== member.itemId
    || Number(media.size) !== member.size) return false;
  return member.type === TYPE.PRESENTATION_VIDEO
    ? media.quickXorHash === member.quickXorHash
    : media.eTag === member.eTag;
}
