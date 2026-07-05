'use strict';

// Stage-0 characterization artifact for docs/GATE_SCRIPT_CONSOLIDATION_PLAN.md.
// NOT part of any gate's logic — a preload shim (`node -r ./scripts/lib/__gate-census-trace.js`)
// that monkeypatches fs.readFileSync/fs.readdirSync to append each resolved path to the file
// named by GATE_CENSUS_OUT. Used to diff a gate's file census before/after a refactor. Safe to
// remove once the refactor in that plan is complete and verified.

const fs = require('fs');
const path = require('path');

const outFile = process.env.GATE_CENSUS_OUT;
if (outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, '');

  const append = (p) => {
    try {
      fs.appendFileSync(outFile, `${path.resolve(String(p))}\n`);
    } catch {
      // best-effort only; never let tracing break the gate
    }
  };

  const origReadFileSync = fs.readFileSync;
  fs.readFileSync = function patchedReadFileSync(p, ...rest) {
    append(p);
    return origReadFileSync.call(fs, p, ...rest);
  };

  const origReaddirSync = fs.readdirSync;
  fs.readdirSync = function patchedReaddirSync(p, ...rest) {
    append(p);
    return origReaddirSync.call(fs, p, ...rest);
  };
}
