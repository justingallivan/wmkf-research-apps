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
 * customXml-only extra content-type overrides). customXml items are
 * recognized by their SharePoint root element or relationship type only;
 * their contents are not otherwise inspected. Anything else -- an unknown
 * part, a foreign customXml payload, a non-customXml relationship, a changed
 * `word/` part -- fails. Renders are not byte-deterministic only in
 * `docProps/core.xml` (timestamps), which is in the metadata set.
 */
import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';

// Only the two metadata parts SharePoint actually rewrote live (and
// core.xml is also the one render-nondeterministic part). docProps/app.xml
// was unchanged by promotion and is therefore held byte-identical.
const METADATA_PARTS = new Set(['docProps/core.xml', 'docProps/custom.xml']);
const CONTENT_TYPES_PART = '[Content_Types].xml';
const DOCUMENT_RELS_PART = 'word/_rels/document.xml.rels';
const SHAREPOINT_CUSTOMXML = /^customXml\/(item\d+\.xml|itemProps\d+\.xml|_rels\/item\d+\.xml\.rels)$/;
const TRASH = /^\[trash\]\//;
// Word/SharePoint `[trash]` entries are padding left by SharePoint's
// in-place rewrite. Characterized live (sandbox Request 1000342's two
// promoted IA files, read back 2026-09-25): `[trash]/0000.dat` (453 bytes)
// and `[trash]/0001.dat` (149 bytes), each exactly four 0xFF bytes followed
// by zeros, byte-identical across both files. A `[trash]` entry is
// normalized ONLY in that shape (Codex slice review round 3 found the
// former blanket exemption; the round-3 all-zero rule was a fixture guess
// the live bytes refuted). Such bytes carry no information, so no
// cross-side comparison is needed.
const TRASH_CANONICAL = /^\[trash\]\/\d{4}\.dat$/;
const TRASH_MAX_BYTES = 4 * 1024;
function validateTrash(name, bytes, failures) {
  if (!TRASH_CANONICAL.test(name)) { failures.push(`trash entry ${name} is not a canonical [trash]/NNNN.dat padding entry`); return; }
  if (bytes.length > TRASH_MAX_BYTES) { failures.push(`trash entry ${name} exceeds ${TRASH_MAX_BYTES} bytes`); return; }
  const shaped = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xff && bytes[2] === 0xff && bytes[3] === 0xff
    && bytes.subarray(4).every((b) => b === 0);
  if (!shaped) failures.push(`trash entry ${name} is not SharePoint's 0xFFFFFFFF-then-zeros padding`);
}
// Root elements SharePoint's property promotion writes, by namespace URI +
// local name. Recognition is by the PARSED document root (Codex slice
// review round 2): a regex over a text head accepted a foreign root that
// merely contained a permitted-looking tag in a comment or a nested child.
const SHAREPOINT_CUSTOMXML_ITEM_ROOTS = [
  { uri: 'http://schemas.microsoft.com/office/2006/metadata/contentType', local: 'contentTypeSchema' },
  { uri: 'http://schemas.microsoft.com/sharepoint/v3/contenttype/forms', local: 'FormTemplates' },
  { uri: 'http://schemas.microsoft.com/office/2006/metadata/properties', local: 'properties' },
];
const CUSTOMXML_PROPS_ROOT = { uri: 'http://schemas.openxmlformats.org/officeDocument/2006/customXml', local: 'datastoreItem' };
// SharePoint's property promotion adds exactly three customXml items, each
// characterized live from sandbox Request 1000342's promoted IA files
// (2026-09-25; the three items were byte-identical across both files):
//   item1  ct:contentTypeSchema, 14,882 bytes: XML Schema elements only,
//          attributes in the ct / ma / site-column (GUID) namespaces,
//          168 elements, depth 11, longest text 130, longest attribute 75;
//   item2  FormTemplates, 219 bytes: <Display>, <Edit>, <New> tokens;
//   item3  p:properties, 766 bytes: one unqualified <documentManagement>
//          whose children are site-column elements in GUID namespaces,
//          carrying xsi:nil or PartnerControls <Terms> subtrees.
// Recognition by root alone let an allowed root carry a foreign payload
// (Codex reviewer-differs-from-author round), and a namespace allowlist
// still admitted unqualified or GUID-namespaced payload elements (its
// re-review). The shapes below bound every element, attribute and text
// node; what remains is a text channel bounded by CUSTOMXML_LIMITS and
// recorded as accepted. A tenant content-type change that breaks a shape
// fails closed and is re-characterized in a reviewed commit.
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XSD_NS = 'http://www.w3.org/2001/XMLSchema';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const CT_NS = 'http://schemas.microsoft.com/office/2006/metadata/contentType';
const MA_NS = 'http://schemas.microsoft.com/office/2006/metadata/properties/metaAttributes';
const P_NS = 'http://schemas.microsoft.com/office/2006/metadata/properties';
const PC_NS = 'http://schemas.microsoft.com/office/infopath/2007/PartnerControls';
const FORMS_NS = 'http://schemas.microsoft.com/sharepoint/v3/contenttype/forms';
const DS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/customXml';
const SITE_COLUMN_NS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;
export const CUSTOMXML_LIMITS = Object.freeze({
  itemBytes: 64 * 1024, propsBytes: 4 * 1024, relsBytes: 4 * 1024,
  elements: 1024, depth: 24, textChars: 256, columnValueChars: 1024, attributeChars: 256, attributesPerElement: 32,
  // SharePoint adds exactly three items (schema, forms, properties), each
  // with one itemProps and one rels part; the aggregate covers all nine.
  addedItems: 3, addedBytes: 128 * 1024,
});

function textOf(node) {
  let text = typeof node._ === 'string' ? node._ : '';
  for (const kid of node.kids || []) if (kid['#name'] === '__text__' && typeof kid._ === 'string') text += kid._;
  return text.trim();
}
function elementKids(node) { return (node.kids || []).filter((kid) => kid['#name'] !== '__text__'); }
function nsOf(node) { return { uri: node.$ns?.uri || '', local: node.$ns?.local || String(node['#name'] || '') }; }

/** Generic bounds every customXml item obeys, then the root-specific shape. */
function validateCustomXmlShape(node, name, shape, failures) {
  const state = { count: 0 };
  const walk = (el, depth, rule) => {
    state.count += 1;
    if (state.count > CUSTOMXML_LIMITS.elements) { failures.push(`customXml part ${name} has more than ${CUSTOMXML_LIMITS.elements} elements`); return false; }
    if (depth > CUSTOMXML_LIMITS.depth) { failures.push(`customXml part ${name} nests deeper than ${CUSTOMXML_LIMITS.depth}`); return false; }
    const { uri, local } = nsOf(el);
    if (!NAME_TOKEN.test(local)) { failures.push(`customXml part ${name} carries an element whose name is not a bounded token`); return false; }
    let attributeCount = 0;
    for (const attribute of Object.values(el.$ || {})) {
      if (attribute.prefix === 'xmlns' || attribute.name === 'xmlns') continue;
      attributeCount += 1;
      if (attributeCount > CUSTOMXML_LIMITS.attributesPerElement) { failures.push(`customXml part ${name} element ${local} carries more than ${CUSTOMXML_LIMITS.attributesPerElement} attributes`); return false; }
      if (!NAME_TOKEN.test(String(attribute.local || ''))) { failures.push(`customXml part ${name} element ${local} carries an attribute whose name is not a bounded token`); return false; }
      if (String(attribute.value ?? '').length > CUSTOMXML_LIMITS.attributeChars) { failures.push(`customXml part ${name} attribute ${attribute.name} exceeds ${CUSTOMXML_LIMITS.attributeChars} characters`); return false; }
      if (!rule.attribute(attribute)) { failures.push(`customXml part ${name} carries attribute ${attribute.name} outside the characterized shape`); return false; }
    }
    const text = textOf(el);
    if (text.length > rule.textChars(uri, local)) { failures.push(`customXml part ${name} element ${local} carries ${text.length} characters of text, above its ceiling`); return false; }
    if (text && !rule.text(uri, local)) { failures.push(`customXml part ${name} element ${local} may not carry text`); return false; }
    const seen = new Map();
    for (const child of elementKids(el)) {
      const childRule = rule.child(nsOf(child), { uri, local });
      if (!childRule) { failures.push(`customXml part ${name} carries element ${nsOf(child).uri}:${nsOf(child).local} outside the characterized shape`); return false; }
      seen.set(nsOf(child).local, (seen.get(nsOf(child).local) || 0) + 1);
      if (!walk(child, depth + 1, childRule)) return false;
    }
    // Exact cardinality where the live shape is fixed (FormTemplates' three
    // tokens once each; exactly one documentManagement).
    for (const [childLocal, [min, max]] of Object.entries(rule.cardinality || {})) {
      const n = seen.get(childLocal) || 0;
      if (n < min || n > max) { failures.push(`customXml part ${name} element ${local} has ${n} ${childLocal} child(ren); expected ${min}..${max}`); return false; }
    }
    return true;
  };
  walk(node, 1, shape);
}

const unprefixedOr = (...uris) => (attribute) => !attribute.prefix || uris.includes(attribute.uri) || SITE_COLUMN_NS.test(attribute.uri || '');

// ct:contentTypeSchema: root, then XML Schema elements all the way down.
const XSD_RULE = {
  attribute: unprefixedOr(CT_NS, MA_NS, XML_NS),
  textChars: () => CUSTOMXML_LIMITS.textChars,
  text: (uri, local) => uri === XSD_NS && local === 'documentation',
  child: (child) => (child.uri === XSD_NS ? XSD_RULE : null),
};
const CONTENT_TYPE_SCHEMA_SHAPE = { ...XSD_RULE, text: () => false };

// FormTemplates: three token children, nothing else.
const FORM_TOKEN_RULE = {
  attribute: () => false, textChars: () => 64, text: () => true, child: () => null,
};
const FORM_TEMPLATES_SHAPE = {
  attribute: () => false, textChars: () => 0, text: () => false,
  child: (child) => (child.uri === FORMS_NS && ['Display', 'Edit', 'New'].includes(child.local) ? FORM_TOKEN_RULE : null),
  cardinality: { Display: [1, 1], Edit: [1, 1], New: [1, 1] },
};

// p:properties > documentManagement > site-column elements (GUID namespace)
// > PartnerControls Terms subtrees.
const TERMS_RULE = {
  attribute: unprefixedOr(XSI_NS), textChars: () => CUSTOMXML_LIMITS.textChars,
  text: (uri, local) => uri === PC_NS && (local === 'TermName' || local === 'TermId'),
  child: (child) => (child.uri === PC_NS && ['Terms', 'TermInfo', 'TermName', 'TermId'].includes(child.local) ? TERMS_RULE : null),
};
const COLUMN_RULE = {
  attribute: unprefixedOr(XSI_NS), textChars: () => CUSTOMXML_LIMITS.columnValueChars, text: () => true,
  child: (child) => (child.uri === PC_NS && child.local === 'Terms' ? TERMS_RULE : null),
};
const DOCUMENT_MANAGEMENT_RULE = {
  attribute: () => false, textChars: () => 0, text: () => false,
  child: (child) => (SITE_COLUMN_NS.test(child.uri) && NAME_TOKEN.test(child.local) ? COLUMN_RULE : null),
};
const PROPERTIES_SHAPE = {
  attribute: () => false, textChars: () => 0, text: () => false,
  child: (child, parent) => (parent.uri === P_NS && child.uri === '' && child.local === 'documentManagement' ? DOCUMENT_MANAGEMENT_RULE : null),
  cardinality: { documentManagement: [1, 1] },
};

// ds:datastoreItem, optionally with ds:schemaRefs > ds:schemaRef.
const DS_RULE = {
  attribute: unprefixedOr(DS_NS), textChars: () => 0, text: () => false,
  child: (child) => (child.uri === DS_NS && (child.local === 'schemaRefs' || child.local === 'schemaRef') ? DS_RULE : null),
};

const CUSTOMXML_SHAPES = {
  contentTypeSchema: CONTENT_TYPE_SCHEMA_SHAPE,
  FormTemplates: FORM_TEMPLATES_SHAPE,
  properties: PROPERTIES_SHAPE,
  datastoreItem: DS_RULE,
};
const CUSTOMXML_PROPS_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps';

// ── Fail-closed ZIP budget (slice 6c-ii Stage C, Codex plan rounds 13-14) ──
//
// The prior reader (`packageParts` above, kept only as the name every call
// site used before this change) inflated every ZIP member into memory with
// `file.async('nodebuffer')` and never checked a size ceiling until AFTER
// the whole package was already resident -- a compressed bomb (a small
// upload whose declared or actual inflated size is enormous) would exhaust
// memory before any check ran. This section:
//   1. parses the raw ZIP central directory itself (no JSZip involved) and
//      validates entry count, OPC-normalized name duplicates (exact and
//      path-alias) and declared per-part/total uncompressed sizes BEFORE
//      JSZip ever loads the archive;
//   2. then inflates each part through a streaming reader that counts bytes
//      as they arrive and aborts the stream the moment either ceiling is
//      exceeded -- never `file.async('nodebuffer')` followed by a length
//      check, which would have already materialized the oversized buffer.
// A bomb whose CENTRAL DIRECTORY LIES (a small declared uncompressed size
// that step 1 passes, while the real deflate stream produces far more) is
// exactly the case step 1 cannot catch and step 2 must: the fixture proving
// this crafts such a package deliberately (docx-package-attestation
// budget tests).
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_SIZE_SENTINEL = 0xffffffff;

export const DOCX_PACKAGE_BUDGET = Object.freeze({
  // A legitimate reviewer-uploaded DOCX or IA render has on the order of a
  // few dozen parts; 2,000 gives ample headroom for an unusually elaborate
  // document while still bounding a bomb's entry count.
  maxEntries: 2000,
  // No single OOXML part in a document of this scale plausibly exceeds
  // 100 MB uncompressed (the largest parts are embedded media, already
  // compressed formats that do not benefit from a second deflate pass).
  maxPartUncompressedBytes: 100 * 1024 * 1024,
  // The uploader's own limit already caps the compressed file at 25 MB
  // (review-upload.js); 200 MB total uncompressed leaves generous headroom
  // for legitimate compression ratios while still bounding a bomb's total
  // inflated size to something this process can hold in memory.
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
});

function findEndOfCentralDirectory(bytes) {
  const minLen = 22;
  if (bytes.length < minLen) throw new Error('ZIP central directory: file is too small to contain an End Of Central Directory record.');
  const maxCommentLen = 65535;
  const searchStart = Math.max(0, bytes.length - minLen - maxCommentLen);
  for (let i = bytes.length - minLen; i >= searchStart; i--) {
    if (bytes.readUInt32LE(i) === EOCD_SIGNATURE) {
      const commentLength = bytes.readUInt16LE(i + 20);
      if (i + minLen + commentLength === bytes.length) return i;
    }
  }
  throw new Error('ZIP central directory: End Of Central Directory record not found.');
}

function parseEndOfCentralDirectory(bytes, eocdOffset) {
  const diskNumber = bytes.readUInt16LE(eocdOffset + 4);
  const cdStartDisk = bytes.readUInt16LE(eocdOffset + 6);
  const entriesThisDisk = bytes.readUInt16LE(eocdOffset + 8);
  const totalEntries = bytes.readUInt16LE(eocdOffset + 10);
  const cdSize = bytes.readUInt32LE(eocdOffset + 12);
  const cdOffset = bytes.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || cdStartDisk !== 0 || entriesThisDisk !== totalEntries) {
    throw new Error('ZIP central directory: multi-disk archives are not supported.');
  }
  if (totalEntries === 0xffff || cdSize === ZIP64_SIZE_SENTINEL || cdOffset === ZIP64_SIZE_SENTINEL) {
    throw new Error('ZIP central directory: a ZIP64 sentinel value is not supported.');
  }
  if (eocdOffset >= 20 && bytes.readUInt32LE(eocdOffset - 20) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
    throw new Error('ZIP central directory: a ZIP64 end-of-central-directory locator is present; refusing.');
  }
  return { totalEntries, cdSize, cdOffset };
}

function parseCentralDirectoryEntries(bytes, { totalEntries, cdSize, cdOffset }) {
  const entries = [];
  let pos = cdOffset;
  const end = cdOffset + cdSize;
  if (end > bytes.length) throw new Error('ZIP central directory: the declared central directory extends past the end of the file.');
  while (pos < end) {
    if (pos + 46 > bytes.length) throw new Error('ZIP central directory: a header is truncated.');
    if (bytes.readUInt32LE(pos) !== CENTRAL_DIRECTORY_SIGNATURE) throw new Error('ZIP central directory: a header has a malformed signature.');
    const compressedSize = bytes.readUInt32LE(pos + 20);
    const uncompressedSize = bytes.readUInt32LE(pos + 24);
    const nameLen = bytes.readUInt16LE(pos + 28);
    const extraLen = bytes.readUInt16LE(pos + 30);
    const commentLen = bytes.readUInt16LE(pos + 32);
    if (compressedSize === ZIP64_SIZE_SENTINEL || uncompressedSize === ZIP64_SIZE_SENTINEL) {
      throw new Error('ZIP central directory: a ZIP64 size sentinel is not supported.');
    }
    const nameStart = pos + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > bytes.length) throw new Error('ZIP central directory: a filename is truncated.');
    const name = bytes.toString('utf8', nameStart, nameEnd);
    entries.push({ name, compressedSize, uncompressedSize });
    pos = nameEnd + extraLen + commentLen;
  }
  if (pos !== end) throw new Error('ZIP central directory: entries do not exactly fill the declared central directory size.');
  if (entries.length !== totalEntries) throw new Error('ZIP central directory: entry count does not match the declared total.');
  return entries;
}

/**
 * OPC-normalize a part name for path-alias duplicate detection: decode
 * percent-escapes, unify separators, collapse repeats, drop `.` segments
 * (P3-b, Opus round 1 -- `word/./document.xml` is the same part as
 * `word/document.xml`; a naive slash-collapse alone leaves the `.` segment
 * in place and misses this alias), drop a leading slash, and case-fold.
 */
function normalizePartNameForAliasing(name) {
  let decoded = name;
  try { decoded = decodeURIComponent(name); } catch { decoded = name; }
  return decoded.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/(^|\/)\.(\/|$)/g, '$1').replace(/\/+/g, '/').replace(/^\/+/, '').toLowerCase();
}

function assertNoDuplicateParts(entries) {
  const exact = new Set();
  const byAlias = new Map();
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue; // directory entry; not a part
    if (exact.has(entry.name)) throw new Error(`ZIP central directory: duplicate entry name "${entry.name}".`);
    exact.add(entry.name);
    const alias = normalizePartNameForAliasing(entry.name);
    const prior = byAlias.get(alias);
    if (prior && prior !== entry.name) {
      throw new Error(`ZIP central directory: "${prior}" and "${entry.name}" are path-alias duplicates of the same part.`);
    }
    byAlias.set(alias, entry.name);
  }
}

function assertWithinDeclaredBudget(entries, budget) {
  if (entries.length > budget.maxEntries) {
    throw new Error(`ZIP central directory: ${entries.length} entries exceeds the ${budget.maxEntries}-entry ceiling.`);
  }
  let total = 0;
  for (const entry of entries) {
    if (entry.uncompressedSize > budget.maxPartUncompressedBytes) {
      throw new Error(`ZIP central directory: part "${entry.name}" declares ${entry.uncompressedSize} uncompressed bytes, exceeding the per-part ceiling.`);
    }
    total += entry.uncompressedSize;
    if (total > budget.maxTotalUncompressedBytes) {
      throw new Error('ZIP central directory: declared total uncompressed size exceeds the package ceiling.');
    }
  }
}

/**
 * Parse and validate a ZIP's raw central directory, with no JSZip
 * involvement: entry count, OPC-normalized name duplicates (exact and
 * path-alias) and declared per-part/total uncompressed sizes. Throws on any
 * violation, including ZIP64 use (unsupported; fails closed) and multi-disk
 * archives. Returns the parsed (non-directory) entries.
 */
export function validateZipCentralDirectory(bytes, budget = DOCX_PACKAGE_BUDGET) {
  if (!Buffer.isBuffer(bytes)) throw new Error('ZIP central directory: input must be a Buffer.');
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const eocd = parseEndOfCentralDirectory(bytes, eocdOffset);
  const entries = parseCentralDirectoryEntries(bytes, eocd);
  assertNoDuplicateParts(entries);
  assertWithinDeclaredBudget(entries, budget);
  return entries.filter((entry) => !entry.name.endsWith('/'));
}

/** Stream-inflate one JSZip part, aborting the moment either ceiling is exceeded. Never buffers past the ceiling before checking. */
function readEntryBudgeted(zip, name, budget, totalState) {
  return new Promise((resolve, reject) => {
    const file = zip.file(name);
    if (!file) { reject(new Error(`ZIP part "${name}" is present in the central directory but not readable.`)); return; }
    let size = 0;
    const chunks = [];
    let settled = false;
    const stream = file.nodeStream('nodebuffer');
    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { stream.destroy(); } catch { /* already ending */ }
      reject(error);
    };
    stream.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      totalState.total += chunk.length;
      if (size > budget.maxPartUncompressedBytes || totalState.total > budget.maxTotalUncompressedBytes) {
        fail(new Error(`ZIP part "${name}" exceeded its inflate byte ceiling; aborting the stream.`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', fail);
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });
}

/**
 * Load a DOCX/ZIP package under the fail-closed budget above: the raw
 * central directory is validated first (no JSZip involved), then every part
 * is inflated through a streaming reader that aborts the instant either
 * ceiling is exceeded. Every part named in the central directory must be
 * readable by JSZip and vice versa -- a mismatch means the CD-based budget
 * check validated a different set of parts than what would actually be
 * inflated, which is itself refused.
 */
export async function packagePartsBudgeted(bytes, budget = DOCX_PACKAGE_BUDGET) {
  const cdEntries = validateZipCentralDirectory(bytes, budget);
  const zip = await JSZip.loadAsync(bytes);
  const zipFileNames = new Set(Object.keys(zip.files).filter((name) => !zip.files[name].dir));
  const cdNames = new Set(cdEntries.map((entry) => entry.name));
  for (const name of cdNames) {
    if (!zipFileNames.has(name)) throw new Error(`ZIP part "${name}" is present in the central directory but not readable.`);
  }
  for (const name of zipFileNames) {
    if (!cdNames.has(name)) throw new Error(`ZIP part "${name}" is present in the archive but missing from its central directory.`);
  }
  const parts = new Map();
  const totalState = { total: 0 };
  for (const name of cdNames) {
    // eslint-disable-next-line no-await-in-loop -- the running total must be
    // charged sequentially so the total ceiling aborts promptly.
    parts.set(name, await readEntryBudgeted(zip, name, budget, totalState));
  }
  return parts;
}

// ── Strict, namespace-aware OPC XML parsing (Codex slice review round 1) ──
//
// The previous regex helpers recognized only literal `<Relationship`,
// `<Override` and `<Default` element names with double-quoted attributes. A
// namespace-PREFIXED element (`<r:Relationship … TargetMode="External">`)
// or a single-quoted attribute was invisible to them, so a destination
// package could carry an unapproved external relationship and still attest
// as equivalent to its source. Both attestors now parse these parts with a
// real XML parser, resolve names by namespace URI + local name, refuse any
// element that is not the one expected in that namespace, and refuse
// duplicates. Malformed XML fails closed.
const PACKAGE_RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

/**
 * Decode an XML part's bytes by its byte-order mark (UTF-16 LE/BE, UTF-8)
 * before parsing; a bare `Buffer#toString()` read UTF-16 as UTF-8 and so
 * refused byte-identical packages whose parts a tool wrote in UTF-16
 * (Codex reviewer-differs-from-author round). Strings pass through.
 */
export function decodeXmlBytes(bytes) {
  if (typeof bytes === 'string') return bytes;
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.toString('utf8', 3);
  return b.toString('utf8');
}

async function parseOpcXml(xml) {
  const text = decodeXmlBytes(xml);
  // sax accepts a DOCTYPE in strict mode; no OPC part we characterize has
  // one, and it is the classic entity-expansion channel. Refuse up front.
  if (/<!DOCTYPE/i.test(text)) throw new Error('DOCTYPE declarations are not accepted in package XML parts');
  return parseStringPromise(text, {
    xmlns: true, explicitArray: true, explicitChildren: true, preserveChildrenOrder: true, childkey: 'kids', charkey: '_',
  });
}

// OPC attributes on Relationship / Override / Default are unprefixed. A
// prefixed attribute in a foreign namespace (`x:Type="…/customXml"`) must
// not shadow the unprefixed one an OPC consumer reads, so anything other
// than a namespace declaration with a prefix is a failure, never a value.
function localAttributes(node, failures, label) {
  const out = {};
  for (const attribute of Object.values(node?.$ || {})) {
    if (attribute.prefix === 'xmlns' || attribute.name === 'xmlns') continue;
    if (attribute.prefix) { failures.push(`${label} carries a namespaced attribute ${attribute.name}`); continue; }
    out[attribute.local] = attribute.value;
  }
  return out;
}

// ── Normalized-part policy (Codex reviewer-differs-from-author re-reviews) ──
//
// Every part the attestors do NOT compare byte-for-byte is a channel unless
// it has (1) a byte ceiling, (2) no comments or processing instructions
// (xml2js drops both before any walk, so they were invisible), and (3) a
// shape: which elements, which attributes by exact local name, where text
// may appear. This section applies all three to every normalized part.
const NORMALIZED_PART_CEILINGS = Object.freeze({
  [CONTENT_TYPES_PART]: 32 * 1024,
  [DOCUMENT_RELS_PART]: 32 * 1024,
  'docProps/core.xml': 8 * 1024,
  'docProps/custom.xml': 8 * 1024,
});
const OPC_ATTRIBUTE_CHARS = 2048;
const OPC_ELEMENTS = 4096;
const CORE_PROPS_NS = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const DC_NS = 'http://purl.org/dc/elements/1.1/';
const DCTERMS_NS = 'http://purl.org/dc/terms/';
const CUSTOM_PROPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties';
const VT_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';
const CORE_PROPERTY_NAMES = new Set(['title', 'subject', 'creator', 'keywords', 'description', 'lastModifiedBy', 'revision', 'lastPrinted', 'created', 'modified', 'category', 'contentStatus', 'identifier', 'language', 'version']);
const VT_VALUE_TYPES = new Set(['lpwstr', 'lpstr', 'bstr', 'i1', 'i2', 'i4', 'i8', 'int', 'ui1', 'ui2', 'ui4', 'ui8', 'uint', 'r4', 'r8', 'bool', 'filetime', 'date', 'decimal', 'null', 'empty', 'cy', 'error']);

/**
 * Refuse comments and processing instructions in a decoded part's text
 * (the `<?xml …?>` declaration at offset 0 and any explicitly allowed PI
 * excepted). A `<!--` or `<?` inside attribute text or CDATA is refused
 * too: no characterized part carries one, so failing closed costs nothing.
 */
function refuseCommentsAndPIs(text, name, failures, allowedPIs = []) {
  if (/<!DOCTYPE/i.test(text)) { failures.push(`part ${name} carries a DOCTYPE`); return false; }
  if (text.includes('<!--')) { failures.push(`part ${name} carries an XML comment`); return false; }
  let index = text.indexOf('<?');
  while (index !== -1) {
    const declaration = index === 0 && text.startsWith('<?xml', 0);
    const allowed = allowedPIs.some((pi) => text.startsWith(pi, index));
    if (!declaration && !allowed) { failures.push(`part ${name} carries a processing instruction`); return false; }
    index = text.indexOf('<?', index + 2);
  }
  return true;
}

/** An OPC element that must be empty and carry only the named unprefixed attributes. */
function emptyElementAttributes(node, allowedNames, label, failures) {
  const attrs = localAttributes(node, failures, label);
  for (const attribute of Object.values(node.$ || {})) {
    if (attribute.prefix === 'xmlns' || attribute.name === 'xmlns' || attribute.prefix) continue;
    if (!allowedNames.includes(attribute.local)) failures.push(`${label} carries an unexpected attribute ${attribute.local}`);
    if (String(attribute.value ?? '').length > OPC_ATTRIBUTE_CHARS) failures.push(`${label} attribute ${attribute.local} exceeds ${OPC_ATTRIBUTE_CHARS} characters`);
  }
  if (elementKids(node).length) failures.push(`${label} carries child elements`);
  if (textOf(node)) failures.push(`${label} carries text`);
  return attrs;
}

/**
 * Parse a package `.rels` part strictly. Returns `{ rels, failures }`: every
 * `Relationship` element in the package-relationships namespace (by URI, so
 * a prefixed `<r:Relationship>` IS a relationship), with `Id`, `Type`,
 * `Target` and `TargetMode`; any other element, a missing/duplicate `Id`,
 * an unexpected attribute, child content, a comment or PI, or unparsable
 * XML is a failure.
 */
async function relationships(xml, label = 'relationships part') {
  const failures = [];
  const text = decodeXmlBytes(xml);
  if (!refuseCommentsAndPIs(text, label, failures)) return { rels: [], failures };
  let doc;
  try {
    doc = await parseOpcXml(text);
  } catch (error) {
    return { rels: [], failures: [`${label} is not well-formed XML (${String(error.message || error).slice(0, 80)})`] };
  }
  const rootName = Object.keys(doc || {})[0];
  const root = doc?.[rootName];
  if (!root || root.$ns?.uri !== PACKAGE_RELS_NS || root.$ns?.local !== 'Relationships') {
    return { rels: [], failures: [`${label} root element is not Relationships in the package namespace`] };
  }
  localAttributes(root, failures, label);
  if (textOf(root)) failures.push(`${label} carries text`);
  const rels = [];
  const seenIds = new Set();
  const kids = elementKids(root);
  if (kids.length > OPC_ELEMENTS) return { rels: [], failures: [`${label} carries more than ${OPC_ELEMENTS} elements`] };
  for (const child of kids) {
    if (child.$ns?.uri !== PACKAGE_RELS_NS || child.$ns?.local !== 'Relationship') {
      failures.push(`${label} carries an unexpected element ${child.$ns?.uri || ''}:${child.$ns?.local || child['#name']}`);
      continue;
    }
    const attrs = emptyElementAttributes(child, ['Id', 'Type', 'Target', 'TargetMode'], `${label} relationship`, failures);
    if (!attrs.Id) { failures.push(`${label} carries a relationship with no Id`); continue; }
    if (seenIds.has(attrs.Id)) failures.push(`${label} repeats relationship ${attrs.Id}`);
    seenIds.add(attrs.Id);
    rels.push({ Id: attrs.Id, Type: attrs.Type, Target: attrs.Target, TargetMode: attrs.TargetMode });
  }
  return { rels, failures };
}

/**
 * Parse `[Content_Types].xml` strictly. Returns `{ overrides, defaults,
 * failures }` with entries matched by namespace URI + local name; any other
 * element, attribute, child content, comment, PI, or unparsable XML is a
 * failure. (Duplicate PartName / Extension detection stays in the
 * comparator, which reports them per side.)
 */
async function contentTypes(xml, label = '[Content_Types].xml') {
  const failures = [];
  const text = decodeXmlBytes(xml);
  if (!refuseCommentsAndPIs(text, label, failures)) return { overrides: [], defaults: [], failures };
  let doc;
  try {
    doc = await parseOpcXml(text);
  } catch (error) {
    return { overrides: [], defaults: [], failures: [`${label} is not well-formed XML (${String(error.message || error).slice(0, 80)})`] };
  }
  const rootName = Object.keys(doc || {})[0];
  const root = doc?.[rootName];
  if (!root || root.$ns?.uri !== CONTENT_TYPES_NS || root.$ns?.local !== 'Types') {
    return { overrides: [], defaults: [], failures: [`${label} root element is not Types in the content-types namespace`] };
  }
  localAttributes(root, failures, label);
  if (textOf(root)) failures.push(`${label} carries text`);
  const overrides = [];
  const defaults = [];
  const kids = elementKids(root);
  if (kids.length > OPC_ELEMENTS) return { overrides: [], defaults: [], failures: [`${label} carries more than ${OPC_ELEMENTS} elements`] };
  for (const child of kids) {
    if (child.$ns?.uri === CONTENT_TYPES_NS && child.$ns?.local === 'Override') {
      const attrs = emptyElementAttributes(child, ['PartName', 'ContentType'], `${label} Override`, failures);
      overrides.push({ PartName: attrs.PartName, ContentType: attrs.ContentType });
    } else if (child.$ns?.uri === CONTENT_TYPES_NS && child.$ns?.local === 'Default') {
      const attrs = emptyElementAttributes(child, ['Extension', 'ContentType'], `${label} Default`, failures);
      defaults.push({ Extension: attrs.Extension, ContentType: attrs.ContentType });
    } else failures.push(`${label} carries an unexpected element ${child.$ns?.uri || ''}:${child.$ns?.local || child['#name']}`);
  }
  return { overrides, defaults, failures };
}

/** Parse a part; returns `{ root: { uri, local }, node }` or null when not well-formed. */
async function parsedDocument(xml) {
  let doc;
  try {
    doc = await parseOpcXml(xml);
  } catch {
    return null;
  }
  const node = doc?.[Object.keys(doc || {})[0]];
  if (!node?.$ns?.local) return null;
  return { root: { uri: node.$ns.uri || '', local: node.$ns.local }, node };
}

const sameRoot = (a, b) => Boolean(a) && a.uri === b.uri && a.local === b.local;

/**
 * `docProps/core.xml`: `cp:coreProperties` with flat Dublin Core / core
 * children (each at most once, text-only, `xsi:type` the only attribute).
 * SharePoint rewrites this part on promotion (timestamps, lastModifiedBy);
 * the values are not compared, the shape and ceiling are enforced.
 */
async function validateCoreProperties(name, bytes, failures) {
  const text = decodeXmlBytes(bytes);
  if (!refuseCommentsAndPIs(text, name, failures)) return;
  const parsed = await parsedDocument(text);
  if (!sameRoot(parsed?.root, { uri: CORE_PROPS_NS, local: 'coreProperties' })) { failures.push(`part ${name} is not a core-properties document`); return; }
  localAttributes(parsed.node, failures, name);
  if (textOf(parsed.node)) failures.push(`part ${name} root carries text`);
  const seen = new Set();
  for (const child of elementKids(parsed.node)) {
    const { uri, local } = nsOf(child);
    if (![CORE_PROPS_NS, DC_NS, DCTERMS_NS].includes(uri) || !CORE_PROPERTY_NAMES.has(local)) { failures.push(`part ${name} carries element ${uri}:${local} outside the core-properties shape`); return; }
    if (seen.has(local)) { failures.push(`part ${name} repeats ${local}`); return; }
    seen.add(local);
    for (const attribute of Object.values(child.$ || {})) {
      if (attribute.prefix === 'xmlns' || attribute.name === 'xmlns') continue;
      if (attribute.uri !== XSI_NS || attribute.local !== 'type' || String(attribute.value).length > 64) { failures.push(`part ${name} element ${local} carries attribute ${attribute.name} outside the core-properties shape`); return; }
    }
    if (elementKids(child).length) { failures.push(`part ${name} element ${local} carries child elements`); return; }
    if (textOf(child).length > CUSTOMXML_LIMITS.columnValueChars) { failures.push(`part ${name} element ${local} exceeds ${CUSTOMXML_LIMITS.columnValueChars} characters`); return; }
  }
}

/**
 * `docProps/custom.xml`: `Properties` holding `property` elements (fmtid,
 * pid, name; at most 64) each with exactly one `vt:*` scalar child.
 * SharePoint adds its `ContentTypeId` property here on promotion.
 */
async function validateCustomProperties(name, bytes, failures) {
  const text = decodeXmlBytes(bytes);
  if (!refuseCommentsAndPIs(text, name, failures)) return;
  const parsed = await parsedDocument(text);
  if (!sameRoot(parsed?.root, { uri: CUSTOM_PROPS_NS, local: 'Properties' })) { failures.push(`part ${name} is not a custom-properties document`); return; }
  localAttributes(parsed.node, failures, name);
  if (textOf(parsed.node)) failures.push(`part ${name} root carries text`);
  const properties = elementKids(parsed.node);
  if (properties.length > 64) { failures.push(`part ${name} carries more than 64 properties`); return; }
  for (const property of properties) {
    if (!sameRoot(nsOf(property), { uri: CUSTOM_PROPS_NS, local: 'property' })) { failures.push(`part ${name} carries element ${nsOf(property).uri}:${nsOf(property).local} outside the custom-properties shape`); return; }
    const attrs = localAttributes(property, failures, name);
    for (const key of Object.keys(attrs)) {
      if (!['fmtid', 'pid', 'name', 'linkTarget'].includes(key) || String(attrs[key]).length > CUSTOMXML_LIMITS.attributeChars) { failures.push(`part ${name} property carries attribute ${key} outside the custom-properties shape`); return; }
    }
    if (textOf(property)) { failures.push(`part ${name} property carries text`); return; }
    const values = elementKids(property);
    if (values.length !== 1 || nsOf(values[0]).uri !== VT_NS || !VT_VALUE_TYPES.has(nsOf(values[0]).local)) { failures.push(`part ${name} property ${attrs.name || ''} does not hold exactly one vt scalar`); return; }
    localAttributes(values[0], failures, name);
    if (elementKids(values[0]).length) { failures.push(`part ${name} property ${attrs.name || ''} value carries child elements`); return; }
    if (textOf(values[0]).length > CUSTOMXML_LIMITS.columnValueChars) { failures.push(`part ${name} property ${attrs.name || ''} exceeds ${CUSTOMXML_LIMITS.columnValueChars} characters`); return; }
  }
}

async function validateCustomXmlItem(name, bytes, roots, maxBytes, failures, notLabel, allowedPIs) {
  if (bytes.length > maxBytes) { failures.push(`customXml part ${name} exceeds the ${maxBytes}-byte ceiling for a SharePoint-added part`); return; }
  const text = decodeXmlBytes(bytes);
  if (!refuseCommentsAndPIs(text, name, failures, allowedPIs)) return;
  const parsed = await parsedDocument(text);
  const known = parsed && roots.find((r) => sameRoot(parsed.root, r));
  if (!known) { failures.push(`customXml part ${name} is not a SharePoint ${notLabel}`); return; }
  validateCustomXmlShape(parsed.node, name, CUSTOMXML_SHAPES[known.local], failures);
}

async function validateCustomXml(name, bytes, failures) {
  if (/^customXml\/itemProps\d+\.xml$/.test(name)) {
    await validateCustomXmlItem(name, bytes, [CUSTOMXML_PROPS_ROOT], CUSTOMXML_LIMITS.propsBytes, failures, 'datastore item', []);
  } else if (/^customXml\/_rels\/item\d+\.xml\.rels$/.test(name)) {
    if (bytes.length > CUSTOMXML_LIMITS.relsBytes) { failures.push(`customXml part ${name} exceeds the ${CUSTOMXML_LIMITS.relsBytes}-byte ceiling for a SharePoint-added part`); return; }
    const parsed = await relationships(bytes, name);
    failures.push(...parsed.failures);
    const rels = parsed.rels;
    const n = name.match(/item(\d+)\.xml\.rels$/)?.[1];
    if (rels.length !== 1 || rels.some((r) => r.Type !== CUSTOMXML_PROPS_REL_TYPE || (r.TargetMode || 'Internal') !== 'Internal' || r.Target !== `itemProps${n}.xml`)) {
      failures.push(`customXml relationships part ${name} carries a non-customXmlProps relationship`);
    }
  } else {
    // `<?mso-contentType?>` is the one PI SharePoint writes (FormTemplates).
    await validateCustomXmlItem(name, bytes, SHAREPOINT_CUSTOMXML_ITEM_ROOTS, CUSTOMXML_LIMITS.itemBytes, failures, 'property-promotion item', ['<?mso-contentType?>']);
  }
}

/**
 * The added customXml parts form ONE closed graph: item N ⇔ itemProps N ⇔
 * _rels/item N (targeting itemProps N), exactly the tolerated document
 * relationships target `../customXml/itemN.xml`, and exactly the added
 * content-type overrides name `/customXml/itemPropsN.xml`. Orphans, extra
 * items, extra relationships or overrides, and an aggregate above the
 * ceiling fail. With no added customXml, no tolerated relationship and no
 * added override may exist.
 */
function validatePromotionGraph({ addedCustomXml, toleratedDocRels, addedOverrides }, failures) {
  const items = new Set(); const props = new Set(); const rels = new Set();
  let bytes = 0;
  for (const [name, size] of addedCustomXml) {
    bytes += size;
    let m;
    if ((m = name.match(/^customXml\/item(\d+)\.xml$/))) items.add(m[1]);
    else if ((m = name.match(/^customXml\/itemProps(\d+)\.xml$/))) props.add(m[1]);
    else if ((m = name.match(/^customXml\/_rels\/item(\d+)\.xml\.rels$/))) rels.add(m[1]);
  }
  if (items.size > CUSTOMXML_LIMITS.addedItems) failures.push(`SharePoint promotion added ${items.size} customXml items; at most ${CUSTOMXML_LIMITS.addedItems} are characterized`);
  if (bytes > CUSTOMXML_LIMITS.addedBytes) failures.push(`SharePoint promotion added ${bytes} bytes of customXml parts, above the ${CUSTOMXML_LIMITS.addedBytes}-byte ceiling`);
  const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  if (!same(items, props) || !same(items, rels)) failures.push('added customXml items, itemProps and rels parts do not form matching sets');
  const expectedRelTargets = new Set([...items].map((n) => `../customXml/item${n}.xml`));
  const relTargets = new Set(toleratedDocRels.map((r) => r.Target));
  if (toleratedDocRels.length !== relTargets.size) failures.push('tolerated customXml document relationships repeat a target');
  if (!same(expectedRelTargets, relTargets)) failures.push(`tolerated customXml document relationships target ${[...relTargets].sort().join(', ') || 'nothing'}; expected ${[...expectedRelTargets].sort().join(', ') || 'nothing'}`);
  const expectedOverrides = new Set([...items].map((n) => `/customXml/itemProps${n}.xml`));
  const overrides = new Set(addedOverrides);
  if (!same(expectedOverrides, overrides)) failures.push(`added content-type overrides name ${[...overrides].sort().join(', ') || 'nothing'}; expected ${[...expectedOverrides].sort().join(', ') || 'nothing'}`);
}

const sameRel = (a, b) => a.Id === b.Id && a.Type === b.Type && a.Target === b.Target && (a.TargetMode || 'Internal') === (b.TargetMode || 'Internal');

/**
 * The one promotion attestor behind both public entry points. `baseline` is
 * either the app's own fresh render or the bundle's copy of the uploaded
 * source. Every part present in the baseline is a byte-identical
 * obligation except the characterized SharePoint rewrites (`docProps/
 * core.xml`, `docProps/custom.xml`, `[Content_Types].xml`, the document
 * rels), each held to a ceiling and a shape; every part absent from the
 * baseline must be a SharePoint addition (customXml items with their
 * shapes, `[trash]` padding), and the additions must form one closed graph.
 */
async function attestPromotion(actual, baseline, { baselineLabel, fullContentTypes }) {
  const failures = [];
  const normalizedParts = [];
  const addedCustomXml = new Map();
  let toleratedDocRels = [];
  let addedOverrides = [];
  for (const [name, bytes] of actual) {
    const ceiling = NORMALIZED_PART_CEILINGS[name];
    if (ceiling && bytes.length > ceiling) { failures.push(`part ${name} exceeds its ${ceiling}-byte ceiling`); continue; }
    if (TRASH.test(name)) { validateTrash(name, bytes, failures); normalizedParts.push(name); continue; }
    if (name === 'docProps/core.xml') { await validateCoreProperties(name, bytes, failures); normalizedParts.push(name); continue; }
    if (name === 'docProps/custom.xml') { await validateCustomProperties(name, bytes, failures); normalizedParts.push(name); continue; }
    if (SHAREPOINT_CUSTOMXML.test(name)) {
      if (baseline.has(name)) {
        // Pre-existing part with a SharePoint-shaped name: the baseline's
        // own custom XML, never root-matched -- byte-identical like any
        // other pre-existing part.
        if (Buffer.compare(bytes, baseline.get(name)) !== 0) failures.push(`part ${name} differs from the ${baselineLabel}`);
      } else {
        await validateCustomXml(name, bytes, failures);
        addedCustomXml.set(name, bytes.length);
      }
      normalizedParts.push(name);
      continue;
    }
    if (name === DOCUMENT_RELS_PART) {
      const expectedParsed = await relationships(baseline.get(name) || '', `${baselineLabel} document relationships`);
      const foundParsed = await relationships(bytes, 'document relationships');
      failures.push(...expectedParsed.failures, ...foundParsed.failures);
      const expected = expectedParsed.rels;
      const found = foundParsed.rels;
      for (const rel of expected) {
        if (!found.some((f) => sameRel(f, rel))) failures.push(`document relationship ${rel.Id} (${rel.Target}) is missing`);
      }
      for (const rel of found) {
        const known = expected.some((e) => sameRel(e, rel));
        if (known) continue;
        if (!/\/relationships\/customXml$/.test(rel.Type || '')) failures.push(`document relationship ${rel.Id} (${rel.Type}) is not a SharePoint customXml relationship`);
        else if (String(rel.TargetMode || 'Internal') !== 'Internal') failures.push(`document relationship ${rel.Id} (${rel.Target}) is an external customXml relationship`);
        else toleratedDocRels.push(rel);
      }
      normalizedParts.push(name);
      continue;
    }
    if (name === CONTENT_TYPES_PART) {
      const expectedCt = await contentTypes(baseline.get(name) || '', `${baselineLabel} [Content_Types].xml`);
      const foundCt = await contentTypes(bytes);
      failures.push(...expectedCt.failures, ...foundCt.failures);
      // P3-4 (Opus round 2): a Map would silently collapse duplicate
      // PartName / Extension entries (last wins); refuse duplicates on
      // either side. OPC Default extensions are case-insensitive.
      const uniqueMap = (rows, keyOf, label) => {
        const map = new Map();
        for (const row of rows) {
          const key = keyOf(row);
          if (map.has(key)) failures.push(`[Content_Types].xml repeats ${label} ${key}`);
          map.set(key, row.ContentType);
        }
        return map;
      };
      const expectedOverrides = uniqueMap(expectedCt.overrides, (o) => o.PartName, 'override');
      const foundOverrides = uniqueMap(foundCt.overrides, (o) => o.PartName, 'override');
      for (const [part, contentType] of expectedOverrides) {
        if (!foundOverrides.has(part)) failures.push(`content-type override ${part} is missing`);
        // Full comparison (P3-a, Opus round 1) against an uploader-supplied
        // source; the render baseline keeps the weaker PartName-only check
        // by design (its baseline is the app's own render).
        else if (fullContentTypes && foundOverrides.get(part) !== contentType) failures.push(`content-type override ${part} changed ContentType (was ${contentType}, now ${foundOverrides.get(part)})`);
      }
      for (const part of foundOverrides.keys()) {
        if (expectedOverrides.has(part)) continue;
        if (!/^\/customXml\/itemProps\d+\.xml$/.test(part)) failures.push(`content-type override ${part} is not a SharePoint customXml part`);
        else if (fullContentTypes && foundOverrides.get(part) !== 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml') failures.push(`content-type override ${part} is not the customXmlProperties content type`);
        else addedOverrides.push(part);
      }
      const expectedDefaults = uniqueMap(expectedCt.defaults, (d) => String(d.Extension || '').toLowerCase(), 'default extension');
      const foundDefaults = uniqueMap(foundCt.defaults, (d) => String(d.Extension || '').toLowerCase(), 'default extension');
      for (const [ext, contentType] of expectedDefaults) {
        if (!foundDefaults.has(ext)) failures.push(`content-type default for extension ${ext} is missing`);
        else if (fullContentTypes && foundDefaults.get(ext) !== contentType) failures.push(`content-type default for extension ${ext} changed ContentType (was ${contentType}, now ${foundDefaults.get(ext)})`);
      }
      for (const ext of foundDefaults.keys()) {
        if (!expectedDefaults.has(ext)) failures.push(`content-type default for extension ${ext} was added`);
      }
      normalizedParts.push(name);
      continue;
    }
    const expectedBytes = baseline.get(name);
    if (!expectedBytes) { failures.push(`unexpected part ${name}`); continue; }
    if (Buffer.compare(bytes, expectedBytes) !== 0) failures.push(`part ${name} differs from the ${baselineLabel}`);
    normalizedParts.push(name);
  }
  for (const name of baseline.keys()) {
    if (!actual.has(name) && !METADATA_PARTS.has(name)) failures.push(`part ${name} is missing`);
  }
  validatePromotionGraph({ addedCustomXml, toleratedDocRels, addedOverrides }, failures);
  return { failures, normalizedParts };
}

/**
 * Attest that `actualBytes` is `renderBytes` plus nothing but SharePoint's
 * characterized property promotion. Returns `{ normalizedParts }` on
 * success; throws an Error whose `.failures` lists every offending part.
 */
export async function attestDocxPackageAgainstRender(actualBytes, renderBytes, budget = DOCX_PACKAGE_BUDGET) {
  const [actual, render] = await Promise.all([
    packagePartsBudgeted(actualBytes, budget),
    packagePartsBudgeted(renderBytes, budget),
  ]);
  const { failures, normalizedParts } = await attestPromotion(actual, render, { baselineLabel: 'render', fullContentTypes: false });
  if (failures.length) {
    const error = new Error(`DOCX package differs from the render beyond SharePoint property promotion: ${failures.join('; ')}`);
    error.failures = failures;
    throw error;
  }
  return { normalizedParts };
}

/**
 * Attest that `destinationBytes` (a copied reviewer-uploaded DOCX, freshly
 * downloaded from the destination SharePoint drive) is `sourceBytes` (the
 * bundle's own downloaded copy of the SAME uploader-accepted file) plus
 * nothing but SharePoint's characterized property promotion (slice 6c-ii
 * Stage C; plan "Verify", Codex plan rounds 11-12). A reviewer-uploaded
 * DOCX may already carry its own custom XML (`validateReviewFile` accepts
 * any ZIP-magic `.docx`), so every part present in the source -- including
 * a pre-existing `customXml/item*.xml` -- is a byte-identical obligation,
 * and only a part NEW in the destination is validated as a SharePoint
 * addition. Content types are compared in full here (ContentType values
 * and Defaults), unlike the render baseline.
 *
 * Returns `{ normalizedParts }` on success; throws an Error whose
 * `.failures` lists every offending part.
 */
export async function attestDocxPackageAgainstSource(destinationBytes, sourceBytes, budget = DOCX_PACKAGE_BUDGET) {
  const [actual, source] = await Promise.all([
    packagePartsBudgeted(destinationBytes, budget),
    packagePartsBudgeted(sourceBytes, budget),
  ]);
  const { failures, normalizedParts } = await attestPromotion(actual, source, { baselineLabel: 'source', fullContentTypes: true });
  if (failures.length) {
    const error = new Error(`DOCX package differs from the source beyond SharePoint property promotion: ${failures.join('; ')}`);
    error.failures = failures;
    throw error;
  }
  return { normalizedParts };
}
