---
title: Local Operational Source Disposal Receipt — 2026-07-27
domain: security-privacy
kind: audit
status: complete
summary: "Privacy-safe aggregate receipt for the owner-approved deletion of 139 ignored repository-side operational files after preservation and exact private review."
canonical: false
cataloged: 2026-07-27
last_verified: 2026-07-27
owner: product-engineering
related:
  - docs/audits/local-operational-data-retention-audit-2026-07-27.md
  - docs/audits/public-repository-pii-history-audit-2026-07-27.md
---

# Local Operational Source Disposal Receipt — 2026-07-27

## Result

**Status: complete.**

The repository owner confirmed that the latest preservation and private-review
files were visible in the owner-only organizational archive, reviewed the
exact private candidate manifest, and approved disposal of its complete
source-only scope.

The fail-closed deletion removed:

- 139 ignored, untracked regular files;
- 15,287,781 bytes; and
- zero tracked files, directories, symlinks, or external-archive files.

There were zero deletion failures and zero residual regular files in the
bounded source scope. Five ignored dependency symlinks remain because the
approved contract explicitly excluded symlinks and directories.

## Safety contract

Before deletion, both the execution preflight and an independent read-only
review verified:

- the private manifest matched the owner-reviewed cryptographic receipt;
- all 139 paths were unique, normalized, repository-relative, and inside the
  allowed ignored-output or operational-state prefixes;
- every target was a current regular file, ignored by Git, absent from the
  tracked index, and byte-identical to its reviewed hash and size;
- the live scoped inventory contained exactly the 139 reviewed files, with no
  unmanifested addition or missing target;
- all 82 archive-backed rows still had an exact owner-only preservation copy;
- all 20 individually preserved unique-source files matched their archive
  copies; and
- the repository and archive roots were disjoint, with no archive target,
  source/archive hard link, traversal, absolute path, directory, or symlink in
  the deletion set.

The 57 source files without an exact archive copy were limited to 49
reproducible or derived artifacts, seven review/handoff notes whose durable
content was independently reconciled into tracked documentation, and one
superseded workbook whose substantive fields and formulas were verified
against retained sources.

## Post-deletion verification

The post-delete probe independently found:

| Check | Result |
|---|---:|
| Deleted source regular files | 139 |
| Deleted source bytes | 15,287,781 |
| Failed deletions | 0 |
| Residual scoped regular files | 0 |
| Residual excluded dependency symlinks | 5 |
| Archive files after private receipt creation | 91 |
| Archive bytes after private receipt creation | 9,082,388 |
| Archive symlinks | 0 |
| Archive file modes | `0600` only |
| Archive directory modes | `0700` only |

The archive content snapshot was unchanged throughout source deletion. Two
owner-only receipt files were added afterward, bringing the verified archive
to 91 files across 21 directories. The private exact receipt retains row-level
paths and hashes; this tracked receipt intentionally retains only aggregate
counts and safety properties.

## Scope boundary

This receipt closes the ignored regular-file component of the local retention
audit. It does not delete or shorten the retention of the owner-only archive,
establish a calendar retention period for that archive, remove the five
excluded dependency symlinks, or rewrite reachable public Git history.
