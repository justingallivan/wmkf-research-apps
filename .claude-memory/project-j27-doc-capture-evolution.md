---
name: J27 document capture & Proposal-tab evolution
description: The D26 Proposal tab displays its Phase I bridge plus files from Phase II; writeups use the exact narrative PDF, while the bibliography is reserved for next-cycle Reviewer Finder.
type: project
status: active
scope: strategy
last_verified: 2026-08-30 via Production-deployed Initial Assessment controls, signed-in read smoke, and prior production evidence
---

## Recall Rule

Read this when: building/maintaining the **Request Workbench → Proposal tab** document section, writing any SharePoint document-resolution for a request, planning **J27** document collection, or considering changes to the reviewer **hold step**. Pairs with [[project-grant-phasing-evolution]] (the phasing mechanics — single-submission, "Phase II" = status flip). Every J27-sensitive site (retire / persist / change / build / scale) is registered in `docs/J27_TRANSITION_REGISTER.md`; add new sites there rather than here.

**2026-07-28 clarification (supersedes the older shorthand
“doc-resident knowledge onto Dataverse tables”):** the converging direction is
to move document **identity, type, relationships, workflow state, and structured
decisions** into a typed Dataverse registry. SharePoint Word remains the
canonical editable narrative and Microsoft Search supplies body search. Do not
copy the co-edited Word body into a second editable Dataverse memo.

## The decision picture (S258, Justin + Connor)

**D26 Proposal-tab document display is an INTERIM BRIDGE — do not treat it as
permanent.** The Proposal tab lists the request's SharePoint **`Phase I`
subfolder** and matches the cycle filenames `ProjectDescription.pdf`,
`Biosketches.pdf`, `ProjectBudget.pdf`, and
`Project Budget spreadsheet.xlsx`; `Application Cover Page.docx` is excluded
because its content comes from the Dataverse-derived top panel. It also lists
every file found beneath the request's **`Phase II` subfolder** in a separate
Phase II Documents section; those entries use their SharePoint filenames rather
than the D26 Phase I slot map.

**Governed proposal analysis has a separate internal input as of 2026-08-16.**
Initial Assessment and Workbench Field Primer request mode require the exact
active `AI Materials/ProposalNarrative_{Request#}.pdf` file. They do not use the
outbound reviewer package, Proposal-tab `ProjectDescription.pdf` bridge, a raw
Phase I export, an archive match, or a best-guess classifier. Missing or
ambiguous exact input fails before model/result writes. Request `1002788` is
the live read-only resolver/extraction example; its earlier generated artifact
still proves mechanics only because that run used an old Phase I document.
Reviewer Finder is a separate staff discovery surface: its current-cycle
default prefers the exact outbound reviewer package and falls back only to exactly one active
`Phase I/ProjectDescription.pdf`; neither or ambiguity returns a server-listed
picker before download/Blob write. The fallback does not alter the governed or
external-reviewer contracts.

Power Automate publishes two separate exact files:
`AI Materials/ProposalNarrative_{Request#}.pdf` and
`AI Materials/ProposalBibliography_{Request#}.pdf`. Pre-Site, Initial
Assessment, and Field Primer use and fingerprint only the exact narrative.
The bibliography remains separate for the next-cycle Reviewer Finder, which
will label and fingerprint both sources so cited authors can inform discovery.
Its current-cycle resolver remains unchanged.
**Owner 2026-09-09 (register J27-082):** D26 pre-site drafts are being generated for every advancing request by an owner-run script that depends on this exact path; in J27 the source file name and location *may* change, so the J27 planning must settle the source contract before designing the next-cycle auto-generation trigger (which will not be a script).

**Filename-match is FRAGILE — but do NOT assert it "will break in J27."** (Corrected S265, Justin: the earlier "J27 will use new naming conventions / a different collection mechanism, so filename-match WILL break" claim was **unsubstantiated** — Connor pushed back on dropping filename-reconciliation on that premise. There is **no evidence** J27 changes naming; filename-match only breaks **if the names actually change**, which isn't established.) The real, durable case for moving OFF filename-match is **fragility + Dataverse legibility**, NOT a J27-will-break prediction: it depends on PDs naming files consistently/correctly, with **no structured fallback** when they don't. **Strongest argument:** if we **auto-generate writeups** in a future cycle, there is **nowhere structured to store them that the apps can read back** — a filename heuristic can't anchor a machine-produced doc that a PD may never (re)name correctly. Keep the D26 name→label map in one small per-cycle config; never hard-code D26 names as permanent (consistent with [[project-grant-phasing-evolution]]).

**Initial Assessment pilot record (2026-07-29 → 2026-08-30) and the retired reviewer hold step** moved verbatim to [[project-j27-doc-capture-history]] (closed) on 2026-09-17. Live invariants to keep: documents are registered on the typed `wmkf_requestdocument` table and pointed at directly, never filename-joined; governed Word identity is the normalized-parts hash, never whole-package bytes; the restore and first-snapshot writes remain unexercised and need explicit owner authorization (deferred 2026-08-30 to a pre-J27-scale checkpoint); the Dataverse sandbox is not a test environment for this work.

## Sequencing / urgency (user, S258)

**Initial Assessments are hidden in the UI for D26 (owner decision 2026-09-05, S489; reconfirmed
2026-09-09 after a same-day unhide/re-hide).** The cycle-wide "Initial assessments" view (formerly
`/workbench/artifacts`) and its `WorkbenchViewsNav` entry show a "not part of the D26 dual-phase
workflow / available for J27" card for `cycleCode === 'D26'` (Codex PR #151, `3fc0a936`). Justin: the
D26 pilot proved the plumbing; for D26 the list holds only pilot rows. **Lesson 2026-09-09:** when the
owner asked for "the pre-site draft section" back, PR #213 unhid this view — the wrong artifact. The
drafts staff actually use are **Pre Site Visit** artifacts (per-request tab renamed to Staff
Deliberations in S466), which had never had a cycle-wide list. They now have one: the **Staff
deliberations** view between Reviewer follow-up and Final writeups
(`lib/services/pre-site-visit/cycle-list-service.js`, `/api/workbench/staff-deliberations`). Do not
treat the D26 hide as a regression. In J27 Initial Assessment becomes a real feature (every complete
single-submission proposal gets one before advancement) and precedes reviewer identification, so the
view moves left of Request list then and a Find reviewers view surfaces alongside it — plan that
reorder as J27 product work.

J27 design is a **large planning effort with many moving parts** that must **start soon after the bulk of the D26 Workbench work lands** — treat it as the next major planning push, not a someday item. J27 specifics (exactly what is collected up front, timing, final table shape) are **not yet decided** — re-confirm with Justin/Connor before building.

Ground truth: [VERIFIED 2026-08-01 via
`shared/config/workbenchProposalDocuments.js`,
`lib/external/reviewer-materials.js`,
`lib/services/workbench-proposal-documents.js`,
`lib/services/reviewer-finder/load-proposal-service.js`, and
`docs/CURRENT_WORK_QUEUE.md`, production Wave 16 readback, prompt verification,
deployment inspection, the Request `1002788` mechanics rehearsal, and the
signed-in Request `1003109` generation/retry/recovery plus live lineage probes,
and focused Reviewer Finder proposal-resolver tests].
The typed registry is live and exercised; broader J27 applicant-capture
producers and the partial-pilot blockers remain open.
