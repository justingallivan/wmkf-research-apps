/** Board presentation page: arrange the context's materials for display (pages/external/presentation/[token].js). */

const PDF = 'application/pdf';

export const isType = (material, type) => String(material?.contentType || '').split(';')[0].trim().toLowerCase() === type;

// Office files the server can convert to PDF for viewing (open route mode=pdf).
const OFFICE_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);
export const isOffice = (material) => OFFICE_TYPES.has(String(material?.contentType || '').split(';')[0].trim().toLowerCase());

// "1003222 Site Visit Participant Bios.docx" -> "Site Visit Participant Bios": no request number, no extension.
export function displayName(filename) {
  const name = String(filename || '')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/^\s*\d{5,}[\s_-]*/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name || 'Additional material';
}

// The page fills in stages (slides and bios before the visit; video and summary after), so it is
// assembled from what exists rather than listed in arrival order.
export function arrangeMaterials(materials = []) {
  const video = materials.find((m) => m.kind === 'video' && m.backing === 'file') || null;
  const summary = materials.find((m) => m.kind === 'summary') || null;
  const slideFiles = materials.filter((m) => m.kind === 'slides');
  const slidesPdf = slideFiles.find((m) => isType(m, PDF)) || null;
  const slidesOriginal = slideFiles.find((m) => !isType(m, PDF)) || null;
  const extraSlides = slideFiles.filter((m) => m !== slidesPdf && m !== slidesOriginal);
  const others = [...extraSlides, ...materials.filter((m) => m.kind === 'other')];
  return { video, summary, slidesPdf, slidesOriginal, others };
}
