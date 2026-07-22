#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { checkAgentInvariants } = require('../../scripts/check-agent-invariants');
const {
  docMentionsChangedSource,
  extractAdversarialReviewReceiptPaths,
  hasAdversarialReviewWaiver,
  hasStalenessAck,
  isHighRiskReviewArtifact,
  isQualifiedAdversarialReviewPrompt,
  isPlanOrDesignDoc,
} = require('./lib/document-guards');

const STATE_VERSION = 3;
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

function initStateCollections(state) {
  if (!Array.isArray(state.touched)) state.touched = [];
  if (!Array.isArray(state.touchLog)) state.touchLog = [];
  if (!Array.isArray(state.staleDocWarnings)) state.staleDocWarnings = [];
  if (!state.adversarialReviewRequirements || typeof state.adversarialReviewRequirements !== 'object') {
    state.adversarialReviewRequirements = {};
  }
  if (!state.adversarialReviewReceipts || typeof state.adversarialReviewReceipts !== 'object') {
    state.adversarialReviewReceipts = {};
  }
}

function isSourceStalenessPath(relativePath) {
  return /^(?:scripts|lib)\/.+\.(?:js|jsx|ts|tsx|mjs|cjs)$/.test(relativePath);
}

function isDocsMarkdown(relativePath) {
  return /^docs\/.+\.md$/.test(relativePath);
}

function warningKey(warning) {
  return `${warning.docPath}|${warning.changedPath}`;
}

function readText(root, relativePath) {
  try { return fs.readFileSync(path.join(root, relativePath), 'utf8'); } catch { return ''; }
}

function detectStaleDocWarnings(root, state, changedPath) {
  if (!isSourceStalenessPath(changedPath)) return [];
  const priorDocs = [...new Set((state.touchLog || [])
    .map((entry) => entry && entry.path)
    .filter((entryPath) => entryPath && isDocsMarkdown(entryPath)))];

  const warnings = [];
  for (const docPath of priorDocs) {
    const text = readText(root, docPath);
    if (!text) continue;
    const mention = docMentionsChangedSource(text, changedPath);
    if (!mention || hasStalenessAck(text, changedPath)) continue;
    warnings.push({
      docPath,
      changedPath,
      term: mention.term,
      strict: isPlanOrDesignDoc(docPath, text),
      createdAt: new Date().toISOString(),
    });
  }
  return warnings;
}

function unresolvedStaleDocWarnings(root, state) {
  const unresolved = [];
  const seen = new Set();
  for (const warning of state.staleDocWarnings || []) {
    if (!warning || !warning.docPath || !warning.changedPath) continue;
    const key = warningKey(warning);
    if (seen.has(key)) continue;
    seen.add(key);

    const text = readText(root, warning.docPath);
    const mention = text && docMentionsChangedSource(text, warning.changedPath);
    if (!text || !mention || hasStalenessAck(text, warning.changedPath)) continue;
    unresolved.push({ ...warning, term: mention.term });
  }
  return unresolved;
}

function staleDocWarningMessage(warnings, changedPath) {
  const docs = warnings.map((warning) =>
    `  - ${warning.docPath} mentions \`${warning.term}\`${warning.strict ? ' (Stop-blocking plan/design doc)' : ''}`
  ).join('\n');
  return (
    `Same-session doc staleness: \`${changedPath}\` changed after docs modified earlier in this session mention it.\n` +
    `${docs}\n` +
    `Re-open/update the doc claim, or add a visible marker near it: [RECHECKED after ${changedPath} change: <file:line/probe>] or [STALE-ACCEPTED: ${changedPath} — reason].`
  );
}

function updateAdversarialReviewRequirement(root, state, relativePath) {
  if (!isDocsMarkdown(relativePath)) return;
  const text = readText(root, relativePath);
  if (!text || !isHighRiskReviewArtifact(relativePath, text)) {
    delete state.adversarialReviewRequirements[relativePath];
    delete state.adversarialReviewReceipts[relativePath];
    return;
  }
  state.adversarialReviewRequirements[relativePath] = {
    fingerprint: fingerprint(root, relativePath),
    requiredAt: new Date().toISOString(),
  };
}

function recordAdversarialReview(input, root, file) {
  const state = loadState(file);
  if (!state) return;
  initStateCollections(state);
  const prompt = typeof input?.tool_input?.prompt === 'string' ? input.tool_input.prompt : '';
  if (!prompt) return;

  let changed = false;
  for (const relativePath of extractAdversarialReviewReceiptPaths(prompt)) {
    const text = readText(root, relativePath);
    if (!text || !isHighRiskReviewArtifact(relativePath, text)) continue;
    if (!isQualifiedAdversarialReviewPrompt(prompt, relativePath)) continue;
    state.adversarialReviewReceipts[relativePath] = {
      fingerprint: fingerprint(root, relativePath),
      reviewedAt: new Date().toISOString(),
      promptHash: hash(prompt),
    };
    changed = true;
  }
  if (changed) saveState(file, state);
}

function unresolvedAdversarialReviewRequirements(root, state) {
  initStateCollections(state);
  const unresolved = [];
  for (const [relativePath, requirement] of Object.entries(state.adversarialReviewRequirements)) {
    const text = readText(root, relativePath);
    if (!text || !isHighRiskReviewArtifact(relativePath, text)) continue;
    if (hasAdversarialReviewWaiver(text)) continue;
    const currentFingerprint = fingerprint(root, relativePath);
    const receipt = state.adversarialReviewReceipts[relativePath];
    if (receipt && receipt.fingerprint === currentFingerprint) continue;
    unresolved.push({
      relativePath,
      requiredFingerprint: requirement?.fingerprint || null,
      currentFingerprint,
      reviewedFingerprint: receipt?.fingerprint || null,
    });
  }
  return unresolved;
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
    touchLog: [],
    staleDocWarnings: [],
    adversarialReviewRequirements: {},
    adversarialReviewReceipts: {},
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
  initStateCollections(state);
  const newWarnings = detectStaleDocWarnings(root, state, relativePath)
    .filter((warning) => !state.staleDocWarnings.some((existing) =>
      warningKey(existing) === warningKey(warning)
    ));
  if (!state.touched.includes(relativePath)) state.touched.push(relativePath);
  state.touchLog.push({ path: relativePath, at: new Date().toISOString() });
  state.staleDocWarnings.push(...newWarnings);
  updateAdversarialReviewRequirement(root, state, relativePath);
  saveState(file, state);
  if (newWarnings.length) additionalContext('PostToolUse', staleDocWarningMessage(newWarnings, relativePath));
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

  initStateCollections(state);
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

  const unresolvedStaleDocs = unresolvedStaleDocWarnings(root, state);
  state.staleDocWarnings = unresolvedStaleDocs;
  saveState(file, state);
  const strictStaleDocs = unresolvedStaleDocs.filter((warning) => warning.strict);
  if (strictStaleDocs.length) {
    const summary = strictStaleDocs.map((warning) =>
      `  - ${warning.docPath} still mentions \`${warning.term}\` after ${warning.changedPath} changed`
    ).join('\n');
    console.error(
      'Same-session doc staleness unresolved for plan/design docs:\n' +
      `${summary}\n` +
      'Re-open/update each doc claim, or add a visible marker near the claim: ' +
      '[RECHECKED after <changed-path> change: <file:line/probe>] or [STALE-ACCEPTED: <changed-path> — reason].'
    );
    process.exit(2);
  }

  const unresolvedReviews = unresolvedAdversarialReviewRequirements(root, state);
  if (unresolvedReviews.length) {
    const summary = unresolvedReviews.map(({ relativePath }) => `  - ${relativePath}`).join('\n');
    console.error(
      'Adversarial review receipt missing or stale for consequential review artifact(s):\n' +
      `${summary}\n` +
      'Run a fresh Task/Agent review after the latest edit. The prompt must include:\n' +
      '  [ADVERSARIAL-REVIEW-RECEIPT: <docs/path.md>]\n' +
      '  Ask the fresh agent to be adversarial/refute, verify for each recommendation with file:line evidence, ' +
      'and run a disconfirming check.\n' +
      'If the owner deliberately accepts the residual, add a visible document marker: ' +
      '<!-- adversarial-review:waived reason=<specific reason> -->'
    );
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
    else if (mode === 'review-record') recordAdversarialReview(input, root, file);
    else if (mode === 'stop') stop(input, root, file);
  } catch (error) {
    if (mode === 'stop') additionalContext('Stop', `Instruction-architecture hook failed safely: ${error.message}. Verification is advisory until the hook is repaired.`);
  }
}

if (require.main === module) main();

module.exports = {
  changedOwnedPaths,
  detectStaleDocWarnings,
  dirtyPaths,
  fingerprint,
  gatesForPaths,
  record,
  recordAdversarialReview,
  statePath,
  unresolvedAdversarialReviewRequirements,
  unresolvedStaleDocWarnings,
  snapshot,
};
