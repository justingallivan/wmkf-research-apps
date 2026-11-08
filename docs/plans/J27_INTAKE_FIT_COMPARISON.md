---
title: J27 intake fit comparison
domain: workbench
kind: plan
status: active
summary: Pair the independent ternary fit screen with P6 at intake while preserving their results and separating staff decisions.
---

# J27 intake fit comparison

## Decision

Keep both screens independent. Compare them on the same version of the intake
materials. Retain the ternary Fit Assessment and Fit Rationale on the request
and preserve their intake values in the comparison even if those fields later
change. P6 contributes six labeled concerns with its reasons and evidence.
Gray means missing evidence and counts separately from green.

## Implemented on the branch

- The governed `j27.fit-concerns.generate` prompt returns advisory concerns for
  Intake. The caller supplies Keck abstracts. Each award record has a title and
  year on its first line, then its abstract. Separate records with a blank
  line. Missing Keck abstracts or Other Support produce gray for the relevant
  concern. The P2 hint is optional and can point to proposal evidence.
- The trusted `recordJ27IntakeFitComparison` entry point takes a request GUID,
  a stable `materialsVersion`, a matching ternary receipt containing
  `materialsVersion`, `assessment`, `rationale` and `runId`, and the P6 inputs.
  The receipt must come from the independent intake run. The service checks
  the receipt against the request's current ternary fields, validates the six
  flags and their quotes, and conditionally saves a single versioned JSON
  snapshot to `wmkf_j27intakefitcomparison`. A repeat of the same pair reuses
  the saved snapshot. A concurrent update rejects the conditional save.
- The staff Workbench Proposal tab reads the snapshot and shows Overall Fit
  beside Six Fit Concerns. A missing comparison column leaves the current
  Overall Fit visible. Public reviewer and chair packet paths do not consume
  the snapshot.

## Sandbox handoff

- **Connor:** Confirm the deployed ternary flow, the run identifier it can
  return, and the common intake materials version. Apply the additive
  `wave37-j27-intake-fit-comparison` schema in sandbox, verify its permissions
  and flow triggers, and coordinate a trusted invocation path for the
  comparison service. Publish P6 through the governed seed after schema and
  input readback. No Power Automate caller is connected yet.
- **Justin:** Verify that the staff Workbench displays the captured ternary
  assessment and all six concerns, that missing sources show Cannot assess,
  and that review evidence stays out of chair and applicant surfaces. Keep
  PD-confirmed concerns, comments, and any staff overall-fit judgment separate
  from both AI outputs. That staff decision capture remains to be wired.
- **Rehearsal:** Use synthetic complete, missing-Other-Support, and known-Keck-
  overlap packets. Compare which material concerns each screen surfaces,
  misses, or raises without evidence. The paired Intake run has not yet been
  rehearsed with the actual flow and Dataverse.

First Cut P6 and any matched First Cut ternary run are later work. Preserve
the Intake snapshot when those stages are added.
