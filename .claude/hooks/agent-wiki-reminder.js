#!/usr/bin/env node
'use strict';
/*
 * PreToolUse hook (Write|Edit): agent-wiki freshness reminder.
 *
 * Reads docs/agent-wiki/topics/*.md frontmatter and nudges the agent when a
 * changed path matches a topic's watch_paths. Advisory only; deterministic
 * structure is enforced by npm run check:agent-wiki.
 */

const fs = require('fs');
const path = require('path');

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const data = {};
  let current = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const listMatch = rawLine.match(/^\s{2}-\s+(.*)$/);
    if (listMatch && current) {
      if (!Array.isArray(data[current])) data[current] = [];
      data[current].push(listMatch[1].trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }
    const keyMatch = rawLine.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
    if (!keyMatch) continue;
    current = keyMatch[1];
    data[current] = keyMatch[2] ? keyMatch[2].trim().replace(/^['"]|['"]$/g, '') : [];
  }
  return data;
}

function globToRegex(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      out += '.*';
      i += 1;
    } else if (ch === '*') {
      out += '[^/]*';
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

function matches(pattern, relativePath) {
  if (pattern.endsWith('/**')) return relativePath.startsWith(pattern.slice(0, -3));
  if (pattern.includes('*')) return globToRegex(pattern).test(relativePath);
  return relativePath === pattern || relativePath.startsWith(`${pattern}/`);
}

function topics(root) {
  const dir = path.join(root, 'docs', 'agent-wiki', 'topics');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const rel = `docs/agent-wiki/topics/${name}`;
      const data = parseFrontmatter(fs.readFileSync(path.join(dir, name), 'utf8'));
      return { rel, watchPaths: Array.isArray(data.watch_paths) ? data.watch_paths : [] };
    });
}

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    if (!data || (data.tool_name !== 'Write' && data.tool_name !== 'Edit')) return;
    const root = path.resolve(data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const fp = data.tool_input && data.tool_input.file_path;
    if (typeof fp !== 'string') return;
    const relativePath = path.relative(root, path.resolve(fp)).replace(/\\/g, '/');
    if (relativePath.startsWith('..')) return;
    if (relativePath.startsWith('docs/agent-wiki/')) return;

    const hits = topics(root).filter((topic) =>
      topic.watchPaths.some((pattern) => matches(pattern, relativePath)));
    if (!hits.length) return;

    const msg =
      `Agent-wiki freshness: \`${relativePath}\` matches ${hits.map((h) => `\`${h.rel}\``).join(', ')}. ` +
      'If this edit changes durable behavior or a recurring review hazard, update the topic or mark it stale; ' +
      'then run `npm run check:agent-wiki`. This is advisory — source/Atlas remain authoritative.';

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: msg },
    }));
  } catch {
    // fail open
  }
});
