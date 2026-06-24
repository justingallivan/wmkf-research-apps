# Task: Verify code-anchored claims in this repo's memory + agent-wiki against the actual code

> Paste everything below the line into the Codex app (run from the repo root).
> Output lands at `docs/audits/memory-wiki-audit.md`.

---

You are auditing durable docs for staleness in the WMKF_Apps repo (a Next.js
multi-app system). Two bodies of durable knowledge drift from code over time:
  - `.claude-memory/*.md`       (~177 files: project notes, lessons, references)
  - `docs/agent-wiki/**/*.md`    (14 files: 12 topic pages + index/log)

FIRST read `CLAUDE.md` for the ground-truth rules + "Source-Of-Truth Pointers".
Governing rule: when a doc claim conflicts with source code / the Atlas / a live
probe, the live source wins. Verify against the PRODUCING code — never against the
doc's own restatement.

## ⛔ A prior run failed — do not repeat it

A previous attempt produced garbage and was thrown away. Its failure signature,
which you MUST NOT reproduce:
  - It stamped almost every line containing a path or identifier as "STALE" with a
    boilerplate correction ("Update this reference to the current canonical
    location" / "Verify whether this variable is obsolete").
  - It never checked whether the cited files actually exist — 7 of 8 sampled
    "stale" paths existed on disk.
  - Its "Producer" column just echoed the claim's own file:line, proving it never
    traced anything.
  - It flagged frontmatter metadata words (`description:`, `originSessionId:`) and
    `[[wiki-links]]` as stale.
If you find yourself about to write a generic correction or a Producer equal to the
claim location, STOP — you have not verified that claim.

## Hard verification rules (per claim)

1. A claim is only worth auditing if it asserts something CHECKABLE about the
   system: a file/path exists, a symbol/function/field/env-var/route/gate exists or
   behaves a certain way, a count, a status/enum value.
2. NOT claims (skip — do not extract or verdict): frontmatter keys
   (name/description/status/originSessionId/watch_paths), `[[wiki-links]]`,
   "Read this when:" routing lines, "Ground truth:" pointer lists, and how-to-work
   advice/opinion/strategy. (Exception: if such a line names a concrete path/symbol,
   you MAY verify that path/symbol exists — but the verdict is about existence, not
   the sentence.)
3. To mark anything STALE you MUST show evidence: the exact shell/grep command you
   ran AND its result. For a path claim, run `test -e <path> && echo EXISTS` (or
   ripgrep). A path that EXISTS is NOT stale — full stop.
4. The Producer must be a DIFFERENT location than the claim — the code/config/probe
   that owns the fact (e.g. claim in a memory → producer in `lib/...` or `pages/...`).
   If you cannot name an external producer, the claim is UNVERIFIABLE, not VERIFIED
   and not STALE.
5. Every STALE row MUST include the actual ground truth (real file:line or real
   current value) and a SPECIFIC correction. No generic/templated corrections. If you
   can't write a specific correction, it isn't STALE — downgrade to NEEDS-PROBE.
6. `.claude-memory/feedback-*.md` are how-to-work LESSONS — do not judge the advice;
   only verify concrete code references embedded in them (paths/symbols/flags).
7. Many memories explicitly say "re-probe, don't trust this file" for live Dataverse
   facts. Those are NEEDS-PROBE (you can't run live Dataverse), not STALE.

## Verdict taxonomy
  - VERIFIED     — checked against an external producer; matches. (Cite producer file:line.)
  - STALE        — external producer contradicts it. (Cite producer + evidence command + specific fix.)
  - UNVERIFIABLE — opinion/lesson/decision/metadata with no external code anchor.
  - NEEDS-PROBE  — only confirmable via a live DB/Dataverse/Vercel probe you cannot run.

## Calibration examples (do exactly this shape)

  Claim (`project-reviewer-accept-decline-links.md:15`): "Ground truth:
  pages/api/external/review/[token]/respond.js".
  → Check: `test -e 'pages/api/external/review/[token]/respond.js'` → EXISTS.
  → Verdict: VERIFIED (path exists; producer = that file). NOT stale.

  Claim (`project-reviewer-web-discovery-abandoned.md:6`): "lib/services/
  web-discovery-service.js".
  → Check: `find . -name web-discovery-service.js -not -path '*/node_modules/*'` → no result.
  → But the memory's whole point is the capability was ABANDONED → reference is
    intentionally historical → UNVERIFIABLE (historical), not STALE.

## Method — staged execution (calibration batch first)

### Stage 0 — CALIBRATION BATCH (do this before anything else)
Run the full verification procedure on ONLY the 12 agent-wiki topic pages
(`docs/agent-wiki/topics/*.md`). Use a few sub-agents if you like, but keep this
batch small and do it carefully. Then STOP and self-audit this batch against the
pass criteria below before touching any other file.

PASS CRITERIA (all must hold for the calibration batch):
  - Every STALE row cites a Producer in a DIFFERENT file than the claim, AND
    includes the exact evidence command + its result, AND a specific (non-boilerplate)
    correction. Zero STALE is an acceptable, even expected, result.
  - You actually ran `test -e` / ripgrep for each path-bearing claim (show the
    commands), and no claim whose path EXISTS is marked STALE.
  - Frontmatter keys, `[[wiki-links]]`, "Read this when:"/"Ground truth:" pointer
    lines, and how-to-work advice were NOT extracted as claims.
  - No two corrections are identical boilerplate.

SELF-GATE:
  - If the calibration batch FAILS any criterion, discard it, correct your method,
    and redo the 12 pages before proceeding. Do not carry a flawed method forward.
  - Only after the calibration batch PASSES, write it as the FIRST entry in the
    report under a "## Stage 0 — Calibration (agent-wiki topics)" heading, then
    continue to Stage 1.
  - If after two attempts the calibration batch still cannot meet the criteria,
    STOP and write a short report saying so (with examples) instead of proceeding —
    a failed calibration means the full run would be noise.

### Stage 1 — FULL RUN (only after Stage 0 passes)
Partition the remaining 179 files — all 177 `.claude-memory/*.md` plus the 2
non-topic agent-wiki files (`docs/agent-wiki/index.md`, `docs/agent-wiki/log.md`) —
across many sub-agents (~15-20 files each → ~10-12 verifier agents + 1 synthesizer),
applying the exact same
verified method that passed calibration. Each verifier runs the existence/grep/read
checks for its batch and records evidence. Before finalizing, the synthesizer RE-RUNS
the existence check on every STALE row and drops any whose path exists / claim holds
(self-falsification pass). Every in-scope file must appear in the coverage table.

## Hard constraints
  - READ-ONLY except the single report file. Edit NO memory/wiki file.
  - Run NO state-changing git command (shared working dir, another active session).
    Reading `git rev-parse HEAD` for the header is fine.

## Deliverable — write ONE file: `docs/audits/memory-wiki-audit.md`
  1. Header: date, `git rev-parse HEAD`, files scanned, counts-by-verdict table.
  2. Stage 0 — Calibration (agent-wiki topics): the calibration-batch results.
  3. ACTION LIST (STALE only), each with: file:line | quoted claim | producer file:line
     | evidence command+result | specific correction. If zero STALE, say so plainly.
  4. NEEDS-PROBE list: claim + the exact probe a human should run.
  5. Coverage table: one row per in-scope file → {VERIFIED, STALE, UNVERIFIABLE,
     NEEDS-PROBE} counts. (Per-file summary — NOT a dump of every line.)

## Completion criteria
Every in-scope file is in the coverage table; every STALE row has an external
producer + evidence + a specific fix; no boilerplate corrections; no Producer equal
to its claim location. Print the counts-by-verdict summary and the number of files
with ≥1 STALE.
