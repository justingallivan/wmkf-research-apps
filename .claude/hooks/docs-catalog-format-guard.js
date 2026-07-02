#!/usr/bin/env node
'use strict';

/**
 * PreToolUse(Write|Edit) hook for top-level docs catalog metadata.
 *
 * Blocks new/full-rewrite top-level docs without valid catalog frontmatter.
 * Advises on edits that would remove or damage frontmatter, or that touch
 * catalog metadata keys. The deterministic backstop remains check:docs-catalog.
 */

const fs = require('fs');
const path = require('path');

const CATALOG_KEYS = new Set([
  'title',
  'domain',
  'kind',
  'status',
  'summary',
  'canonical',
  'cataloged',
  'last_verified',
  'owner',
  'related',
  'supersedes',
  'superseded_by',
]);

function repoRelative(root, filePath) {
  return path.relative(root, path.resolve(filePath)).replace(/\\/g, '/');
}

function isTopLevelDoc(rel) {
  return /^docs\/[^/]+\.md$/.test(rel) && rel !== 'docs/DOCS_CATALOG.md';
}

function metadataKeys(data) {
  return new Set(Object.keys(data || {}).filter((key) => CATALOG_KEYS.has(key)));
}

function sortedDiff(a, b) {
  const out = [];
  for (const item of a) {
    if (!b.has(item)) out.push(item);
  }
  return out.sort();
}

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    if (!data || (data.tool_name !== 'Write' && data.tool_name !== 'Edit')) return;

    const root = path.resolve(data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const toolInput = data.tool_input || {};
    const fp = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
    if (!fp) return;

    const rel = repoRelative(root, fp);
    if (rel.startsWith('..') || !isTopLevelDoc(rel)) return;

    const {
      KIND_VALUES,
      STATUS_VALUES,
      parseFrontmatter,
      validateDoc,
    } = require(path.join(root, 'scripts/lib/docs-catalog'));

    if (data.tool_name === 'Write') {
      const text = typeof toolInput.content === 'string' ? toolInput.content : '';
      const parsed = parseFrontmatter(text);
      const violations = validateDoc({ rel, text, ...parsed }, root);
      if (violations.length === 0) return;

      console.error(
        `BLOCKED: top-level docs must include catalog frontmatter before writing \`${rel}\`.\n` +
        violations.map((v) => `  - ${v}`).join('\n') + '\n' +
        'Required keys: title, domain, kind, status, summary.\n' +
        `Allowed kind: ${Array.from(KIND_VALUES).join(', ')}.\n` +
        `Allowed status: ${Array.from(STATUS_VALUES).join(', ')}.\n` +
        'Use an existing docs/*.md file as the shape reference, or run `node scripts/seed-docs-frontmatter.js --force` after drafting.',
      );
      process.exit(2);
    }

    const oldText = fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '';
    if (!oldText) return;
    const oldString = typeof toolInput.old_string === 'string' ? toolInput.old_string : '';
    const newString = typeof toolInput.new_string === 'string' ? toolInput.new_string : '';
    if (!oldString || !oldText.includes(oldString)) return;

    const proposed = oldText.replace(oldString, newString);
    const before = parseFrontmatter(oldText);
    const after = parseFrontmatter(proposed);
    const violations = validateDoc({ rel, text: proposed, ...after }, root);
    const beforeKeys = metadataKeys(before.data);
    const afterKeys = metadataKeys(after.data);
    const removedKeys = sortedDiff(beforeKeys, afterKeys);
    const addedKeys = sortedDiff(afterKeys, beforeKeys);

    const notes = [];
    if (violations.length) notes.push(`would violate catalog frontmatter: ${violations.join('; ')}`);
    if (removedKeys.length) notes.push(`removes catalog key(s): ${removedKeys.join(', ')}`);
    if (addedKeys.length) notes.push(`adds catalog key(s): ${addedKeys.join(', ')}`);
    if (!notes.length && before.raw !== after.raw) notes.push('changes catalog frontmatter');
    if (!notes.length) return;

    const msg =
      `Docs catalog metadata: this edit to \`${rel}\` ${notes.join('; ')}. ` +
      'Keep title/domain/kind/status/summary valid, regenerate with `npm run generate:docs-catalog`, ' +
      'and run `npm run check:docs-catalog` before completion.';
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg },
    }));
  } catch {
    // Fail open: CI and the commit guard remain deterministic backstops.
  }
});
