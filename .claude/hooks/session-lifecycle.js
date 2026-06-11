#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { checkAgentInvariants } = require('../../scripts/check-agent-invariants');

const STATE_VERSION = 1;
const GATE_MAP = [
  { test: /^pages\/api\//, gates: ['check:api-routes'] },
  { test: /^(lib\/db\/|docs\/atlas\/|docs\/APPLICATION_STATE_ATLAS\.md|scripts\/audit-(?:postgres|dataverse)-state\.js)/, gates: ['check:atlas'] },
  { test: /^lib\/db\/migrations\//, gates: ['check:migrations-manifest'] },
  { test: /^(shared\/config\/prompts\/|lib\/services\/.*prompt)/, gates: ['check:prompt-injection-tagging'] },
  { test: /^(docs\/agent-wiki\/|scripts\/check-agent-wiki|\.claude\/hooks\/agent-wiki-reminder\.js|\.claude\/rules\/agent-wiki\.md)/, gates: ['check:agent-wiki'] },
  { test: /^(docs\/|\.claude-memory\/|CLAUDE\.md$|SESSION_PROMPT\.md$)/, gates: ['check:fact-consistency'] },
];
const PROTECTED_PATHS = new Set(['AGENTS.md', '.agents/skills']);

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function repoRoot(input) {
  return path.resolve(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function statePath(input, root) {
  const session = input.session_id || input.sessionId || 'unknown-session';
  return path.join(os.tmpdir(), 'wmkf-claude-hook-state', hash(root).slice(0, 16), `${session}.json`);
}

function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(input || '{}')); } catch { resolve({}); }
    });
  });
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function dirtyPaths(root) {
  try {
    const entries = git(root, ['status', '--porcelain=v1', '-z']).split('\0').filter(Boolean);
    const paths = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const status = entry.slice(0, 2);
      paths.push(entry.slice(3));
      if (/[RC]/.test(status) && entries[index + 1]) {
        paths.push(entries[index + 1]);
        index += 1;
      }
    }
    return paths;
  } catch {
    return [];
  }
}

function fingerprint(root, relativePath) {
  const fullPath = path.join(root, relativePath);
  try {
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) return `link:${fs.readlinkSync(fullPath)}`;
    if (!stat.isFile()) return `other:${stat.mode}`;
    return `file:${hash(fs.readFileSync(fullPath))}`;
  } catch {
    return 'missing';
  }
}

function snapshot(root) {
  const paths = dirtyPaths(root);
  return Object.fromEntries(paths.map((relativePath) => [relativePath, fingerprint(root, relativePath)]));
}

function loadState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function relativeToolPath(input, root) {
  const filePath = input.tool_input && input.tool_input.file_path;
  if (typeof filePath !== 'string') return null;
  const relative = path.relative(root, path.resolve(filePath));
  return relative.startsWith('..') ? null : relative.replace(/\\/g, '/');
}

function gatesForPaths(paths) {
  const gates = new Set();
  for (const relativePath of paths) {
    for (const mapping of GATE_MAP) {
      if (mapping.test.test(relativePath)) mapping.gates.forEach((gate) => gates.add(gate));
    }
  }
  return [...gates];
}

function changedOwnedPaths(root, state) {
  return [...new Set(state.touched || [])].filter((relativePath) => {
    const before = state.baseline[relativePath] || 'clean';
    return fingerprint(root, relativePath) !== before;
  });
}

function invariantFailures(root) {
  return checkAgentInvariants(root).filter((result) => !result.ok);
}

function additionalContext(hookEventName, message) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName, additionalContext: message },
  }));
}

// Once-per-session-open: route domain work to the agent wiki (discoverability —
// the wiki is the retrieval launch-pad, but only if agents are reminded to read
// it during planning, not just when a watched path is edited) and surface memory
// router pressure early, before the write-time guard has to block an edit.
function wikiAndRouterNotes(root) {
  const notes = [
    'Agent wiki: for reviewer-finder, external-reviewer portal, intake, or Dataverse/Dynamics work, read docs/agent-wiki/index.md first — it routes to the source files, Atlas pages, and prior hazards for that domain before you edit, and is the cheap home for domain detail. Update the matching topic page when you change durable behavior.',
  ];
  try {
    const memBytes = fs.statSync(path.join(root, '.claude-memory', 'MEMORY.md')).size;
    const CAP = 12 * 1024;
    const WARN = 11 * 1024;
    if (memBytes > WARN) {
      notes.push(`Memory router pressure: .claude-memory/MEMORY.md is ${memBytes}B, within ${CAP - memBytes}B of the ${CAP}B hard cap. Put the next domain's detail in a docs/agent-wiki/topics/ page and add only a terse router line — the write-time guard will block a bloating edit.`);
    }
  } catch {
    // MEMORY.md unreadable; skip the pressure note.
  }
  return notes;
}

function start(input, root, file) {
  const notes = wikiAndRouterNotes(root);
  const existing = loadState(file);
  if (existing) {
    const failures = invariantFailures(root);
    if (failures.length) {
      notes.push(`Agent symlink diagnostic: ${failures.map((item) => item.name).join(', ')}. Existing session baseline was preserved across resume/compact.`);
    }
    additionalContext('SessionStart', notes.join('\n\n'));
    return;
  }
  const state = {
    version: STATE_VERSION,
    root,
    startedAt: new Date().toISOString(),
    baseline: snapshot(root),
    baselineInvariantFailures: invariantFailures(root).map((item) => item.name),
    touched: [],
    gateCache: {},
  };
  saveState(file, state);

  if (state.baselineInvariantFailures.length) {
    notes.push(`Agent symlink diagnostic: already broken at session start: ${state.baselineInvariantFailures.join(', ')}. Run \`npm run check:agent-invariants\` and repair before changing these paths.`);
  }
  additionalContext('SessionStart', notes.join('\n\n'));
}

function record(input, root, file) {
  const relativePath = relativeToolPath(input, root);
  if (!relativePath) return;
  const state = loadState(file);
  if (!state) return;
  if (!state.touched.includes(relativePath)) state.touched.push(relativePath);
  saveState(file, state);
}

function runGate(root, gate) {
  const result = spawnSync('npm', ['run', gate], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}\n${result.stderr || ''}`.trim().split('\n').slice(-12).join('\n'),
  };
}

function stop(input, root, file) {
  const state = loadState(file);
  if (!state) {
    // No baseline ledger (the session predates this hook, or the tmp state expired).
    // There is nothing session-owned to verify and nothing for Claude to act on, so
    // exit silently. Emitting additionalContext here would re-open the turn on EVERY
    // Stop (Stop additionalContext continues the conversation), looping indefinitely.
    return;
  }

  const owned = changedOwnedPaths(root, state);
  const currentFailures = invariantFailures(root);
  const newlyBrokenProtected = currentFailures.filter((item) =>
    !state.baselineInvariantFailures.includes(item.name) &&
    (owned.includes(item.path ? path.relative(root, item.path).replace(/\\/g, '/') : '') || PROTECTED_PATHS.has(item.name))
  );

  if (newlyBrokenProtected.length) {
    console.error(`Agent instruction invariant broken during this session: ${newlyBrokenProtected.map((item) => item.name).join(', ')}. Run \`npm run check:agent-invariants\` and repair the symlink(s) before stopping.`);
    process.exit(2);
  }

  const gates = gatesForPaths(owned);
  if (gates.length === 0) return;

  const fingerprintKey = hash(owned.map((p) => `${p}:${fingerprint(root, p)}`).sort().join('\n'));
  const failures = [];
  for (const gate of gates) {
    const cached = state.gateCache[gate];
    const result = cached && cached.fingerprintKey === fingerprintKey && cached.ok ? cached : runGate(root, gate);
    state.gateCache[gate] = { ...result, fingerprintKey, checkedAt: new Date().toISOString() };
    if (!result.ok) failures.push({ gate, output: result.output });
  }
  saveState(file, state);

  if (!failures.length) return;
  const summary = failures.map(({ gate, output }) => `\`${gate}\` failed:\n${output}`).join('\n\n');
  const mode = process.env.CLAUDE_STOP_GATE_MODE || 'advisory';
  if (mode === 'block') {
    console.error(`Session-owned changed-surface gate failure:\n${summary}`);
    process.exit(2);
  }

  // Advisory mode: surface each distinct failure state to Claude exactly once, then let
  // the Stop proceed. additionalContext re-opens the turn, so re-emitting the same failure
  // on every Stop would loop forever. De-dup on (failing gates + changed-surface
  // fingerprint); once advised for that state, stay silent so the next Stop is clean. A new
  // edit (new fingerprint) or a different failing gate re-surfaces; a fixed gate yields an
  // empty `failures` and returns above.
  const advisedKey = hash(`${failures.map((f) => f.gate).sort().join('\n')}|${fingerprintKey}`);
  if (state.lastAdvisedKey === advisedKey) return;
  state.lastAdvisedKey = advisedKey;
  saveState(file, state);
  additionalContext('Stop', `Advisory changed-surface gate failure (blocking rollout is not enabled):\n${summary}`);
}

async function main() {
  const mode = process.argv[2];
  const input = await readStdin();
  const root = repoRoot(input);
  const file = statePath(input, root);
  try {
    if (mode === 'start') start(input, root, file);
    else if (mode === 'record') record(input, root, file);
    else if (mode === 'stop') stop(input, root, file);
  } catch (error) {
    if (mode === 'stop') additionalContext('Stop', `Instruction-architecture hook failed safely: ${error.message}. Verification is advisory until the hook is repaired.`);
  }
}

if (require.main === module) main();

module.exports = {
  changedOwnedPaths,
  dirtyPaths,
  fingerprint,
  gatesForPaths,
  snapshot,
};
