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

// Only the two metadata parts SharePoint actually rewrote live (and
// core.xml is also the one render-nondeterministic part). docProps/app.xml
// was unchanged by promotion and is therefore held byte-identical.
const METADATA_PARTS = new Set(['docProps/core.xml', 'docProps/custom.xml']);
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

/**
 * `[Content_Types].xml` <Override>/<Default> elements, with their
 * ContentType, for attestDocxPackageAgainstSource's full comparison (P3-a,
 * Opus round 1). attestDocxPackageAgainstRender (the IA-render attestor)
 * keeps using the weaker `overrides()` above (PartName presence only, no
 * ContentType and no <Default> check) -- an intentionally inherited gap,
 * since its baseline is always this app's own fresh render, never an
 * uploader-supplied file an attacker could shape.
 */
function attributesOf(tagRegex, xml) {
  return Array.from(String(xml).matchAll(tagRegex)).map((m) => {
    const attrs = {};
    for (const a of m[1].matchAll(ATTRIBUTE)) attrs[a[1]] = a[2];
    return attrs;
  });
}
function overridesFull(xml) {
  return attributesOf(/<Override\b([^>]*)\/?>/g, xml);
}
function defaultsFull(xml) {
  return attributesOf(/<Default\b([^>]*)\/?>/g, xml);
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
export async function attestDocxPackageAgainstRender(actualBytes, renderBytes, budget = DOCX_PACKAGE_BUDGET) {
  const [actual, render] = await Promise.all([
    packagePartsBudgeted(actualBytes, budget),
    packagePartsBudgeted(renderBytes, budget),
  ]);
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
      // Intentionally the WEAKER comparison (P3-a, Opus round 1):
      // override PartName presence only, no ContentType check and no
      // <Default> check at all -- unlike attestDocxPackageAgainstSource's
      // full comparison below. Safe here only because the baseline is
      // always this app's own fresh render (never attacker-influenced),
      // so there is nothing to gain from the stricter check that
      // attestDocxPackageAgainstSource needs against an uploader-supplied
      // source file.
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

/**
 * Attest that `destinationBytes` (a copied reviewer-uploaded DOCX, freshly
 * downloaded from the destination SharePoint drive) is `sourceBytes` (the
 * bundle's own downloaded copy of the SAME uploader-accepted file) plus
 * nothing but SharePoint's characterized property promotion (slice 6c-ii
 * Stage C; plan "Verify", Codex plan rounds 11-12).
 *
 * `attestDocxPackageAgainstRender` above assumes a FRESH-RENDER baseline and
 * therefore treats every `customXml/item*.xml` (etc.) part as one of
 * SharePoint's additions, validated only by its characterized root element
 * -- correct when the baseline is a render the app itself produced, which
 * never carries its own custom XML. A reviewer-uploaded DOCX is different:
 * `validateReviewFile` (file-magic.js) accepts any ZIP-magic `.docx`, so the
 * SOURCE may already carry its own, unrelated custom XML (form templates
 * from the reviewer's own Word installation, document-management metadata
 * from their institution, etc.). Root-matching such a part would silently
 * accept an attacker's substituted customXml payload as if SharePoint had
 * added it. This comparator therefore treats every part already present in
 * the source as a byte-identical obligation -- including a pre-existing
 * `customXml/item*.xml` -- and only validates a part's SharePoint root when
 * that part is NEW (absent from the source, present only in the
 * destination).
 *
 * Returns `{ normalizedParts }` on success; throws an Error whose
 * `.failures` lists every offending part.
 */
export async function attestDocxPackageAgainstSource(destinationBytes, sourceBytes, budget = DOCX_PACKAGE_BUDGET) {
  const [actual, source] = await Promise.all([
    packagePartsBudgeted(destinationBytes, budget),
    packagePartsBudgeted(sourceBytes, budget),
  ]);
  const failures = [];
  const normalizedParts = [];
  for (const [name, bytes] of actual) {
    if (TRASH.test(name)) { normalizedParts.push(name); continue; }
    if (METADATA_PARTS.has(name)) { normalizedParts.push(name); continue; }
    if (SHAREPOINT_CUSTOMXML.test(name)) {
      if (source.has(name)) {
        // Pre-existing part with a SharePoint-shaped name: this is the
        // UPLOADER'S OWN custom XML (or coincidentally shaped), never
        // root-matched -- compared byte-identical like any other
        // pre-existing part.
        if (Buffer.compare(bytes, source.get(name)) !== 0) failures.push(`part ${name} differs from the source`);
      } else {
        // New in the destination: only a genuine SharePoint addition is
        // permitted, validated by its characterized root element.
        validateCustomXml(name, bytes, failures);
      }
      normalizedParts.push(name);
      continue;
    }
    if (name === DOCUMENT_RELS_PART) {
      const expected = relationships(source.get(name) || '');
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
      // Full comparison (P3-a, Opus round 1): a changed ContentType on an
      // EXISTING override, or an ADDED <Default>, must fail -- not just a
      // missing/unexpected override PartName. SharePoint's own promotion
      // only ever ADDS <Override> entries for its new customXml parts; it
      // never touches an existing override's ContentType, and never adds a
      // <Default>, so neither is a tolerated mutation here.
      const expectedOverrides = new Map(overridesFull(source.get(name) || '').map((o) => [o.PartName, o.ContentType]));
      const foundOverrides = new Map(overridesFull(bytes).map((o) => [o.PartName, o.ContentType]));
      for (const [part, contentType] of expectedOverrides) {
        if (!foundOverrides.has(part)) failures.push(`content-type override ${part} is missing`);
        else if (foundOverrides.get(part) !== contentType) failures.push(`content-type override ${part} changed ContentType (was ${contentType}, now ${foundOverrides.get(part)})`);
      }
      for (const part of foundOverrides.keys()) {
        if (!expectedOverrides.has(part) && !SHAREPOINT_CUSTOMXML.test(part.replace(/^\//, ''))) failures.push(`content-type override ${part} is not a SharePoint customXml part`);
      }
      const expectedDefaults = new Map(defaultsFull(source.get(name) || '').map((d) => [d.Extension, d.ContentType]));
      const foundDefaults = new Map(defaultsFull(bytes).map((d) => [d.Extension, d.ContentType]));
      for (const [ext, contentType] of expectedDefaults) {
        if (!foundDefaults.has(ext)) failures.push(`content-type default for extension ${ext} is missing`);
        else if (foundDefaults.get(ext) !== contentType) failures.push(`content-type default for extension ${ext} changed ContentType (was ${contentType}, now ${foundDefaults.get(ext)})`);
      }
      for (const ext of foundDefaults.keys()) {
        if (!expectedDefaults.has(ext)) failures.push(`content-type default for extension ${ext} was added`);
      }
      normalizedParts.push(name);
      continue;
    }
    const sourceBytesForPart = source.get(name);
    if (!sourceBytesForPart) { failures.push(`unexpected new part ${name}`); continue; }
    if (Buffer.compare(bytes, sourceBytesForPart) !== 0) failures.push(`part ${name} differs from the source`);
    normalizedParts.push(name);
  }
  for (const name of source.keys()) {
    if (!actual.has(name) && !METADATA_PARTS.has(name)) failures.push(`part ${name} is missing`);
  }
  if (failures.length) {
    const error = new Error(`DOCX package differs from the source beyond SharePoint property promotion: ${failures.join('; ')}`);
    error.failures = failures;
    throw error;
  }
  return { normalizedParts };
}
