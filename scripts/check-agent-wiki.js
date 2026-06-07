#!/usr/bin/env node
'use strict';
/**
 * Agent wiki gate.
 *
 * This validates the repo-native agent-wiki as a retrieval aid:
 * frontmatter shape, stale dates, source/canonical path existence, links, and
 * index coverage. It does not decide whether a semantic claim is true; source
 * files, Atlas pages, and /sweep remain responsible for that.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const repoRoot = path.resolve(rootFlag >= 0 ? args[rootFlag + 1] : path.join(__dirname, '..'));
const wikiRoot = path.join(repoRoot, 'docs', 'agent-wiki');
const today = new Date();
today.setUTCHours(0, 0, 0, 0);

const REQUIRED = [
  'docs/agent-wiki/index.md',
  'docs/agent-wiki/log.md',
  'docs/agent-wiki/topics/reviewer-identity.md',
];
const REQUIRED_KEYS = ['agent_wiki', 'status', 'last_verified', 'source_files', 'canonical_docs'];
const TOPIC_KEYS = ['owner', 'stale_after_days', 'watch_paths', 'update_triggers'];
const STATUSES = new Set(['active', 'historical', 'stale', 'retired']);
const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

function rel(full) {
  return path.relative(repoRoot, full).replace(/\\/g, '/');
}

function fail(violations, file, message) {
  violations.push(`${file}: ${message}`);
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: null, body: text };
  const data = {};
  let current = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    const listMatch = line.match(/^\s{2}-\s+(.*)$/);
    if (listMatch && current) {
      if (!Array.isArray(data[current])) data[current] = [];
      data[current].push(unquote(listMatch[1].trim()));
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
    if (!keyMatch) continue;
    current = keyMatch[1];
    const value = (keyMatch[2] || '').trim();
    data[current] = value === '' ? [] : unquote(value);
  }
  return { data, body: text.slice(match[0].length) };
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.isFile() && ent.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && value === date.toISOString().slice(0, 10);
}

function ensureList(data, key, file, violations) {
  if (!Array.isArray(data[key]) || data[key].length === 0) {
    fail(violations, file, `frontmatter \`${key}\` must be a non-empty list`);
    return [];
  }
  return data[key];
}

function pathExists(repoRelative) {
  return fs.existsSync(path.join(repoRoot, repoRelative));
}

function watchPathPlausible(pattern) {
  const clean = String(pattern).replace(/\*\*?\/?.*$/, '').replace(/\/$/, '');
  if (!clean) return true;
  return pathExists(clean) || pathExists(clean.split('/')[0]);
}

function linkTargetExists(file, target) {
  if (/^(https?:|mailto:|#)/.test(target)) return true;
  const [rawPath] = target.split('#');
  if (!rawPath) return true;
  const decoded = decodeURIComponent(rawPath);
  return fs.existsSync(path.resolve(path.dirname(file), decoded));
}

function checkMarkdownLinks(file, body, violations) {
  LINK_RE.lastIndex = 0;
  let match;
  while ((match = LINK_RE.exec(body)) !== null) {
    if (!linkTargetExists(file, match[1])) {
      fail(violations, rel(file), `broken markdown link target \`${match[1]}\``);
    }
  }
  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(body)) !== null) {
    const target = match[1].endsWith('.md') ? match[1] : `${match[1]}.md`;
    if (!fs.existsSync(path.resolve(path.dirname(file), target))) {
      fail(violations, rel(file), `broken wikilink target \`${match[1]}\``);
    }
  }
}

function checkFile(file, parsed, violations) {
  const fileRel = rel(file);
  const { data, body } = parsed;
  if (!data) {
    fail(violations, fileRel, 'missing YAML frontmatter');
    return;
  }
  for (const key of REQUIRED_KEYS) {
    if (!(key in data)) fail(violations, fileRel, `missing frontmatter key \`${key}\``);
  }
  if (data.status && !STATUSES.has(data.status)) {
    fail(violations, fileRel, `invalid status \`${data.status}\``);
  }
  if (!isValidDate(data.last_verified)) {
    fail(violations, fileRel, '`last_verified` must be YYYY-MM-DD');
  } else {
    const verified = new Date(`${data.last_verified}T00:00:00Z`);
    if (verified > today) fail(violations, fileRel, '`last_verified` is in the future');
    if (data.status === 'active') {
      const staleDays = Number(data.stale_after_days || 90);
      if (!Number.isInteger(staleDays) || staleDays <= 0) {
        fail(violations, fileRel, '`stale_after_days` must be a positive integer');
      } else {
        const ageDays = Math.floor((today - verified) / 86400000);
        if (ageDays > staleDays) {
          fail(violations, fileRel, `active page is stale: last_verified ${data.last_verified}, stale_after_days ${staleDays}`);
        }
      }
    }
  }

  for (const key of ['source_files', 'canonical_docs']) {
    for (const item of ensureList(data, key, fileRel, violations)) {
      if (!pathExists(item)) fail(violations, fileRel, `${key} path does not exist: \`${item}\``);
    }
  }

  if (fileRel.startsWith('docs/agent-wiki/topics/')) {
    for (const key of TOPIC_KEYS) {
      if (!(key in data)) fail(violations, fileRel, `topic missing frontmatter key \`${key}\``);
    }
    for (const pattern of ensureList(data, 'watch_paths', fileRel, violations)) {
      if (!watchPathPlausible(pattern)) {
        fail(violations, fileRel, `watch_paths pattern has no plausible repo root: \`${pattern}\``);
      }
    }
    ensureList(data, 'update_triggers', fileRel, violations);
  }

  checkMarkdownLinks(file, body, violations);
}

function main() {
  const violations = [];
  for (const required of REQUIRED) {
    if (!pathExists(required)) fail(violations, required, 'required agent-wiki file is missing');
  }
  const files = walk(wikiRoot);
  const parsedByRel = new Map();
  for (const file of files) {
    const parsed = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    parsedByRel.set(rel(file), parsed);
    checkFile(file, parsed, violations);
  }

  const index = parsedByRel.get('docs/agent-wiki/index.md');
  const indexText = index ? index.body : '';
  const topics = files.map(rel).filter((p) => p.startsWith('docs/agent-wiki/topics/') && p.endsWith('.md'));
  for (const topic of topics) {
    const relativeFromIndex = path.posix.relative('docs/agent-wiki', topic);
    if (!indexText.includes(relativeFromIndex) && !indexText.includes(topic)) {
      fail(violations, 'docs/agent-wiki/index.md', `topic is not routed from index: \`${topic}\``);
    }
  }

  if (violations.length) {
    console.error(`agent-wiki FAILED: ${violations.length} violation(s).`);
    for (const item of violations) console.error(`  ✗ ${item}`);
    process.exit(1);
  }
  console.log(`agent-wiki OK — ${files.length} markdown file(s), ${topics.length} topic page(s) checked.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exit(2);
  }
}

module.exports = { parseFrontmatter, main };
