---
name: Check memory before asking the user to confirm pre-send / state items
description: When verifying a doc's pre-send checklist or any "is X done?" item, cross-check MEMORY.md and recent commits before asking the user — they expect me to use what's already logged.
type: feedback
originSessionId: a3cecb08-983c-47da-a202-b35687e2711f
status: active
scope: global
last_verified: 2026-05-05 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: verifying a "has X happened?" / "is X done?" item — pre-send checklists, status banners, "is the IT email out", "did Connor reply".

Do:
- Scan MEMORY.md and recent commits FIRST; resolve the item from the system of record.
- Rewrite stale status-banner framing in drafted docs without asking, once memory/commits confirm.

Do not:
- Ask the user to confirm lookup-able state (treats them as the system of record when it's right there in MEMORY.md).

Ground truth: historical-only (lesson, 2026-05-05 `docs/archive/CONNOR_INTAKE_PORTAL_SYNC.md` burn). User-action items (pick a slot, choose between options) ARE the ones to surface.

When verifying a "has X happened yet" item (pre-send checklist, status-banner claims, "is the IT email out", "did Connor reply", etc.), check MEMORY.md and recent commits *first*. Only ask the user if neither source resolves it.

**Why:** On 2026-05-05, prepping `docs/archive/CONNOR_INTAKE_PORTAL_SYNC.md`, I asked the user to confirm "IT email actually sent Monday." The answer was already in MEMORY.md (`project-intake-portal-external-id-foundation.md` — "External ID auth foundation SHIPPED (S129) — tenant `04a1406b...`, `/apply` route auth round-trip verified") and the user pointed out "I'm concerned about your logging." MEMORY.md is loaded into every session — not consulting it before asking is treating the user as the system of record when the system of record is right there.

**How to apply:**
- Pre-send checklists in Connor docs / planning docs typically have items like "confirm X happened" — those are *my* lookup tasks, not user tasks.
- Status banners in drafted docs ("IT email goes Monday 2026-05-04") rot. When prepping a doc for sending, scan its preamble/status-banner claims against MEMORY.md and recent commits, and rewrite stale framing without asking.
- User-action items (pick a sync slot, decide between options) are the ones to surface for confirmation. Lookup-able state is not.
