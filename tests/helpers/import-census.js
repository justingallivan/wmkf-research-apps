/**
 * Shared caller-boundary census scanner.
 *
 * Walks a set of root directories, reads every production source file once,
 * and finds which files reference a given module-path fragment via any of:
 *   - static import:      import x from '...pattern...'
 *   - named/export-from:  export { x } from '...pattern...'  (matches the
 *                          same `from '...'` clause as a static import)
 *   - CommonJS require:   require('...pattern...')
 *   - dynamic import:     await import('...pattern...')
 *
 * Limit (documented, not fixed): only *string-literal* module specifiers are
 * detected. `require(someVariable)` / `import(someVariable)` — a
 * non-literal, dynamically computed specifier — is invisible to this
 * regex-based scan and will NOT be flagged. That is a known blind spot, not
 * a bug in this helper; treat it as a reason to keep dynamic imports of
 * migrated modules on literal specifiers.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'];
const DEFAULT_SKIP_DIR_NAMES = new Set(['node_modules', '.next']);

function collectFiles(dir, extensions, skipDirNames, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // dir does not exist (e.g. an optional root)
  }
  for (const entry of entries) {
    if (skipDirNames.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, extensions, skipDirNames, out);
    } else if (extensions.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

/**
 * Reads every matching file under `roots` exactly once.
 * @param {string[]} roots - absolute directory paths
 * @param {object} [options]
 * @param {string[]} [options.extensions]
 * @param {Set<string>} [options.skipDirNames]
 * @param {string} [options.relativeTo] - if given, keys are relative (posix-separated) to this dir
 * @returns {Array<{file: string, content: string}>}
 */
function readSourceFiles(roots, options = {}) {
  const extensions = options.extensions || DEFAULT_EXTENSIONS;
  const skipDirNames = options.skipDirNames || DEFAULT_SKIP_DIR_NAMES;
  const relativeTo = options.relativeTo;

  const paths = [];
  for (const root of roots) collectFiles(root, extensions, skipDirNames, paths);

  return paths.map((absPath) => ({
    file: relativeTo
      ? path.relative(relativeTo, absPath).split(path.sep).join('/')
      : absPath,
    content: fs.readFileSync(absPath, 'utf8'),
  }));
}

/**
 * Builds the regex that detects any reference to `patternSource` (a regex
 * source fragment, e.g. "close-review-service") inside a module specifier
 * string, across static import / export-from, require(), and dynamic
 * import() forms.
 *
 * The gap between `from`/`require(`/`import(` and the literal specifier
 * tolerates not just whitespace but an interleaved block or line comment
 * (e.g. `import x from /* c *\/ './target'` or `require(/* c *\/ './target')`)
 * — a bare `\s*` gap would miss those.
 */
function buildImportRegex(patternSource) {
  const spec = `['"][^'"]*${patternSource}[^'"]*['"]`;
  const gap = '(?:\\s|/\\*[\\s\\S]*?\\*/|//[^\\n]*\\n)*';
  return new RegExp(
    [
      `from${gap}${spec}`, // covers both `import ... from '...'` and `export ... from '...'`
      `require\\(${gap}${spec}${gap}\\)`,
      `import\\(${gap}${spec}${gap}\\)`,
    ].join('|'),
  );
}

/**
 * @param {Array<{file: string, content: string}>} fileContents - from readSourceFiles
 * @param {RegExp} pattern - a regex whose `.source` is the fragment to search for
 * @returns {string[]} sorted list of matching file identifiers
 */
function findImporters(fileContents, pattern) {
  const regex = buildImportRegex(pattern.source);
  const matched = [];
  for (const { file, content } of fileContents) {
    if (regex.test(content)) matched.push(file);
  }
  return matched.sort();
}

module.exports = {
  DEFAULT_EXTENSIONS,
  DEFAULT_SKIP_DIR_NAMES,
  readSourceFiles,
  buildImportRegex,
  findImporters,
};
