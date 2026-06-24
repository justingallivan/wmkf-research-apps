# Task: Apply the STALE fixes from the memory/wiki audit report

> Paste everything below the line into the Codex app (run from the repo root).
> Input: `docs/audits/memory-wiki-audit.md` (the audit report). Companion to
> `docs/audits/memory-wiki-audit-PROMPT.md` (the audit prompt that produced it).

---

The audit report `docs/audits/memory-wiki-audit.md` lists 26 STALE claims in
`.claude-memory/*.md` and `docs/agent-wiki/**/*.md`, each with a producer citation,
an evidence command, and a specific proposed correction. Apply those corrections.

FIRST read `CLAUDE.md` and `.claude/rules/durable-docs.md` for the doc-edit rules.

## Scope — STRICT
- Fix ONLY the 26 claims in the report's "## Actionable Stale Findings" section.
- Do NOT touch the "Needs-Probe Register" (82) — those require live DB/Dataverse/
  Vercel probes you cannot run. Leave them.
- Do NOT edit VERIFIED claims, and do NOT make unrelated rewrites/wordsmithing.
- Do NOT delete or rewrite the audit report itself.

## Re-verify BEFORE editing (the report is not current)
The report was generated at HEAD `04611a3f`; the repo has advanced several commits
since (some findings may already be fixed). For EACH stale finding:
  1. Re-locate the claim by CONTENT, not the cited line number (line numbers have drifted).
  2. Re-run the evidence check against the live producer (the cited code/config).
  3. If the claim is already correct / no longer present → SKIP it, note "already fixed".
  4. If still stale → apply the report's specific correction.
Never apply a correction you could not re-confirm against the current producer.

## Reconcile, don't patch (the core rule)
For each fix, the same stale fact usually appears in MORE than the flagged line:
- Read the WHOLE target file (no offset/limit slice) before editing it.
- Fix every instance in that file — frontmatter `description`, body, "Ground truth:"
  lines, recall rules, tails.
- Then grep the WHOLE repo for the same fact and fix it everywhere it recurs
  (including docs/ files outside the audit scope — e.g. a `DEFAULT_SUBJECT`/
  `DEFAULT_BODY` location fact also appears in `docs/UNIFIED_EMAIL_SIGNATURE_PLAN.md`).
  A partial fix that leaves a contradiction elsewhere is worse than none.
- Keep edits minimal and fact-correcting; cite the producer in the corrected text
  where the original did.

## Memory-router integrity
Several targets are `.claude-memory/*.md` with frontmatter. Preserve a valid
`status:` and keep `[[links]]` resolving; if you touch `.claude-memory/MEMORY.md`
keep its router shape. `npm run check:memory-router` must stay green.

## Method — modest, collision-safe parallelism
Partition the stale findings BY TARGET FILE. Use sub-agents, but each file is owned
by EXACTLY ONE agent — never let two agents edit the same file (write collisions).
A finding whose fact spans multiple files: the owning agent fixes its file and lists
the other files; a final single-threaded synthesizer pass applies those cross-file
reconciliations and then runs the gates. Only ~26 findings — favor correctness over
fan-out width.

## Gates — must be GREEN before committing
Run each gate and its self-test SEQUENTIALLY (never in parallel — self-tests write
fixtures into the paths the gate scans):
  npm run check:fact-consistency && npm run check:fact-consistency:self-test
  npm run check:doc-currency && npm run check:doc-currency:self-test
  npm run check:memory-router && npm run check:memory-router:self-test
  npm run check:canonical-pointers && npm run check:canonical-pointers:self-test
  npm run check:drain-table-mentions && npm run check:drain-table-mentions:self-test
  npm run check:prompt-storage-mentions && npm run check:prompt-storage-mentions:self-test
  npm run check:agent-wiki && npm run check:agent-wiki:self-test
Fix any gate you turn red before proceeding.

## Git — you are the sole git driver for this run
Another session shares this working directory, so:
  - Commit DIRECTLY to `main` (project convention — no feature branch, no PR).
  - Do NOT run any branch checkout/switch/stash (that drifts the shared HEAD).
  - Before pushing, `git pull --rebase origin main` to absorb any concurrent commit,
    then push. Use a descriptive commit message.
  - Run `git status --short --branch` first and confirm you are on `main`.

## Deliverable
After committing, print a summary: for each of the 26 findings — APPLIED (file(s)
touched), SKIPPED-ALREADY-FIXED, or DEFERRED (with reason). Note any cross-file
reconciliations made beyond the audit's scope.
