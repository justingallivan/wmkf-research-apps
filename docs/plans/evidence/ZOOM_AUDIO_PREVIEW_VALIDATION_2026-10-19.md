---
title: Zoom audio synthetic Preview Blob validation
domain: meeting-tracker
kind: audit
status: active
summary: "Real private Blob roundtrips and deployed inspection passed on Node 22 Preview, including near-cap concurrency and corruption. No provider call or job created."
owner: product-engineering
---

# Preview acceptance: synthetic audio and real Blob

[VERIFIED via hosted HTTP responses, Vercel deployment/project readback and Blob SDK]
[PR #513](https://github.com/justingallivan/wmkf-research-apps/pull/513) was tested on
Preview deployment `dpl_BoK3vfgYgNtgEevSPJ3yM4h7dP7S`, source
`5b534b8ecb5752640c6478c80e077d5ba0b4f584`, at
[the immutable Preview](https://wmkfresearchapps-ou7vrcc7c-justin-gallivans-projects.vercel.app).
Runtime was Node **22.23.2**, region **iad1**. The project uses Fluid Compute and
its default memory tier is `standard`; Vercel documents that tier as
[2 GB / 1 vCPU](https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute).
[Raw response evidence](ZOOM_AUDIO_PREVIEW_RESULTS_2026-10-19.json) includes exact
byte counts, hashes, timings and memory observations. This is Preview evidence,
not a Production deployment or a real-provider acceptance test.

## Actual execution

A private, disposable store `store_8bc1I10beREdykxv` was created exclusively for
this test. The branch's uploads token pointed only at that store. Both provider
submission switches were explicitly false, the provider key was absent, and
Meeting Tracker transcription access was off. Branch database URLs were fenced
to a disabled localhost endpoint rather than the shared application database.
The temporary prefixed store connection was removed after obtaining the test
credential; remaining runtime variables were scoped to this branch only.

The optional `audio_blob_probe` mode on the existing transcription cron endpoint
requires the strict cron bearer, Preview environment, explicit opt-in, matching
store-token identity, disabled switches and no provider key. It accepts only four
fixed scenarios; callers supply no pathname, URL, audio or byte size. Unauthorized
access returned **401**. The mode returns 404 outside its configured Preview
scope and is not registered as a scheduled cron.

The deployed probe generates repository AAC with inert free-box padding before
its late M4A metadata. The actual decoded audio is about **3.065 seconds**; this
is a byte-size/container stress fixture, not a 199 MiB recording of real speech.
It calls the unchanged real Blob SDK write through `writePrivateContent`, clears
its input reference, verifies real response length/encoding headers, then calls
production `inspectOwnerInput` for bounded read, full hash validation and the
bundled worker parser. No reader, Blob storage or inspector mock was used.

| Scenario | Actual bytes | Result | Elapsed | Sampled peak RSS | Process lifetime peak RSS |
|---|---:|---|---:|---:|---:|
| Small | 1,048,576 | Header/hash/parser accepted | 1.085 s | 123.0 MiB | 123.0 MiB |
| Near cap | 208,666,624 (199 MiB) | Header/hash/parser accepted | 10.684 s | 903.2 MiB | 1,102.2 MiB |
| Two concurrent near-cap operations in one Function | 2 × 208,666,624 | Both accepted | 16.893 s | 1,699.2 MiB | 1,898.0 MiB |
| Corrupt final byte | 1,048,576 | `audio_integrity_mismatch` before parser acceptance | 0.467 s | 513.5 MiB | 1,898.0 MiB |

Every response reported exact-path deletion and subsequent absence. The corrupt
case required the specific integrity error, not just any failure. No provider
submission or transcription-job creation is reachable in this probe. Cold-start
migration/alert modules attempted their ordinary database initialization checks;
the intentionally invalid Preview connection configuration rejected these before
any shared database connection. No live database write or job was created.

The concurrency case uses two simultaneous operations within one Function process,
not two independently scheduled HTTP invocations. Lifetime peak RSS persists in
warm instances, so the corrupt case's 1,898 MiB value is inherited from the earlier
concurrent run; it is not memory growth caused by the 1 MiB corrupt file. Samples
are a single run per scenario and are not a capacity guarantee. Two near-cap
operations approached the standard tier's memory ceiling. No limit, admission
policy or memory-tier increase was made. This does not prove production OOM was
occurring or that sustained/higher concurrency is safe.

## Cleanup and CI

A real SDK listing confirmed **zero blobs and no remaining page** in the disposable
store after all four probes. The store was then deleted; Vercel returned **404**
on readback. The broad temporary store connection was already removed, and the
probe was set to off for future branch deployments. Temporary branch uploads
credentials, cron secret and store-id configuration were removed. Old immutable
Preview credentials can no longer write because the store has been deleted.
The branch keeps its disabled submission/database fences; Production settings
were untouched.

Probe tests cover unsafe environment complements, secret authentication, unknown
scenarios/query modes, corruption, ambiguous writes, exact-path deletion failure,
and refusal to overwrite/delete a pre-existing path: **24 tests across three
suites passed**. Build, types, scoped lint and route/deployment gates passed. A
fresh source review found the cleanup recovery-target gap; paths are now logged
before PUT and on every failed cleanup. CI's fake-token false positive was fixed
by constructing the dummy value and ignoring only its exact historical fingerprint,
consistent with existing fixture exceptions. Real-secret rules remain enabled.

The tested runtime is unchanged by subsequent fixture/secret-scan and evidence
commits. CI must be green on the final PR head before merge; its live status is
reported on the PR. No merge or Production promotion was performed.

## Practical limits

This proves the real SDK/store, deployed header-gated reader, full integrity,
worker bundle and bounded synthetic concurrency path. The missing/encoded-header
fallback and early provider responses remain covered by local tests rather than
these hosted responses. Live Zoom downloads/import listing, actual AssemblyAI
upload/transcription acceptance, long decoded recordings, sustained independent
concurrent requests and hosted disconnect/slow-source scenarios were not tested.
A paid provider check requires separate authorization. The existing queued-job,
lease/reference/intent and import partial-success contracts remain covered by the
local regression suites. The prototype and local implementation measurements are
preserved separately in the [implementation receipt](ZOOM_AUDIO_IMPLEMENTATION_2026-10-19.md).
