#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : path.resolve(args[rootFlag + 1]);

const SELF_FOCUSED_FAILURE_PATTERNS = [
  {
    name: 'first-person failure habit',
    regex: /\bI\s+(?:keep|kept|miss|missed|skip|skipped|fail|failed|assume|assumed|outsourced|proceeded|forgot)\b/i,
  },
  {
    name: 'owned recurring failures',
    regex: /\bmy\s+recurring\s+failures\b/i,
  },
  {
    name: 'reviewer-kept-catching framing',
    regex: /\b(?:Codex|reviewer|reviewers|user)\b.{0,80}\b(?:kept\s+catching|keeps\s+catching|caught\s+me|had\s+to\s+catch)\b/i,
  },
  {
    name: 'identity insult framing',
    regex: /\b(?:lazy|forgetful|self-flagellating)\b/i,
  },
  {
    name: 'failure-mode identity framing',
    regex: /\bthis\s+is\s+(?:the\s+)?failure\s+mode\b/i,
  },
];

const ACTIVE_PATHS = [
  /^CLAUDE\.md$/,
  /^SESSION_PROMPT\.md$/,
  /^docs\/AGENT_HARNESS_STYLE_GUIDE\.md$/,
  /^\.claude\/skills\/[^/]+\/SKILL\.md$/,
  /^\.claude\/rules\/[^/]+\.md$/,
  /^\.claude\/hooks\/[^/]+\.js$/,
  /^\.claude-memory\/MEMORY\.md$/,
  /^\.claude-memory\/feedback-[^/]+\.md$/,
  /^docs\/agent-wiki\/index\.md$/,
  /^docs\/agent-wiki\/topics\/[^/]+\.md$/,
];

const EXCLUDED_PATHS = [
  /^\.harness-backups\//,
  /^\.claude-memory\/rationale\//,
  /^\.claude\/skills\/[^/]+\/RATIONALE\.md$/,
];

function toPosix(file) {
  return file.split(path.sep).join('/');
}

function listTrackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch {
    const files = [];
    walk(root, files);
    return files.map((file) => toPosix(path.relative(root, file)));
  }
}

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
}

function isActive(file) {
  return ACTIVE_PATHS.some((pattern) => pattern.test(file)) &&
    !EXCLUDED_PATHS.some((pattern) => pattern.test(file));
}

function stripJsComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (match) => '\n'.repeat(match.split('\n').length - 1))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function stripMarkdownCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, (match) => '\n'.repeat(match.split('\n').length - 1));
}

function scanText(file, text) {
  let activeText = text;
  if (file.endsWith('.js')) activeText = stripJsComments(activeText);
  if (file.endsWith('.md')) activeText = stripMarkdownCodeBlocks(activeText);

  const findings = [];
  const lines = activeText.split('\n');
  lines.forEach((line, index) => {
    for (const pattern of SELF_FOCUSED_FAILURE_PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push({
          file,
          line: index + 1,
          pattern: pattern.name,
          text: line.trim(),
        });
      }
    }
  });
  return findings;
}

function main() {
  const findings = [];
  for (const file of listTrackedFiles().filter(isActive)) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    findings.push(...scanText(file, text));
  }

  if (findings.length) {
    console.error('harness-framing found self-focused failure framing in active harness text:');
    for (const finding of findings) {
      console.error(`- ${finding.file}:${finding.line} [${finding.pattern}] ${finding.text}`);
    }
    console.error('\nMove incident history to rationale sidecars and phrase active instructions as expert procedure.');
    process.exit(1);
  }

  console.log('harness-framing OK — active harness text avoids self-focused failure framing.');
}

if (require.main === module) main();
