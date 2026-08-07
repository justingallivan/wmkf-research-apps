# Compact ROR index size experiment

This is a measurement-only experiment for the institution-resolution roadmap.
It answers whether a high-recall candidate-retrieval substrate can be materially
smaller and cheaper to load than the raw ROR dump. It does **not** choose an
institution, implement vetoes or scoring, alter the frozen fuzzy-matching
benchmark, or wire an asset into production.

Exact aliases and every other posting are retrieval evidence only. A future
resolver must still apply the non-overridable multi-organization, sibling,
domain, country, type, and granularity vetoes before provenance-aware scoring
and abstention.

## Pinned source

The tracked `release-manifest.json` pins the immutable ROR v2.11 release:

- publication date: 2026-08-03;
- schema: 2.1;
- version DOI: [10.5281/zenodo.21773148](https://doi.org/10.5281/zenodo.21773148);
- source ZIP: 35,648,847 bytes;
- source checksum: `md5:8bfb0dc82affb46f331899a7341d34f3`;
- source JSON: 304,865,777 bytes and 135,710 records;
- source JSON SHA-256:
  `5984c0455f5af6dd9af69e8ad5df3220d28ee0804b67a4d987ef98f079ce1daa`.

The release is discovered through ROR's [official data-dump
instructions](https://ror.readme.io/docs/data-dump) and downloaded from its
[official Zenodo record](https://zenodo.org/records/21773148). The source data
is CC0; ROR location data carries the GeoNames attribution described by the
release record.

## Measured index shape

The experiment keeps all records and preserves status so it does not silently
establish an active/inactive resolution policy. Each compact candidate retains:

- short ROR id and status;
- organization types;
- names, name-type provenance, and language;
- official ROR domains;
- GeoNames id, country, subdivision, and locality;
- typed ROR relationships.

It adds four deterministic posting lists for candidate-union retrieval:

1. normalized exact names;
2. domains;
3. normalized name tokens; and
4. normalized name character trigrams.

The index deliberately omits external ids, free-text relationship labels,
website links, coordinates, establishment dates, and administrative timestamps.
Those omissions are part of this size hypothesis, not a production schema
decision.

## Reproduce

Requirements: the repository's Node.js runtime, network access, and `unzip`.
From the repository root:

```bash
node benchmarks/compact-ror-index/run-experiment.js
```

The script downloads only the pinned version-specific Zenodo file, sends an
explicit user agent, uses bounded timeout/retry handling for transient failures,
verifies ZIP byte size and MD5, extracts the pinned JSON
member, verifies its byte size and SHA-256 on every input path, builds the index,
compresses it with gzip and Brotli quality 6,
and runs each load probe in a fresh Node process. It applies the same gzip and
Brotli settings to the raw JSON so compressed-size comparisons are
apples-to-apples; the official ZIP also contains a CSV and is not that baseline.

To reuse an already verified/extracted JSON file:

```bash
node benchmarks/compact-ror-index/run-experiment.js \
  --source-json /absolute/path/v2.11-2026-08-03-ror-data.json
```

Downloaded and generated artifacts go to the ignored `.data/` directory by
default. They must not be committed. `measurement.json` records source and
generated SHA-256 checksums, source and artifact bytes, component sizes,
key/posting cardinalities, build timings,
fresh-process read/decompression/parse timings, retained memory deltas, and
maximum RSS. The load probe records immediate post-parse process memory, then
releases input/decompression buffers, forces GC, and records parsed-only heap,
external, ArrayBuffer, and process RSS. RSS may remain resident after buffers
are released, so it is not labeled live-object memory. Machine-specific timings
and memory are evidence for this run only; a fresh process does not imply a cold
operating-system disk cache.
