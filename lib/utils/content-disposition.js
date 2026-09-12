/**
 * Build a safe `Content-Disposition` header value from a possibly untrusted
 * filename (Dataverse/SharePoint metadata, a stored document name, etc.).
 * Naive interpolation (`filename="${name}"`) lets a filename containing a
 * quote, backslash, or CR/LF inject or corrupt response headers. This
 * produces a quoted-string ASCII fallback (control chars, `"`, `\`, and
 * non-ASCII replaced) plus an RFC 5987 `filename*=UTF-8''...` extended
 * value so non-ASCII names still render correctly in browsers that honor it.
 */

function sanitizeAsciiFallback(name) {
  const stripped = String(name || '')
    .replace(/[\r\n"\\]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7e]/g, '_')
    .trim();
  return stripped || 'download';
}

export function contentDisposition(type, filename) {
  if (type !== 'inline' && type !== 'attachment') {
    throw new Error(`contentDisposition: type must be "inline" or "attachment", got ${JSON.stringify(type)}`);
  }
  const fallback = sanitizeAsciiFallback(filename);
  const extended = encodeURIComponent(String(filename || '').replace(/[\r\n]/g, '') || 'download');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${extended}`;
}
