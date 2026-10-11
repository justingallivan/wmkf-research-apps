/** Board presentation page: arrange the context's materials for display (pages/external/presentation/[token].js). */

const PDF = 'application/pdf';

export const isType = (material, type) => String(material?.contentType || '').split(';')[0].trim().toLowerCase() === type;

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

// The proposal is the external-reviewer PDF (owner decision 2026-10-11).
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
  const proposal = materials.find((m) => m.kind === 'proposal') || null;
  return { video, summary, proposal, slidesPdf, slidesOriginal, others };
}
