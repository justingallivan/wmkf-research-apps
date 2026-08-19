# Institution affiliation compatibility benchmark

This directory is the Stage 1 shadow evaluation for the source-aware
relationship and conditional-neutrality contract in
`docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`.

It is deliberately separate from `institution-pair-consistency`, which remains
the frozen regression suite for the shipped boolean comparator.

## v1 contents

- `v1/cases/source-aware-25.json` — 25 relationship/action adjudications written
  before the classifier replay. It includes the three challenged production
  cases, explicit source/currentness fields, a non-affiliation identity-policy
  input, old labels where available, and separate relationship/action labels.
- `v1/capture-ror-snapshot.js` — read-only live ROR capture. Explicitly
  adjudicated internal subunits are overlaid instead of weakening the ROR
  resolver or inventing a ROR entity for a school/institute that ROR does not
  represent separately.
- `v1/provider-snapshots/ror-2026-08-19d.json` — normalized provider snapshot;
  the live capture recorded zero provider failures.
- `v1/run-shadow-evaluation.js` — deterministic offline runner.
- `v1/results/source-aware-25-shadow-2026-08-19c.{json,md}` — readable and
  machine-readable before/after artifact.

The artifact's `GO_FOR_SHADOW_CONTRACT` verdict authorizes only continued
shadow evaluation. It does not authorize card behavior, candidate
selectability, identity weighting, or automated writes. The benchmark's
independent-identity value is an explicit policy input; current production
roster state does not yet retain that non-affiliation calculation reliably
enough for Stage 3 authority.

Re-run the deterministic offline gate assertions with:

```sh
npx jest tests/unit/benchmarks/institution-affiliation-shadow-v1.test.js --runTestsByPath
```

The artifact runner and live capture both refuse to overwrite a frozen output.
Use a new versioned filename for another adjudication or provider observation.
