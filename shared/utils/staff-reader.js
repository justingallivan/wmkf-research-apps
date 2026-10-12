/**
 * Link to the staff reading page (pages/workbench/read.js) for a transcript or summary material, or
 * null when the item is not a plain-text file of a readable type (an uploaded PDF, DOCX or VTT
 * transcript keeps its SharePoint link). The text route re-checks everything server-side.
 */
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../config/requestDocument';

const READABLE_TYPES = new Set([
  REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_SUMMARY,
]);

export function staffReaderHref(requestId, material) {
  if (!requestId || !material?.artifactId || material.backing !== 'file') return null;
  if (!READABLE_TYPES.has(Number(material.artifactType))) return null;
  const type = String(material.contentType || '').split(';')[0].trim().toLowerCase();
  if (type !== 'text/plain' || !String(material.filename || '').toLowerCase().endsWith('.txt')) return null;
  return `/workbench/read?${new URLSearchParams({ request: requestId, document: material.artifactId })}`;
}
