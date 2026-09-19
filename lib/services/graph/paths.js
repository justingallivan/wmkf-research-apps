/**
 * Defense-in-depth path validation for governed SharePoint folders.
 *
 * Decodes once before the `..` check so encoded traversal is rejected beside
 * literal traversal. Malformed URI encoding is itself invalid.
 */
export function validatePath(folderPath) {
  if (folderPath.startsWith('/')) {
    throw new Error(`Invalid path: must not start with "/". Got: "${folderPath}"`);
  }
  let decoded;
  try {
    decoded = decodeURIComponent(folderPath);
  } catch {
    throw new Error(`Invalid path: malformed URI encoding. Got: "${folderPath}"`);
  }
  const segments = decoded.split('/');
  if (segments.some(s => s === '..' || s === '.')) {
    throw new Error(`Invalid path: traversal ("..") not allowed. Got: "${folderPath}"`);
  }
}
