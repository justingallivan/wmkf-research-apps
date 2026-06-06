# Claude Instruction Architecture Cleanup — Phase 1 Review Response

**Created:** 2026-06-05 (S225)
**Reviewer:** Claude (Opus 4.8)
**Reviews:** `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_CLEANUP_PLAN.md`
**Verdict format:** `AGREE` / `MODIFY` / `OBJECT` with evidence, per the plan's "Claude Architecture Review Questions."

> **Why this review exists.** This session (S225) Claude repeatedly violated rules that are *already present* in `CLAUDE.md` and memory — probe-before-plan, time-box meta-work, falsify-don't-confirm, and "don't assert unverified state as built." The cleanup plan's thesis — that a 308-line root file (over Anthropic's documented ~200-line adherence threshold) dilutes must-follow rules into skimmed-past noise — is a fair root-cause diagnosis of that behavior. This review takes the plan seriously and grounds every claim in a probe rather than assertion, which is the discipline that lapsed.

> **Revised 2026-06-05 after a second review (corrections marked [corrected]).** That review caught a real factual error in this response's first draft: it claimed `SessionStart` exit 2 *blocks* launch — **it does not** (re-verified verbatim against the hooks doc; §1). The bad fact came from a verification source that was itself wrong, which is its own lesson: a verbatim doc quote beats a paraphrasing source. Corrections applied throughout — SessionStart is non-blocking; the §4 enforcement package is re-scoped and de-risked; Q7's unevidenced "doubles missed-invocation risk" + the "auto-fired once invoked" muddle are removed; Q8 is reframed from a fictional runtime precedence to an ownership policy; and `setup-database.js`'s self-contradiction is recorded as a prerequisite.

---

## 1. Verified facts (probed, not assumed)

| Claim | Result | Evidence |
|---|---|---|
| Root `CLAUDE.md` is ~308 lines | **CONFIRMED — exactly 308** | `wc -l CLAUDE.md` |
| Over Anthropic's recommended size | **CONFIRMED** | Docs: "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence." (code.claude.com/docs/en/memory.md) |
| `AGENTS.md` is a tracked symlink to `CLAUDE.md` | **CONFIRMED** | `ls -l AGENTS.md` → `AGENTS.md -> CLAUDE.md` |
| `.claude/rules/` does not exist yet | **CONFIRMED** | `ls .claude/rules` → No such file or directory |
| `.claude/rules/` with `paths:` frontmatter is a real feature, loading **on-demand when a matching file is read** (not at startup) | **CONFIRMED (docs, high confidence)** | code.claude.com/docs/en/memory.md (via claude-code-guide) |
| Current hooks are reminder-only and fail open | **CONFIRMED** | 4 hooks (`scope-claim`, `doc-edit-reconcile`, `contract-surface` = PreToolUse; `codex-verbatim` = PostToolUse), all emit `additionalContext` with explicit `// fail open — never block`. **No project-level `Stop`/`SessionStart` hook** (`settings.json` wires only PreToolUse+PostToolUse; `settings.local.json` has no hook events — it's the permissions allowlist). The SessionStart hooks that fire at launch come from the **Vercel plugin**, not project config. |
| Hook enforcement strength (exit-code-2 behavior, quoted from hooks doc) | **CONFIRMED (docs)** — **[corrected]** | Can block: `PreToolUse` ("Blocks the tool call"), `UserPromptSubmit` ("Blocks prompt processing"), `Stop` ("Prevents Claude from stopping, continues" — auto-override after 8 consecutive blocks), `PreCompact` ("Blocks compaction"). **Cannot block:** `PostToolUse` ("Shows stderr to Claude, tool already ran") and **`SessionStart` ("Can block? No — Shows stderr to user only")**. ⚠ The first draft wrongly said SessionStart blocks launch — it does not. |
| `CLAUDE.md` survives compaction | **CONFIRMED (docs)** | Re-read from disk + re-injected post-compaction; `@import`s load eagerly at launch (no context savings — rules are the conditional-load mechanism). |

**Net:** the plan's factual premises hold. The two load-bearing ones — `.claude/rules/` path-scoping is real, and the current hooks don't enforce — are both true.

---

## 2. Architecture Review Questions

### Q1 — Is 80–120 lines a reasonable root target? → **AGREE**
Docs put the adherence cliff at ~200 lines; root is at 308 (verified). The four catalogues (apps, env vars, DB tables, doc index) compress to one-line pointers to their canonical sources, which reaches ~100 lines without losing universal rules.

### Q2 — Which root instructions must stay globally loaded? → **MODIFY**
Path-scoped rules fire only when a matching file is *read*, so any rule governing behavior **before a file is touched** cannot be path-scoped and must remain in root:
- probe-before-plan / consult the Atlas
- time-box meta-work (~30 min / 2 commits)
- relevant red CI gates block completion
- falsify-don't-confirm on scope/quantity claims
- destructive-carryover caution
- the `AGENTS.md` symlink invariant
- keys-server-side; identity-from-authenticated-context
- existing DB uses `apply-migrations.js`, never `setup-database.js`

The plan's "Universal Rules To Keep" list mostly captures these but conflates them with *file-specific conventions* (auth-guard details, migration mechanics, A7 wrapping) — those are the correct candidates to move to path rules; the session-wide/planning-time rules above are not.

### Q3 — Will `.claude/rules/` load at the correct time? → **MODIFY**
Yes when a matching file is **read** (the doc's trigger — *read*, not edit/tool-use) **[corrected]**. **No** in two cases:
1. **Creating a brand-new file** — the rule keys on a path that did not exist at plan time, so a "new API route needs matrix coverage" rule may not have loaded when the route is designed.
2. **Planning-time rules** — rules that should govern *before* any file is opened.

So path rules are right for "conventions applied while editing existing matching files," weak for "before you create X" and for cross-cutting planning rules.

### Q4 — Which proposed rules should be skills/hooks instead? → **AGREE**
The "before you create a table/route" obligations (Atlas / manifest / security-matrix) and destructive-carryover verification load too late as path rules. Keep them on the **existing `contract-surface` PreToolUse hook + `/contract-reconcile` skill**, which already fire at write-time and on the trigger verbs. The plan already proposes skills for these — concur.

### Q5 — Which hooks can reliably block/continue? → **MODIFY (two corrections)** **[corrected]**
Verified capabilities (exit-code-2, per §1): `PreToolUse` deny ✔, `UserPromptSubmit` reject ✔, `Stop` block+continue ✔ (with the 8-block override), `PreCompact` block ✔. **Two things that cannot block:** **`PostToolUse`** (tool already ran — advisory only) and **`SessionStart`** (non-blocking — "shows stderr to user only"; the first draft wrongly listed it as block-launch).
Consequences: (a) the plan's proposed *"PostToolUse or Stop verifier"* must be a **`Stop`** verifier (or `PreToolUse`), never `PostToolUse`. (b) A `SessionStart` hook **cannot hard-enforce** the symlink invariant — it can only print a loud warning; the actual guard must be a narrow `PreToolUse` deny on symlink-breaking ops, or an external launcher check outside Claude. (c) The `setup-database.js` `PreToolUse` Bash-deny and the "red gates block completion" `Stop` verifier remain feasible.

### Q6 — Risks in replacing reminder-only hooks with deny/block? → **MODIFY (name the risks)**
1. `Stop` blocking **auto-overrides after 8 consecutive blocks** — a strong nudge, not an absolute gate; don't design as if it were unbypassable.
2. A `Bash` deny on `setup-database.js` needs tight pattern-matching or it over-blocks / is evadable (aliasing, indirect invocation).
3. **Fail-safe, not fail-closed-and-broken:** current hooks fail *open* deliberately. A new blocking hook that *crashes* could wedge the session; it must degrade safely.
4. Over-broad blocking interfering with unrelated work — the plan's own Non-Goal; keep scopes narrow.

### Q7 — Should `/contract-reconcile` be split? → **MODIFY: decide by evaluation, not intuition** **[corrected]**
My first draft asserted "splitting doubles missed-invocation risk" with **no evidence**, and claimed it "auto-fired correctly once invoked" — which is incoherent: this session it was **invoked explicitly** (via the Skill tool), which is *not* auto-firing. Both claims are withdrawn. The honest position: the current unified skill is broad and was, in fact, *not* auto-discovered this session until invoked by hand — so "keep unified" is not self-evidently safer. **Keep it unified initially if desired, but decide split-vs-unified through the plan's Phase 4 regression evaluations** (measure correct activation across trials), not architecture intuition. Independently true regardless of the split: high-risk task prompts should **invoke it explicitly** rather than rely on model-initiated discovery.

### Q8 — Instruction-precedence / conflict risks? → **OBJECT to leaving it implicit (reframed)** **[corrected]**
My first draft proposed a runtime **precedence order** (`hooks > root > path rules > memory`). That's **not how Claude Code works** — the docs do not define root instructions as overriding path rules; unscoped rules load at the **same priority** as `.claude/CLAUDE.md`. There is no documented instruction-precedence ladder to lean on. The correct construct is an **ownership policy**, not a precedence order:

> **One rule, one authoritative home.** Each instruction lives in exactly one surface, chosen by what it governs: planning-time/session-wide rules → root `CLAUDE.md`; file-scoped conventions → the matching path rule; multi-step procedures → a skill; rationale/history → memory (**never** must-follow enforcement — recalled memories are "background context, not instructions"); must-not-skip invariants → a hook/gate.

The only real asymmetry is **enforcement, not instruction priority**: a hook that denies a tool call operationally prevents the action regardless of any prose — but that is an enforcement layer, not a higher-ranked *instruction*. The failure mode to prevent is the same either way: a rule duplicated across two surfaces drifts. Hence one-rule-one-home.

### Q9 — What to test before deleting each root section? → **AGREE + augment (refined)** **[corrected]**
The plan's Phase 4 regression set is good. My first draft proposed a "coverage diff" that treated the **current root catalogue as the completeness baseline** — wrong, because the root catalogues may **already be stale** (the very drift the cleanup targets). Diffing against a stale baseline would just preserve stale content. Instead, validate each **destination against an independent source/gate**, then decide whether each root item is still meaningful:
- apps → `appRegistry.js` is the source of truth (it, not the root table, defines the live set); confirm the gate/registry, don't diff against the root table.
- env vars → `CREDENTIALS_RUNBOOK.md` + `lib/utils/tracked-secrets.js`; reconcile those against live env usage.
- tables → `docs/APPLICATION_STATE_ATLAS.md` + `check:atlas` (which already enforces source↔Atlas coverage).

Probe-before-delete, but probe against the authoritative source, not the artifact being retired.

### Q10 — What behavior becomes less reliable? → **partial OBJECT (sequencing is non-negotiable)**
Anything that relied on a rule being *ambiently in front of the model at all times* weakens when it becomes touch-triggered (path rule) or look-it-up (catalogue → `appRegistry`). The honest risks: planning-time guardrails, cross-cutting rules, and ambient awareness of "which app does what" all get weaker unless hook-backed. **Mitigation is the plan's own Phase 2 sequencing — add enforcement (hooks) before removing prose — and it is non-negotiable: do not delete a guardrail's prose until its hook/gate replacement is verified live.**

---

## 3. Summary scorecard

| Q | Verdict |
|---|---|
| 1 — 80–120 line target | AGREE |
| 2 — what stays global | MODIFY (separate planning-time/session-wide rules from file-specific conventions) |
| 3 — rules load at right time | MODIFY (weak for new-file creation + planning-time) |
| 4 — rules→skills/hooks | AGREE |
| 5 — which hooks block | MODIFY (verifier must be `Stop` not `PostToolUse`; **`SessionStart` cannot block** — symlink guard needs `PreToolUse`/external) |
| 6 — deny/block risks | MODIFY (8-block override; narrow matching; fail-safe; scope) |
| 7 — split `/contract-reconcile` | MODIFY (decide by Phase-4 evaluation, not intuition; invoke explicitly) |
| 8 — precedence | OBJECT → reframed: **ownership policy (one rule, one home)**, not a runtime precedence order |
| 9 — test before deletion | AGREE (validate destinations against authoritative sources/gates, not the stale root) |
| 10 — reliability regression | partial OBJECT (Phase-2-before-Phase-3 sequencing is mandatory) |

No `OBJECT` to the plan's direction overall — the routing model is sound. The objections are to (a) leaving instruction **ownership** undefined, and (b) any ordering that removes prose before enforcement exists.

---

## 4. Recommended first steps (re-scoped after second review) **[corrected]**

The rules Claude actually broke this session — **time-box meta-work, probe-before-plan, falsify-don't-confirm, don't-assert-unverified-state** — are exactly the ones the plan keeps as *prose*, and prose **demonstrably did not hold** today. So the first move is enforcement (plan Phase 2), not file-trimming. But the first draft of this section proposed one over-ambitious hook and two mis-targeted ones; re-scoped:

**Prefer several narrow, deterministic checks over one broad "completion judge."** A `Stop` hook can read the transcript, but "the whole file was reconciled" and "no assumption was presented as fact" are **not reliably provable** without instrumentation, and re-running broad gates at every stop is expensive/disruptive. Split accordingly:

1. **`Stop` — deterministic changed-surface gate check (provable).** On stop, derive changed paths from `git status`; if they touch a gated surface (e.g. `pages/api/**` → `check:api-routes`, `lib/db/**`/`docs/atlas/**` → `check:atlas`), block only if **that specific gate** is red. Bounded, deterministic, scoped to what changed — not a full-suite rerun.
2. **`Stop` or `UserPromptSubmit` — advisory completion checklist (judgment).** The unprovable parts (whole-file reconcile, no-unverified-claim) become a **loud advisory reminder**, not a hard block — because a hook cannot verify them. Honor the 8-consecutive-block override reality regardless.
3. **Symlink invariant — NOT `SessionStart` (it cannot block; §1/Q5).** Use it for a **loud startup diagnostic** only. The actual guard is either a narrow `PreToolUse` Bash-deny on `rm`/`ln` against `AGENTS.md`/`.agents/skills`, or an **external launcher check** outside Claude (which also protects humans/CI/other agents).
4. **`setup-database.js` protection — reconcile the source first; don't lead with a Claude hook.** The script **contradicts itself**: its header (`scripts/setup-database.js:12`) says *"backwards-compatible … can be run on existing databases … without losing data,"* while the inline block (`~:600`) says *"the script's contract is 'fresh install only.'"* Fix that contradiction in the source before enforcing anything. And the strongest protection belongs **inside the script** (a guard/refusal when pointed at a populated DB) — a Claude `PreToolUse` deny protects only Claude, not humans, CI, or other agents.

**Sequencing (non-negotiable):** add and verify enforcement before deleting the corresponding prose (plan Phase 2 → Phase 3). And per Q7, gate the `/contract-reconcile` split decision on Phase-4 evaluations, not intuition.
