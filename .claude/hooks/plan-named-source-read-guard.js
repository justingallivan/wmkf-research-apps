#!/usr/bin/env node
'use strict';

/*
 * PreToolUse hook (Write|Edit): plan docs that name live source files must show
 * evidence that those files were read/opened in this session. This keeps a plan
 * from imposing contracts on the hardest named routes/services without first
 * inspecting them.
 *
 * Visible escape hatch, in the artifact near the path:
 *   [NOT-READ: pages/api/foo.js — reason]
 */

const fs = require('fs');
const path = require('path');
const {
  extractNamedSourcePaths,
  hasNotReadEscape,
  isPlanDoc,
  newlyIntroducedText,
  proposedTextForTool,
  repoRelative,
  resolveInside,
  transcriptHasReadEvidence,
} = require('./lib/document-guards');

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    if (!data || (data.tool_name !== 'Write' && data.tool_name !== 'Edit')) return;

    const root = path.resolve(data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const ti = data.tool_input || {};
    const filePath = typeof ti.file_path === 'string' ? ti.file_path : '';
    if (!filePath) return;

    const rel = repoRelative(root, filePath);
    if (!/^docs\/.*\.md$/i.test(rel)) return;

    const proposed = proposedTextForTool(data, root);
    if (!proposed || !isPlanDoc(rel, proposed)) return;

    // Judge only the text this call introduces — a paragraph edit in a long
    // historical plan must not re-litigate every path the doc already names.
    const introduced = newlyIntroducedText(data, root);
    if (!introduced) return;

    const namedSources = extractNamedSourcePaths(introduced)
      .filter((sourceRel) => {
        const full = resolveInside(root, sourceRel);
        return full && fs.existsSync(full) && fs.statSync(full).isFile();
      });
    if (!namedSources.length) return;

    const transcriptPath = typeof data.transcript_path === 'string' ? data.transcript_path : '';
    const transcript = transcriptPath && fs.existsSync(transcriptPath)
      ? fs.readFileSync(transcriptPath, 'utf8')
      : '';

    const unread = namedSources.filter((sourceRel) =>
      !hasNotReadEscape(proposed, sourceRel) &&
      !transcriptHasReadEvidence(transcript, root, sourceRel)
    );
    if (!unread.length) return;

    console.error(
      `BLOCKED: plan \`${rel}\` names live source file(s) that were not read/opened in this session:\n` +
      unread.slice(0, 12).map((sourceRel) => `  - ${sourceRel}`).join('\n') + '\n' +
      'Read each named file first, or keep an explicit visible escape beside the path: ' +
      '[NOT-READ: <path> — reason].'
    );
    process.exit(2);
  } catch {
    // Fail open: this guard should not brick editing if the hook runtime changes.
  }
});
