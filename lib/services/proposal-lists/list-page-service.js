/**
 * External proposal list page: what a verified link holder may read
 * (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 *
 * The page context comes only from the link's frozen Postgres items; no
 * Dataverse or SharePoint read happens until the holder opens a proposal.
 *
 * Opening a proposal: the caller names a request NUMBER only. The request must
 * be an item of this link; its GUID comes from that item, never from the
 * caller. The one file served is the request's staff version, resolved by the
 * existing Workbench rule (exactly one `{AKA}_Staff-Version_{Request#}.pdf` at
 * the request folder root). A missing or ambiguous staff version is a 404; no
 * other file is ever served in its place.
 *
 * ASSUMES the route verified the token and (for the document) established a
 * trusted DAL context.
 */
import { GraphService } from '../graph-service';
import { listProposalDocuments } from '../workbench-proposal-documents';
import { ServiceHttpError } from '../service-http-error';
import * as store from './list-store';
import { UNASSIGNED_SECTION } from './section-names';

const DEFAULT_DEPENDENCIES = Object.freeze({
  listItems: store.listItems,
  getItem: store.getItem,
  listDocuments: listProposalDocuments,
  download: (library, folder, name) => GraphService.downloadFileByPath(library, folder, name),
});

function pageError(reason, httpStatus) {
  return new ServiceHttpError(reason, { httpStatus, code: reason, body: { ok: false, reason } });
}

function projectItem(row) {
  return {
    requestNumber: row.request_number,
    title: row.title,
    institution: row.institution || null,
    projectLeader: row.project_leader || null,
    ownInstitution: row.own_institution === true,
  };
}

/**
 * @param {{ link: object }} args the verified proposal_list_links row
 * Sections are discipline branches; inside one, `groups` are its discipline
 * groups in name order, with proposals that have no group last under a null
 * name. `Unassigned` sorts after every named branch.
 * @returns {Promise<{ ok: true, recipientName, cycleCode, expiresAt, total, highlighted: object[], sections: { name, proposals, groups: { name, proposals }[] }[] }>}
 */
export async function buildProposalListContext({ link }, dependencies = DEFAULT_DEPENDENCIES) {
  const rows = await dependencies.listItems(link.id);
  // Highlighted proposals appear only in the top group, not again in a section.
  const highlighted = rows.filter((row) => row.highlighted === true).map(projectItem);
  const sections = new Map();
  for (const row of rows) {
    if (row.highlighted === true) continue;
    if (!sections.has(row.section)) sections.set(row.section, new Map());
    const groups = sections.get(row.section);
    const group = row.subsection || null;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(projectItem(row));
  }
  return {
    ok: true,
    recipientName: link.recipient_name,
    cycleCode: link.cycle_code,
    expiresAt: link.expires_at instanceof Date ? link.expires_at.toISOString() : link.expires_at,
    total: rows.length,
    highlighted,
    sections: [...sections.entries()]
      .sort(([a], [b]) => (a === UNASSIGNED_SECTION) - (b === UNASSIGNED_SECTION) || a.localeCompare(b))
      .map(([name, groups]) => {
        const ordered = [...groups.entries()]
          .sort(([a], [b]) => (a === null) - (b === null) || String(a).localeCompare(String(b)))
          .map(([groupName, proposals]) => ({ name: groupName, proposals }));
        return { name, proposals: ordered.flatMap((g) => g.proposals), groups: ordered };
      }),
  };
}

/**
 * @param {{ link: object, requestNumber: string }} args
 * @returns {Promise<{ buffer: Buffer, mimeType: string, filename: string, size: number }>}
 * @throws {ServiceHttpError} 400 bad number, 404 not on this list or no staff version, 502 SharePoint failure
 */
export async function resolveProposalListDocument({ link, requestNumber }, dependencies = DEFAULT_DEPENDENCIES) {
  const number = String(requestNumber ?? '').trim();
  if (!/^\d{1,12}$/.test(number)) throw pageError('request_invalid', 400);
  const item = await dependencies.getItem(link.id, number);
  if (!item) throw pageError('not_on_list', 404);

  let staffVersion;
  try {
    ({ staffVersion } = await dependencies.listDocuments(item.request_id, item.request_number, link.cycle_code));
  } catch (error) {
    console.error('[proposal list document] listing failed:', error?.message || error);
    throw pageError('document_unavailable', 502);
  }
  if (!staffVersion || staffVersion.found !== true) throw pageError('document_not_ready', 404);

  let file;
  try {
    file = await dependencies.download(String(staffVersion.library), String(staffVersion.folder), String(staffVersion.name));
  } catch (error) {
    console.error('[proposal list document] download failed:', error?.message || error);
    throw pageError('document_unavailable', 502);
  }
  // Only a PDF is ever returned. The check is on the file's own leading bytes,
  // not the content type SharePoint reports, which is not always set.
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw pageError('document_not_ready', 404);
  }
  return { buffer: file.buffer, mimeType: 'application/pdf', filename: file.filename || staffVersion.name, size: file.buffer.length };
}
