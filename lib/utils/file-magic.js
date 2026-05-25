/**
 * Magic-byte sniffing for review-upload validation.
 *
 * The file extension and the browser-supplied Content-Type can both be lied
 * about — checking the file's actual leading bytes is a cheap defense against
 * an attacker uploading a renamed `.exe` as `.pdf`. Note this is not a virus
 * scanner; SharePoint's M365 Defender pipeline handles malware downstream.
 *
 * Supported types are the three the review form accepts:
 *   - PDF      — '%PDF-'           (0x25 50 44 46 2D)
 *   - DOCX     — ZIP signature     (0x50 4B 03 04) — DOCX is OOXML in a zip
 *   - DOC      — OLE2 compound     (0xD0 CF 11 E0 A1 B1 1A E1) — legacy Word
 */

const MAGIC = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d],
  // ZIP file. DOCX is OOXML inside a ZIP; we can't cheaply distinguish from
  // generic .zip without unzipping, so callers should also gate on extension.
  zip: [0x50, 0x4b, 0x03, 0x04],
  // OLE2/CFBF compound document — used by legacy .doc / .xls / .ppt.
  ole2: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
};

function startsWith(buf, magic) {
  if (buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Identify a file's likely type by inspecting its leading bytes.
 *
 * @param {Buffer} buf
 * @returns {'pdf' | 'docx' | 'doc' | 'unknown'}
 *   'docx' is best-effort — the magic is a generic ZIP signature; combine
 *   with a `.docx` extension check for confidence.
 */
export function sniffFileType(buf) {
  if (!Buffer.isBuffer(buf)) {
    throw new Error('sniffFileType: buf must be a Buffer');
  }
  if (startsWith(buf, MAGIC.pdf)) return 'pdf';
  if (startsWith(buf, MAGIC.ole2)) return 'doc';
  if (startsWith(buf, MAGIC.zip)) return 'docx'; // tentative; gate on extension
  return 'unknown';
}

// MIME → extension map for the intake portal. Mirrors
// shared/forms/<cycle>/schema.js `ATTACHMENT_TYPES`. Kept here so a
// field's `accept: [<mime>...]` array can be translated to the
// extension allowlist without round-tripping through the schema file.
const INTAKE_MIME_TO_EXT = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/**
 * Validate an intake-portal attachment's bytes against its declared
 * extension AND against the field's allowed MIME types. Sister to
 * `validateReviewFile` but parameterized — intake fields each declare
 * their own `accept: [<mime>...]` in `shared/forms/<cycle>/schema.js`
 * and the validator must match the field's allowlist, not a fixed set.
 *
 * @param {string} filename
 * @param {Buffer} buf
 * @param {string[]} allowedMimeTypes — the field's `accept` array
 * @returns {{ ok: true, type: 'pdf'|'docx'|'xlsx' } | { ok: false, reason: string }}
 *
 * XLSX disambiguation: XLSX and DOCX share the same OOXML/ZIP magic
 * bytes; we can't cheaply tell them apart from the bytes alone. As with
 * `validateReviewFile`'s DOCX handling, we gate on the file extension
 * after sniffing — declared `.xlsx` with a ZIP signature is XLSX.
 */
export function validateIntakeAttachment(filename, buf, allowedMimeTypes) {
  if (typeof filename !== 'string' || !filename) {
    return { ok: false, reason: 'filename required' };
  }
  if (!Array.isArray(allowedMimeTypes) || allowedMimeTypes.length === 0) {
    return { ok: false, reason: 'allowedMimeTypes must be a non-empty array' };
  }

  // Resolve the field's allowlist to extensions. Unknown MIMEs in the
  // allowlist are ignored (rather than failing), so a schema entry for
  // a future MIME we don't yet support degrades gracefully — it just
  // won't accept that extension.
  const allowedExts = new Set();
  for (const mime of allowedMimeTypes) {
    const ext = INTAKE_MIME_TO_EXT[mime];
    if (ext) allowedExts.add(ext);
  }
  if (allowedExts.size === 0) {
    return { ok: false, reason: 'no supported MIME types in field accept[]' };
  }

  const extMatch = filename.toLowerCase().match(/\.(pdf|docx|xlsx)$/);
  if (!extMatch) {
    const allowedList = [...allowedExts].map(e => '.' + e).sort().join(', ');
    return { ok: false, reason: `unsupported extension; allowed: ${allowedList}` };
  }
  const declared = extMatch[1];
  if (!allowedExts.has(declared)) {
    const allowedList = [...allowedExts].map(e => '.' + e).sort().join(', ');
    return { ok: false, reason: `extension .${declared} not permitted for this field; allowed: ${allowedList}` };
  }

  const sniffed = sniffFileType(buf);
  if (declared === 'pdf' && sniffed !== 'pdf') {
    return { ok: false, reason: 'file does not look like a PDF (magic bytes mismatch)' };
  }
  // DOCX and XLSX share the ZIP signature ('docx' sniff result). Both
  // accept this since byte-level disambiguation isn't possible without
  // unzipping; the extension was already validated against the field's
  // allowlist above.
  if ((declared === 'docx' || declared === 'xlsx') && sniffed !== 'docx') {
    return { ok: false, reason: `file does not look like a ${declared.toUpperCase()} (expected ZIP signature)` };
  }

  return { ok: true, type: declared };
}

/**
 * Validate that a file's bytes match its declared extension.
 *
 * @param {string} filename
 * @param {Buffer} buf
 * @returns {{ ok: true, type: 'pdf'|'docx'|'doc' } | { ok: false, reason: string }}
 */
export function validateReviewFile(filename, buf) {
  if (typeof filename !== 'string' || !filename) {
    return { ok: false, reason: 'filename required' };
  }
  const ext = filename.toLowerCase().match(/\.(pdf|docx|doc)$/);
  if (!ext) {
    return { ok: false, reason: 'unsupported extension; allowed: .pdf, .docx, .doc' };
  }
  const sniffed = sniffFileType(buf);
  const declared = ext[1];

  if (declared === 'pdf' && sniffed !== 'pdf') {
    return { ok: false, reason: 'file does not look like a PDF (magic bytes mismatch)' };
  }
  if (declared === 'docx' && sniffed !== 'docx') {
    return { ok: false, reason: 'file does not look like a DOCX (expected ZIP signature)' };
  }
  if (declared === 'doc' && sniffed !== 'doc') {
    return { ok: false, reason: 'file does not look like a DOC (expected OLE2 signature)' };
  }
  return { ok: true, type: declared };
}
