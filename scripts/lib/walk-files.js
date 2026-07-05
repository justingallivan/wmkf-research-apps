'use strict';

// Shared recursive-walk skeleton for the Family B markdown-doc gates.
// See docs/GATE_SCRIPT_CONSOLIDATION_PLAN.md (Architecture, Class 2).
//
// Recursion skeleton ONLY. Every census-determining decision stays in the
// caller's callbacks: the gate passes its own shouldExcludeRel (wrapping its
// existing EXCLUDE_DIR regex / predicate) and its own onFile handler (ext
// filter, frontmatter/allowlist logic, symlink lstat, special-cased files).
// No ROOTS/SINGLE_FILES/EXCLUDE_DIR/ext/skip semantics live here.

const fs = require('fs');
const path = require('path');

function walkTree(root, { repoRoot, shouldExcludeRel, onFile }) {
  (function walkDir(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(repoRoot, full);
      if (ent.isDirectory()) {
        if (!shouldExcludeRel(rel)) walkDir(full);
      } else {
        onFile(full);
      }
    }
  })(root);
}

module.exports = { walkTree };
