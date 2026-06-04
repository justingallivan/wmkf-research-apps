---
name: Living-taxonomy principle + staff-guide artifact philosophy (Power Tools)
description: Dataverse reference taxonomies are living; durable record = invariants/patterns/hazards + a staff orientation guide, NOT hardcoded value lists; Track B reads taxonomies live and fails loud
type: project
originSessionId: S157
status: active
scope: dataverse
last_verified: S157 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: doing any Power Tools data-archaeology, the Track B build, or any work that touches a Dataverse reference taxonomy (programs, statuses, types).

Do:
- Read taxonomies live at query time and fail loud on unknown values ("N rows in unclassified program X — included, flagged"); never hardcode a snapshot.
- Keep the three shelf-lives separate: invariants (durable) · patterns/hazards/methods (the real product) · value/count snapshots (dated evidence only, "as of DATE, re-derive live").
- Probe only with a structural hypothesis; the committed probe script is the durable artifact, its output is just the last run.

Do not:
- Hardcode a taxonomy value list or propose a documentation cadence / drift monitor as a silent default (currency lives in the runtime; a monitor is a separate, costed, ask-only build).
- Ship a programmatic enum as the durable human artifact — the deliverable is a staff orientation guide written after probing.

Ground truth: `docs/DATAVERSE_POWER_TOOLS_DESIGN.md` → "Living taxonomy — design invariant"; related [[project-dataverse-power-tools]].

User-agreed resolution (S157, 2026-05-16) of the durable-record vs. living-taxonomy tension. Governs all Power Tools data-archaeology and the eventual Track B build. Full statement: `docs/DATAVERSE_POWER_TOOLS_DESIGN.md` → "Living taxonomy — design invariant".

**Why:** `akoya_program` grew 14 → 24 over 2.5 years and keeps growing; statuses/types/programs mutate, get deactivated, get duplicated. A record (or tool) that hardcodes a taxonomy snapshot silently excludes anything added later — exactly the "plausible wrong answer" the Track B threat model targets.

**How to apply:**
- **Read live, fail loud.** Track B enumerates taxonomies from Dataverse at query time, never a hardcoded list; unknown values are surfaced loudly ("N rows in unclassified program X — included, flagged"), never silently dropped/rebucketed. Currency lives in the runtime, so **no documentation cadence / drift monitor is needed** (a drift monitor is a separate, optional, costed build — never a silent default; don't propose automation unless explicitly asked).
- **Three layers, different shelf lives:** invariants (durable fact) · patterns/hazards/methods (durable, the real product) · value/count snapshots (ephemeral — dated evidence ONLY, never spec, never hardcoded). Label every snapshot "as of DATE, re-derive live."
- **Probe policy:** run a probe only with a *structural hypothesis* (era-scoped? duplicates? operational buckets? nullable?), not to enumerate a list. Deliverable = the pattern/hazard/invariant; the committed probe is the durable re-runnable artifact, its output just the last run. Probing-to-learn is the endorsed working mode — it is how this project's data understanding was built; keep doing it, just don't ossify the outputs.
- **The durable human artifact is a staff orientation guide, not a lookup table.** Recurring user pain: staff (and sessions) reinvent the wheel re-discovering the DB — "what is this field called, where does X live, why is Y shaped this way." Synthesis target = a human-readable guide built *after* puzzle probing, not a programmatic enum. See [[project-dataverse-power-tools]].
