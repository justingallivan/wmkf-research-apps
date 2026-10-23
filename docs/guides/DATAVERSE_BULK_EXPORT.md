# Dataverse Bulk Export Guide

Build a plain-English filter over the grant request store and download a large, honestly-characterized Excel extract — with the real total count (never the misleading 5,000 cap) and a baked-in Methods sheet that records exactly how the slice was produced.

## Overview

Dataverse Bulk Export is a structured filter builder, not a chatbot. You choose business-vocabulary filters, see the **true count and composition before you run**, then download an Excel file. It is built for the broad pull that other tools quietly under-deliver: the count you see is the real FetchXML aggregate, and if a result is too large to return in full, the truncation is shown loudly — never as a quiet footnote.

This tool is admin-assigned (it is not granted to everyone by default). If you do not see it in the navigation, ask an administrator to grant the **Dataverse Bulk Export** app.

## Getting Started

1. Open **Dataverse Bulk Export** from the navigation
2. Make the **Scope** choices (these are deliberate, not hidden defaults)
3. Add one or more **Filters**
4. Click **Preview** to see the true count and composition
5. Review the preview, then **Confirm & run export**
6. Download the Excel file when the run reports *ready*

## Scope — explicit choices

Every scope control changes what the export contains, so you choose each one deliberately and the Methods sheet records what was applied.

- **Era scope** — *record-creation provenance, not a business period.* "Migrated" = records carried over from the prior Blackbaud/Sky system; "Native" = records born in AkoyaGO. Leave it on **All eras** unless you specifically want one provenance bucket. Slicing a business time period is done with the **Decision date** filter, never this control.
- **Exclude operational rows** (default on) — removes site/office visits, phone interactions, and research-reviewer honoraria. Uncheck only if you want interaction logs / honoraria in the result.
- **Exclude test records** (default on) — removes native-era rows whose applicant is the Foundation itself (test clones). Included with disclosure if unchecked.
- **Program roll-up (Option B)** — a program total counts `type = Program` rows only; Special Projects/Grants are reported as separate lines.
- **Default column set** — the standard column contract with per-row sentinels, era, and resolved-institution columns.

## Filters

Each filter row is a business field, an operator, and a value. All filter rows are combined with **AND**. With no filters the export is *every* request row — the true total will be large and the run will truncate loudly.

| Field | Use it for |
|---|---|
| **Program** | The canonical program taxonomy (the default program axis) |
| **Funding category** | A separate coarse funding/payment axis — never the same as Program |
| **Type** | Grant / concept / operational polymorphism |
| **Request type** | The request-type picklist (Office Visit / Phone / Grant / …) |
| **Status** | The live request-status taxonomy |
| **Decision date** | Business history — *the* time-slice control (on or after / on or before / between) |
| **Amount** | Requires an explicit which-amount choice: Awarded, Requested, Total project, Recommended, or Invited — there is no bare "budget" |
| **Institution** | Applicant / payee account name |

Operators are constrained to what each field supports (for example, *is empty* / *has a value* for taxonomy fields, *between* for dates and amounts).

## The Preview — read it before you run

Preview computes the **real total** via a FetchXML aggregate count. This is the number that other tools get wrong: OData `/$count` silently caps at 5,000, so a "~5,000" answer is often a massive undercount. The preview shows:

- **True total** — the real count, prominently
- **Era composition** — migrated vs. native split (and a loud flag if they fail to reconcile)
- **Taxonomy warnings** — any filter value not in the current live taxonomy (it will match 0 rows unless newly added)
- **What will be applied** — every rule in plain English (the same text that goes into the Methods sheet)
- **Compiled FetchXML** — available for inspection
- A **size note** — if the total exceeds the 50,000-row hard cap, the note warns the run will be truncated

Editing any filter or scope choice after a preview **invalidates it** — you will be asked to preview again. The run can only ever execute a spec you have actually seen previewed.

## Running and downloading

After **Confirm & run export**, the run streams progress (counting → paging). It ends in one of three states:

- **Ready** — the Excel file is built and a **Download Excel** button appears. The link is authenticated and short-lived (~1 hour); re-run for a fresh link.
- **Truncated** — the result hit the 50,000-row cap or the time budget. You will see a loud banner with the true total vs. how many rows were written, and a prompt to narrow by program / year / status / institution. The truncated file is still produced and is clearly labelled as truncated in its Methods sheet.
- **Failed** — no usable download is returned. The run route writes the private Blob object before minting the short-lived download token, so a token-mint failure can leave an object without a usable download. The token TTL does not establish Blob-object retention, and no cleanup schedule is claimed here. A failure can never present as a short-but-complete file.

## The Methods / Provenance sheet

Every export carries a second sheet that makes the slice reproducible: the era cutover date, every applied rule in plain English, the per-row sentinel legend, the composition line, the program roll-up in/out line, the decline-reason handling, the exclusions applied, the institution-clustering caveat, and the true total vs. returned (truncation) figures. If a value could not be classified, it is preserved raw and flagged — never silently dropped or guessed.

## Tips

- **Always read the preview.** The whole point of this tool is that you see the honest count and composition before committing to a run.
- **Narrow before you re-run a truncated result.** Add a program, a decision-date range, a status, or an institution — a truncated file is not a complete export.
- **Use the Decision date filter for time periods**, not Era scope. Era is provenance; the decision date is business history.
- **A 0-row taxonomy warning is real** — it means the filter value is not in the current taxonomy, so the result will be empty unless that value was just added.

## Limitations

- Hard cap of 50,000 rows and a ~4-minute paging budget per run; beyond either the result is truncated (loudly) — narrow the filter for a complete set
- Deterministic institution clustering only (exact normalized-key match); fuzzy/learned entity resolution is a future enhancement
- Document-resident decline rationale is surfaced as a link, not extracted text
- The live taxonomy is read at request time — if Dataverse is unreachable the builder refuses to load rather than show a stale list
