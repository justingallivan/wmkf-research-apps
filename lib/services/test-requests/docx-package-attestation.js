/**
 * DOCX package attestation for the Test Request Factory's Initial Assessment
 * recipe (owner decision 2026-09-24, Codex adversarial round 2 F6, shaped by
 * the first live run the same day).
 *
 * The governed DOCX hash (documents/governed-docx-hash.js) deliberately
 * covers only the `word/` content parts, so a package carrying a foreign
 * hidden part hashes identically to the fresh render. A raw whole-package
 * digest cannot close that gap either: SharePoint rewrites every uploaded
 * DOCX on the way in (property promotion), which the 2026-09-24 live run
 * characterized part by part against a fresh render of the same fixture:
 *   - adds `customXml/item{N}.xml` (content-type schema, form templates,
 *     document-management properties), `customXml/itemProps{N}.xml` and
 *     `customXml/_rels/item{N}.xml.rels`;
 *   - rewrites `docProps/core.xml`, `docProps/custom.xml`
 *     (ContentTypeId), `[Content_Types].xml` and
 *     `word/_rels/document.xml.rels` (customXml relationships);
 *   - leaves `[trash]/*.dat` entries;
 *   - and leaves every `word/` part byte-identical.
 *
 * This attestation therefore compares a downloaded package to the fresh
 * render part by part: every part is byte-identical unless it is one of the
 * characterized mutations above, and each of those is validated to be
 * SharePoint's (customXml roots, customXml-only extra relationships,
 * customXml-only extra content-type overrides). Anything else -- an unknown
 * part, a foreign customXml payload, a non-customXml relationship, a changed
 * `word/` part -- fails. Renders are not byte-deterministic only in
 * `docProps/core.xml` (timestamps), which is in the metadata set.
 */
import JSZip from 'jszip';

const METADATA_PARTS = new Set(['docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml']);
const CONTENT_TYPES_PART = '[Content_Types].xml';
const DOCUMENT_RELS_PART = 'word/_rels/document.xml.rels';
const SHAREPOINT_CUSTOMXML = /^customXml\/(item\d+\.xml|itemProps\d+\.xml|_rels\/item\d+\.xml\.rels)$/;
const TRASH = /^\[trash\]\//;
const SHAREPOINT_CUSTOMXML_ITEM_ROOTS = [
  /<ct:contentTypeSchema\b/,
  /<FormTemplates xmlns="http:\/\/schemas\.microsoft\.com\/sharepoint\/v3\/contenttype\/forms"/,
  /<p:properties xmlns:p="http:\/\/schemas\.microsoft\.com\/office\/2006\/metadata\/properties"/,
];
const CUSTOMXML_PROPS_ROOT = /<ds:datastoreItem\b/;
const CUSTOMXML_RELS_TYPE = /Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/customXmlProps"/;
const RELATIONSHIP = /<Relationship\b([^>]*?)\/?>/g;
const ATTRIBUTE = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;

async function packageParts(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const parts = new Map();
  for (const [name, file] of Object.entries(zip.files)) {
    if (!file.dir) parts.set(name, await file.async('nodebuffer'));
  }
  return parts;
}

function relationships(xml) {
  const out = [];
  for (const match of String(xml).matchAll(RELATIONSHIP)) {
    const attributes = {};
    for (const attribute of match[1].matchAll(ATTRIBUTE)) attributes[attribute[1]] = attribute[2];
    out.push(attributes);
  }
  return out;
}

function overrides(xml) {
  return Array.from(String(xml).matchAll(/<Override\b[^>]*PartName="([^"]+)"/g)).map((m) => m[1]);
}

function validateCustomXml(name, bytes, failures) {
  const head = bytes.toString('utf8', 0, Math.min(bytes.length, 2048));
  if (/^customXml\/itemProps\d+\.xml$/.test(name)) {
    if (!CUSTOMXML_PROPS_ROOT.test(head)) failures.push(`customXml part ${name} is not a SharePoint datastore item`);
  } else if (/^customXml\/_rels\/item\d+\.xml\.rels$/.test(name)) {
    const rels = relationships(head);
    if (!rels.length || rels.some((r) => !CUSTOMXML_RELS_TYPE.test(`Type="${r.Type}"`))) {
      failures.push(`customXml relationships part ${name} carries a non-customXmlProps relationship`);
    }
  } else if (!SHAREPOINT_CUSTOMXML_ITEM_ROOTS.some((root) => root.test(head))) {
    failures.push(`customXml part ${name} is not a SharePoint property-promotion item`);
  }
}

/**
 * Attest that `actualBytes` is `renderBytes` plus nothing but SharePoint's
 * characterized property promotion. Returns `{ normalizedParts }` on
 * success; throws an Error whose `.failures` lists every offending part.
 */
export async function attestDocxPackageAgainstRender(actualBytes, renderBytes) {
  const [actual, render] = await Promise.all([packageParts(actualBytes), packageParts(renderBytes)]);
  const failures = [];
  const normalizedParts = [];
  for (const [name, bytes] of actual) {
    if (TRASH.test(name)) { normalizedParts.push(name); continue; }
    if (METADATA_PARTS.has(name)) { normalizedParts.push(name); continue; }
    if (SHAREPOINT_CUSTOMXML.test(name)) { validateCustomXml(name, bytes, failures); normalizedParts.push(name); continue; }
    if (name === DOCUMENT_RELS_PART) {
      const expected = relationships(render.get(name) || '');
      const found = relationships(bytes);
      for (const rel of expected) {
        if (!found.some((f) => f.Id === rel.Id && f.Type === rel.Type && f.Target === rel.Target)) failures.push(`document relationship ${rel.Id} (${rel.Target}) is missing`);
      }
      for (const rel of found) {
        const known = expected.some((e) => e.Id === rel.Id && e.Type === rel.Type && e.Target === rel.Target);
        if (!known && !/\/relationships\/customXml$/.test(rel.Type || '')) failures.push(`document relationship ${rel.Id} (${rel.Type}) is not a SharePoint customXml relationship`);
      }
      normalizedParts.push(name);
      continue;
    }
    if (name === CONTENT_TYPES_PART) {
      const expected = overrides(render.get(name) || '');
      const found = overrides(bytes);
      for (const part of expected) if (!found.includes(part)) failures.push(`content-type override ${part} is missing`);
      for (const part of found) {
        if (!expected.includes(part) && !SHAREPOINT_CUSTOMXML.test(part.replace(/^\//, ''))) failures.push(`content-type override ${part} is not a SharePoint customXml part`);
      }
      normalizedParts.push(name);
      continue;
    }
    const expectedBytes = render.get(name);
    if (!expectedBytes) failures.push(`unexpected part ${name}`);
    else if (Buffer.compare(bytes, expectedBytes) !== 0) failures.push(`part ${name} differs from the render`);
  }
  for (const name of render.keys()) {
    if (!actual.has(name) && !METADATA_PARTS.has(name)) failures.push(`part ${name} is missing`);
  }
  if (failures.length) {
    const error = new Error(`DOCX package differs from the render beyond SharePoint property promotion: ${failures.join('; ')}`);
    error.failures = failures;
    throw error;
  }
  return { normalizedParts };
}
