# Expertise roster plan — second Claude Opus 5.5 review

November 19, 2026. Read-only, owner-requested OAuth review; no build.

- Reviewed HEAD: `f22eec938`.
- Reviewed plan SHA-256: `f057aa1c13e234efe6aa4021e91b2dc2ed161c20737b8eb0625201b792cc7c82`.
- Requested/returned model: `claude-opus-5-5`; CLI success, no permission denials.
- Host `claude auth status`: logged in via `claude.ai`. API-key/provider overrides
  removed; no Ultrareview or other model calls.
- Line numbers in the verbatim report refer to the reviewed draft.

## Disposition

Opus returned **READY WITH CHANGES**: all first-round findings closed, two new
required clarifications. Codex verified both against the parked branch source and
incorporated them in the plan, without changing application code:

1. **F1 accepted:** the import planner currently uses mapping Contact IDs and merely
   warns on differences. Plan now requires the source Contact GUID/null directly,
   blocks conflicting mappings and linked exclusions in dry run before writes.
2. **F2 accepted:** importer and shared contract currently forbid Staff Contact links.
   Plan now explicitly removes that restriction, permits Contact + User references
   for Staff, and requires tests of linked Consultant-to-Staff transitions.

Optional observations incorporated: duplicate-link check includes inactive rows;
re-import retains dataset identity or reconciles retained records; marker text points
to Admin; exact GUID means canonical lowercase; plan review status updated.
The reviewer considers the plan ready once F1/F2 are in its text. This disposition
records their incorporation, not a third reviewer signoff or production readiness.

## Verbatim reviewer output

# Second adversarial review: Expertise roster production migration plan

**Model:** Claude Opus 5.5 (`claude-opus-5-5`), ordinary Claude Code session. This was read-only. I used Read/Grep/Glob, `git show` on the parked branch, and `shasum`. I confirmed HEAD is `f22eec938` and the plan SHA-256 is `f057aa1c…7c82`. I made no edits, ran no tests, made no live or production calls, and did not call the advisor or any other model.

## Verdict: READY WITH CHANGES

None of my findings blocks the overall approach. Every earlier R1–R6 and smaller finding is closed in the plan text. Two required corrections remain, and both come from the new rule that Contact GUIDs must be preserved exactly. The parked code the plan says to reuse does the opposite in two places. The fix is a few lines of plan text that name the changes. No new machinery is needed.

## Closure of prior findings

| Prior finding | Where the plan closes it | Status |
|---|---|---|
| R1: editor behavior by mode, recovery editor | §1 L26–32; §4 step 3 L165–167 (import freezes legacy writes) | Closed |
| R2: rollback keeps owner overrides; order | §5 L217–229: full comparison of every affected ID → restore FK → switch to Postgres → clear bindings and marker last | Closed |
| R3: single-match DAL context | §3 L128–131: named `withDalContext` change plus a test using the real context. Source confirms the bare SQL read at `match.js:81` | Closed |
| R4: overrides change saved attendee identities | §4 step 1 L146–150; acceptance L198–202 says "except the documented owner overrides" | Closed |
| R5: migration order and dotenv in the runner | §4 step 2 L156–161 and step 5 L173–175. Runner confirmed: cwd `.env`/`.env.local` at `apply-migrations.js:32-46`, applies everything pending (L118–131). Main skips 099→101, so 100 is free, but the plan correctly says to check | Closed |
| R6: Connor's connection read-only | §3 L97–100; acceptance L205–206 | Closed |
| Outage vs. excluded author | L131–133, including the briefing's `unavailable` path | Closed |
| Who edits are attributed to; existing maintainers | L111–115 | Closed |
| Old GET exposes Admin data | L26–28 (409 in Dataverse mode) | Closed |
| Contact uniqueness | L68–71 | Closed (but see F2 below) |
| Lead eligibility vs. current matcher | L86–89 | Closed |
| Comparing source against the export | L171 | Closed |
| Bridge called "existing" | L75–76 "not yet on main" | Closed |
| Rehearsal/replay reuse | L137–139 | Closed |
| ID 35 on the shared board briefing | L147, L171 | Closed |

## Required findings

### F1: The reused importer deliberately does not copy the source Contact GUID, and a mismatch is only a warning

- **Evidence (parked branch):** `scripts/lib/expertise-roster-import-plan.cjs`
  - Line 86 takes `contact` only from the per-target mapping (`m.contactGuid`).
  - Line 105 handles a different source GUID with only a warning: `'source Contact link differs: retain approved per-target mapping; do not copy source GUID'`.
  - That rule made sense for the sandbox. `OWNER_MAPPING_DECISIONS_2026-11-09.md:41` records approved null Contact links for IDs 9, 10, 24, 30 and 39 there.
- **Conflict:** plan L58–63 says to copy every existing `dataverse_contact_id` exactly. L65–66 says to reuse "useful importer/adapter pieces after checking them against current main", which doesn't flag this behavior.
- **Scenario:**
  1. A production mapping has a null or wrong `contactGuid` (for example, built from the sandbox template).
  2. The import writes the profile without the link, and the dry run is not blocked.
  3. The source-based check (L189) only catches it after records exist in production.
  4. The fix is then an Admin edit, which counts as a link change. `roster-service.js:18` refuses it if that Contact is now inactive ("Choose an active Contact"). So the exact link can't be restored through the editor.
- **Minimum correction:** add one sentence to §3 Data and identities. The importer takes `wmkf_contactguid` directly from the source row's `dataverse_contact_id`. The mapping may not override or null it. Any difference, or a linked row marked for exclusion, is a **blocking** dry-run error, not a warning.

### F2: The reused category/link rule forces a Contact to be cleared on a category change, which the plan forbids

- **Evidence (parked branch):**
  - `roster-contract.cjs:18` refuses a Research Program Staff profile that has a Contact: "Clear the incompatible person link when changing category."
  - `expertise-roster-import-plan.cjs:92` asserts `staff ? contact === null : …` ("category/link mismatch").
  - Main has no such rule. `pages/api/expertise-finder/roster.js` only checks GUID format and uniqueness among active rows.
- **Conflict:** plan L60–61 says do not "clear the link during category changes". The owner override moves ID 1 (John E. Sader) from Consultant to Research Program Staff. The Nov 18 inventory shows 6 linked Consultants and doesn't say whether John is one of them.
- **Scenario:**
  - If ID 1 has a Contact link, the import blocks. Getting past it means dropping the link, which breaks the exact-preservation rule.
  - In the Admin editor, moving any linked Board member or Consultant to Staff is refused until the admin clears the Contact. The plan says that must never be required.
- **Minimum correction:** state that the Staff ⇒ no-Contact rule is not carried over, in either the contract or the importer. A Staff profile keeps an existing Contact reference. This is harmless because the recipient directory only reads Board and Consultant rows (`recipient-directory-service.js:31`). Also add "ID 1 Contact link status" to the step 1 execution-time recheck.

The other alternative is to keep the rule and get an explicit owner decision for ID 1. That would narrow the owner's stated requirement, so I don't recommend it.

## Optional observations (not blocking)

- **Inactive rows sharing a Contact:** in Postgres, inactive rows don't reserve a Contact (`050_expertise_roster_contact_link.sql:11-14`). The Dataverse key reserves it across all profiles. An inactive row and an active row sharing a Contact can't both be preserved exactly. The Nov 18 inventory had every row active and 0 duplicate groups, and L62–63 ("report any … conflicting link") already makes this surface. Just make sure the step 1 recheck counts duplicates across inactive rows too.
- **Retrying after a rollback:** Dataverse records kept "for diagnosis" (L229) still reserve their Contact and User keys. A later re-import with a new export dataset ID gets new creation keys, so it would block at `import-plan.cjs:117`. It fails loudly rather than corrupting anything. One line in the runbook would do: reuse the original dataset ID, or resolve the retained records first.
- **Stale message:** the parked marker text at `roster-cutover-marker.cjs:10` says "Edit it in Expertise Finder". It should point to Admin.
- **What "exact" means:** Postgres stores the column as `UUID`, so values come out as lowercase canonical strings, which is what the importer requires. Saying "exact = the same lowercase canonical GUID" would remove any doubt.
- **Status line:** plan L3 still says "has not had a second review"; update it once this review is recorded.

## Readiness

Once F1 and F2 are in the text, I consider the plan ready to implement. That doesn't mean ready for production execution: production table metadata, keys, permissions, row counts, ID 1's Contact status and the migration ledger are still execution-time checks, as the plan says. I didn't verify anything live.
