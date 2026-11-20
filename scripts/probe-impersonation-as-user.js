#!/usr/bin/env node
// Retired with the Phase I interface: the original probe relied on its UI
// to restore sentinel writes. Reference implementation: _archived/scripts/probe-impersonation-as-user.js.
console.error('This legacy Phase I write probe is retired. No data was changed.');
process.exitCode = 1;
