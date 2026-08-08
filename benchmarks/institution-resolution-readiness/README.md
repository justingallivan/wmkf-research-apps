# Institution-resolution readiness harness

This directory is the public, deterministic boundary for the institution-resolution offline evaluation described in `docs/INSTITUTION_RESOLUTION_OFFLINE_EVALUATION_PLAN.md`.

## Current scope

Phase 1 currently provides:

- versioned, fail-closed case, cassette, and result contracts in `schema.js`;
- a publication-boundary validator that rejects direct identifiers, credentials, completed-cycle linkage, person-level evidence URLs, and unrecognized fields;
- a Git tracked-file guard that can also be pointed at the owner-selected private workspace when that location is approved;
- synthetic and public-registry cases containing institution-only inputs; and
- unit coverage that runs without network access, provider credentials, Postgres, Dataverse, or Blob writes.

The completed-cycle corpus is not here. Its storage/access/backup/retention owners and adjudicators remain owner decisions. Until those decisions are recorded, extraction must not run and no private path should be inferred from this directory structure.

## Public/private boundary

The repository may contain schemas, validators, institution-only synthetic/public-registry fixtures, manifest hashes, and approved aggregate summaries. It must not contain completed-cycle inputs or frequency distributions, reviewer names or email addresses, ORCIDs, proposal/request identifiers, candidate/contact/suggestion keys, raw production record IDs, private cassettes, private case IDs, or per-case private results.

Organization evidence is limited to canonical ROR URLs and explicitly allowlisted institutional root/about pages. Faculty, staff, directory, researcher, profile, and other person-level URLs are rejected.

`production_shape` cases contain only the affiliation string available to the production resolver. Country/domain-assisted cases are labeled `capability_only` and cannot be used to claim production-path readiness.

## Commands

```bash
node benchmarks/institution-resolution-readiness/validate-cases.js
node benchmarks/institution-resolution-readiness/validate-public-assets.js
node benchmarks/institution-resolution-readiness/check-tracked-artifacts.js
npx jest tests/unit/benchmarks/institution-resolution-readiness.test.js --runInBand
```

After an owner selects a private working path, pass its repository-relative form to the guard. The argument is intentionally not preselected here:

```bash
node benchmarks/institution-resolution-readiness/check-tracked-artifacts.js --private-root=<owner-approved-private-path>
```

The validators read tracked local files only. They do not call ROR/OpenAlex and do not write to application storage.
