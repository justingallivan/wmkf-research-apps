#!/usr/bin/env node
'use strict';

const path = require('path');

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    if (!data || !['Write', 'Edit'].includes(data.tool_name)) return;
    const root = path.resolve(data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const filePath = data.tool_input && data.tool_input.file_path;
    if (typeof filePath !== 'string') return;
    const relative = path.relative(root, path.resolve(filePath)).replace(/\\/g, '/');
    if (relative !== 'AGENTS.md' && relative !== '.agents/skills') return;
    console.error(
      `Refusing direct ${data.tool_name} to protected symlink path ${relative}. ` +
      'Edit the authoritative target instead and run `npm run check:agent-invariants`.'
    );
    process.exit(2);
  } catch {
    // Fail open; the Stop invariant checker remains the backstop.
  }
});
