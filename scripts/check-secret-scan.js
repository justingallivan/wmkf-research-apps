#!/usr/bin/env node
'use strict';

/**
 * check:secret-scan
 *
 * GHAS-free local push-protection equivalent for the tracked working tree. This
 * gate scans git ls-files (not history), skips lockfiles, distinguishes real
 * secrets from placeholders/test fixtures by length + entropy + markers, and
 * fails closed when a tracked file contains a real secret-shaped literal.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ALLOWLIST = require('./check-secret-scan-allowlist.js');

const repoRoot = path.resolve(__dirname, '..');
const trackedSecretsPath = path.join(repoRoot, 'lib', 'utils', 'tracked-secrets.js');

const SECRET_PATTERNS = [
  {
    kind: 'anthropic-api-key',
    regex: /\bsk-ant-api[0-9]{2}-[A-Za-z0-9_-]{80,}\b/g,
    secretPart: (token) => token.replace(/^sk-ant-api[0-9]{2}-/, ''),
  },
  {
    kind: 'aws-access-key-id',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    minEntropy: 2.5,
  },
  {
    kind: 'github-token',
    regex: /\b(?:ghp_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{80,})\b/g,
  },
  {
    kind: 'slack-bot-token',
    regex: /\bxoxb-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9-]{24,}\b/g,
  },
  {
    kind: 'google-api-key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    kind: 'vercel-blob-rw-token',
    regex: /\bvercel_blob_rw_[A-Za-z0-9-]{3,}_[A-Za-z0-9_-]{32,}\b/g,
    secretPart: (token) => token.split('_').slice(4).join('_'),
  },
];

const PRIVATE_KEY_HEADER_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const JSON_PRIVATE_KEY_RE = /"private_key"\s*:\s*"([^"]{32,})"/g;
const ASSIGNMENT_VALUE_RE = /^['"`]?([^'"`\s,;#]+)['"`]?/;

const PLACEHOLDER_MARKER_RE = /(?:test|stub|fixture|example|placeholder|your[_-]?|xxx|redact|fake|dummy|sample|mock|throwaway|rehearsal|TESTSTORE|\.{3}|…)/i;
const LOCKFILE_RE = /(?:^|\/)(?:package-lock\.json|.*\.lock)$/;

function shannonEntropy(value) {
  if (!value) return 0;
  const counts = new Map();
  for (const ch of value) counts.set(ch, (counts.get(ch) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function looksPlaceholder(value, context = '') {
  return PLACEHOLDER_MARKER_RE.test(value) || PLACEHOLDER_MARKER_RE.test(context);
}

function hasUsefulSecretShape(value) {
  if (!value || value.length < 32) return false;
  if (value.includes('process.env')) return false;
  if (/[\s<>$]/.test(value)) return false;
  if (looksPlaceholder(value)) return false;
  const classes = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /[0-9]/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ].filter(Boolean).length;
  return classes >= 2 && shannonEntropy(value) >= 3.3;
}

function patternLooksReal(match, pattern, line) {
  const secretPart = pattern.secretPart ? pattern.secretPart(match) : match;
  if (looksPlaceholder(secretPart, line)) return false;
  const minEntropy = pattern.minEntropy || 3.3;
  return shannonEntropy(secretPart) >= minEntropy;
}

function matchesRealExplicitPattern(value, line = '') {
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(value)) !== null) {
      if (patternLooksReal(match[0], pattern, line)) return true;
    }
  }
  return false;
}

function readTrackedSecretNames() {
  const src = fs.readFileSync(trackedSecretsPath, 'utf8');
  const keys = [...src.matchAll(/\{\s*key:\s*'([^']+)'/g)].map((m) => m[1]);
  if (!keys.length) {
    throw new Error('secret-scan configuration error: no TRACKED_SECRETS keys found in lib/utils/tracked-secrets.js');
  }
  const names = new Set();
  for (const key of keys) {
    names.add(key);
    names.add(key.toUpperCase());
  }
  return [...names].sort((a, b) => b.length - a.length);
}

function assignmentRegexFor(secretNames) {
  const atom = secretNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?:^|[^A-Za-z0-9_])(${atom})\\s*(?:=|:)\\s*([^\\r\\n]+)`, 'g');
}

function trackedFiles() {
  const out = execSync('git ls-files -z', { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = out.split('\0').filter(Boolean).filter((rel) => !LOCKFILE_RE.test(rel));

  // Self-test opt-in: also scan an untracked temp dir of synthetic fixtures.
  if (process.env.SECRET_SCAN_INCLUDE_SELFTEST_TMP) {
    const tmp = path.join(repoRoot, process.env.SECRET_SCAN_INCLUDE_SELFTEST_TMP);
    if (fs.existsSync(tmp)) {
      (function rec(dir) {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) rec(full);
          else {
            const rel = path.relative(repoRoot, full);
            if (!LOCKFILE_RE.test(rel)) files.push(rel);
          }
        }
      })(tmp);
    }
  }

  return files;
}

function isProbablyText(buffer) {
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8');
  return !sample.includes('\uFFFD');
}

function allowed(rel, line, text, kind) {
  return ALLOWLIST.some((entry) => (
    entry
    && entry.file === rel
    && entry.reason
    && (!entry.kind || entry.kind === kind)
    && (!entry.line || entry.line === line)
    && (!entry.match || text.includes(entry.match))
  ));
}

function redacted(match, kind) {
  if (kind === 'private-key' || kind === 'json-private-key') return kind;
  if (match.startsWith('sk-ant-api')) return 'sk-ant-apiNN-*';
  if (match.startsWith('vercel_blob_rw_')) return 'vercel_blob_rw_*';
  if (match.startsWith('github_pat_')) return 'github_pat_*';
  if (match.startsWith('ghp_')) return 'ghp_*';
  if (match.startsWith('xoxb-')) return 'xoxb-*';
  if (match.startsWith('AIza')) return 'AIza*';
  if (match.startsWith('AKIA')) return 'AKIA*';
  return `${kind}*`;
}

function addProblem(problems, rel, line, kind, match, text, detail = '') {
  if (allowed(rel, line, text, kind)) return;
  const suffix = detail ? ` (${detail})` : '';
  problems.push(`${rel}:${line}: ${kind} ${redacted(match, kind)}${suffix}`);
}

function scanText(content, rel = '<text>', options = {}) {
  const secretNames = options.secretNames || readTrackedSecretNames();
  const assignmentRe = options.assignmentRe || assignmentRegexFor(secretNames);
  const problems = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];

    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        if (patternLooksReal(match[0], pattern, line)) {
          addProblem(problems, rel, lineNo, pattern.kind, match[0], line, `len=${match[0].length}`);
        }
      }
    }

    PRIVATE_KEY_HEADER_RE.lastIndex = 0;
    if (PRIVATE_KEY_HEADER_RE.test(line) && !looksPlaceholder('', line)) {
      addProblem(problems, rel, lineNo, 'private-key', 'private-key', line);
    }

    JSON_PRIVATE_KEY_RE.lastIndex = 0;
    let jsonMatch;
    while ((jsonMatch = JSON_PRIVATE_KEY_RE.exec(line)) !== null) {
      const value = jsonMatch[1];
      if ((/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) || hasUsefulSecretShape(value)) && !looksPlaceholder(value, line)) {
        addProblem(problems, rel, lineNo, 'json-private-key', value, line, `len=${value.length}`);
      }
    }

    assignmentRe.lastIndex = 0;
    let assignment;
    while ((assignment = assignmentRe.exec(line)) !== null) {
      const rawValue = assignment[2].trim();
      const valueMatch = rawValue.match(ASSIGNMENT_VALUE_RE);
      if (!valueMatch) continue;
      const value = valueMatch[1];
      if (!hasUsefulSecretShape(value)) continue;
      if (matchesRealExplicitPattern(value, line)) continue;
      addProblem(problems, rel, lineNo, 'secret-env-assignment', value, line, `${assignment[1]}, len=${value.length}`);
    }
  }

  return problems;
}

function main() {
  const secretNames = readTrackedSecretNames();
  const assignmentRe = assignmentRegexFor(secretNames);
  const files = trackedFiles();
  const problems = [];
  let scanned = 0;

  for (const rel of files) {
    const abs = path.join(repoRoot, rel);
    let buffer;
    try { buffer = fs.readFileSync(abs); } catch { continue; }
    if (!isProbablyText(buffer)) continue;
    scanned++;
    const content = buffer.toString('utf8');
    problems.push(...scanText(content, rel, { secretNames, assignmentRe }));
  }

  if (problems.length) {
    console.error('✗ secret-scan: real secret-shaped value(s) found in tracked files:\n');
    for (const p of problems) console.error('  ✗ ' + p);
    console.error('\nRemove the secret from the tracked tree and rotate it if it was real. If a rare false positive must remain, add a narrow entry to scripts/check-secret-scan-allowlist.js with a reason.');
    process.exit(1);
  }
  console.log(`secret-scan OK — scanned ${scanned} tracked text file(s), no real secret-shaped values.`);
}

module.exports = {
  scanText,
  readTrackedSecretNames,
  assignmentRegexFor,
  shannonEntropy,
  hasUsefulSecretShape,
  matchesRealExplicitPattern,
};

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('✗ secret-scan: ' + (e.message || e)); process.exit(1); }
}
