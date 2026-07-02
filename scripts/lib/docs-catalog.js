#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DOCS_DIR = 'docs';
const CATALOG_REL = 'docs/DOCS_CATALOG.md';
const REQUIRED_KEYS = ['title', 'domain', 'kind', 'status', 'summary'];
const OPTIONAL_LIST_KEYS = ['related', 'supersedes', 'superseded_by'];
const KIND_VALUES = new Set([
  'source-of-truth',
  'spec',
  'plan',
  'status',
  'runbook',
  'audit',
  'decision',
  'history',
  'draft',
]);
const STATUS_VALUES = new Set([
  'active',
  'canonical',
  'draft',
  'superseded',
  'historical',
  'archive-candidate',
]);

function repoRel(repoRoot, full) {
  return path.relative(repoRoot, full).replace(/\\/g, '/');
}

function unquote(value) {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: null, body: text, raw: '' };
  const data = {};
  let current = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const listMatch = line.match(/^\s{2}-\s+(.*)$/);
    if (listMatch && current) {
      if (!Array.isArray(data[current])) data[current] = [];
      data[current].push(unquote(listMatch[1]));
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
    if (!keyMatch) continue;
    current = keyMatch[1];
    const value = (keyMatch[2] || '').trim();
    data[current] = value === '' ? [] : unquote(value);
  }
  return { data, body: text.slice(match[0].length), raw: match[0] };
}

function yamlScalar(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '""';
  if (/^[A-Za-z0-9_.:/@ -]+$/.test(text) && !/^[-?:,[\]{}#&*!|>'"%`]/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function renderFrontmatter(data) {
  const ordered = [
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
  ];
  const keys = [...ordered.filter((key) => key in data), ...Object.keys(data).filter((key) => !ordered.includes(key)).sort()];
  const lines = ['---'];
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push('---', '');
  return `${lines.join('\n')}\n`;
}

function topLevelMarkdownFiles(repoRoot) {
  const docsDir = path.join(repoRoot, DOCS_DIR);
  return fs.readdirSync(docsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(docsDir, entry.name))
    .sort((a, b) => repoRel(repoRoot, a).localeCompare(repoRel(repoRoot, b)));
}

function loadDocs(repoRoot) {
  return topLevelMarkdownFiles(repoRoot).map((full) => {
    const text = fs.readFileSync(full, 'utf8');
    const parsed = parseFrontmatter(text);
    return {
      file: full,
      rel: repoRel(repoRoot, full),
      text,
      ...parsed,
    };
  });
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateDoc(doc, repoRoot) {
  const violations = [];
  const { data, rel } = doc;
  if (!data) return [`${rel}: missing YAML frontmatter`];
  for (const key of REQUIRED_KEYS) {
    if (!(key in data) || String(data[key] || '').trim() === '') {
      violations.push(`${rel}: missing required frontmatter key \`${key}\``);
    }
  }
  if (data.kind && !KIND_VALUES.has(data.kind)) {
    violations.push(`${rel}: invalid kind \`${data.kind}\``);
  }
  if (data.status && !STATUS_VALUES.has(data.status)) {
    violations.push(`${rel}: invalid status \`${data.status}\``);
  }
  if (data.domain && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.domain)) {
    violations.push(`${rel}: domain must be a lowercase slug`);
  }
  if ('canonical' in data && !['true', 'false', true, false].includes(data.canonical)) {
    violations.push(`${rel}: canonical must be true or false`);
  }
  if (data.summary && String(data.summary).length > 160) {
    violations.push(`${rel}: summary must be 160 characters or fewer`);
  }
  if (data.last_verified && !isValidDate(data.last_verified)) {
    violations.push(`${rel}: last_verified must be YYYY-MM-DD`);
  }
  if (data.cataloged && !isValidDate(data.cataloged)) {
    violations.push(`${rel}: cataloged must be YYYY-MM-DD`);
  }
  for (const key of OPTIONAL_LIST_KEYS) {
    if (!(key in data)) continue;
    if (!Array.isArray(data[key])) {
      violations.push(`${rel}: ${key} must be a list`);
      continue;
    }
    for (const item of data[key]) {
      if (!fs.existsSync(path.join(repoRoot, item))) {
        violations.push(`${rel}: ${key} path does not exist: \`${item}\``);
      }
    }
  }
  return violations;
}

function escapeCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function renderCatalog(docs) {
  const catalogDoc = docs.find((doc) => doc.rel === CATALOG_REL);
  const cataloged = catalogDoc?.data?.cataloged || catalogDoc?.data?.last_verified || new Date().toISOString().slice(0, 10);
  const usable = docs
    .filter((doc) => doc.data)
    .filter((doc) => doc.rel !== CATALOG_REL)
    .sort((a, b) => {
      const da = a.data.domain || '';
      const db = b.data.domain || '';
      if (da !== db) return da.localeCompare(db);
      return a.rel.localeCompare(b.rel);
    });
  const domains = new Map();
  for (const doc of usable) {
    const domain = doc.data.domain || 'uncategorized';
    if (!domains.has(domain)) domains.set(domain, []);
    domains.get(domain).push(doc);
  }

  const lines = [
    '---',
    'title: Docs Catalog',
    'domain: docs-governance',
    'kind: source-of-truth',
    'status: canonical',
    'summary: Generated catalog of top-level documentation by domain, kind, status, and purpose.',
    'canonical: true',
    `cataloged: ${cataloged}`,
    'owner: product-engineering',
    'related:',
    '  - docs/agent-wiki/index.md',
    '  - docs/CI_GATES_REFERENCE.md',
    '---',
    '',
    '# Docs Catalog',
    '',
    '> Generated by `npm run generate:docs-catalog`. Do not edit table rows by hand.',
    '',
  ];

  for (const [domain, items] of domains) {
    lines.push(`## ${domain}`, '');
    lines.push('| File | Kind | Status | Canonical | Summary | Cataloged |');
    lines.push('|---|---|---|---|---|---|');
    for (const doc of items) {
      const d = doc.data;
      const file = `[${path.basename(doc.rel)}](${path.basename(doc.rel)})`;
      lines.push(`| ${file} | ${escapeCell(d.kind)} | ${escapeCell(d.status)} | ${d.canonical === true || d.canonical === 'true' ? 'yes' : ''} | ${escapeCell(d.summary)} | ${escapeCell(d.cataloged || d.last_verified)} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n').replace(/[ \t]+$/gm, '')}\n`;
}

module.exports = {
  CATALOG_REL,
  KIND_VALUES,
  STATUS_VALUES,
  loadDocs,
  parseFrontmatter,
  renderCatalog,
  renderFrontmatter,
  validateDoc,
};
