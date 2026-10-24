# Manual recording pairing contract

[VERIFIED via branch source, isolated PostgreSQL and synthetic media tests; not deployed, 2026-10-23] Extends the existing presentation-video cut worker, rather than adding another processing timer. A small actor-bound private-audio staging ledger feeds that existing queue. Zoom remains preferred. Manual pairing requires an existing uploaded-audio transcript with retained source SHA/bytes/duration; arbitrary text cannot prove timing. The staff member supplies the exact original audio and the current manually uploaded MP4. Filenames or a checkbox never establish correspondence.

| Invariant | Producer → persistence → consumer | Evidence to require |
|---|---|---|
| Original transcript source | Current request/visit transcript resolver → frozen audio SHA/size/source ID → worker | Re-upload bytes equal original SHA and size |
| Same video content | Current RECORDING winner and Graph metadata → document/drive/item/size/quickXorHash → existing cut revalidation | Changed content supersedes; pair/worker content checks tolerate metadata-only eTag drift, while existing candidate approval still requires the saved recording ETag |
| Actual timeline correspondence | Isolated FFmpeg decode → content-free receipt → existing video upload/review | Exactly one audio track; zero timeline; equal mono 16k PCM hash and sample count; no fuzzy/re-encoded acceptance |
| Private upload ownership | Authenticated staff + current request → server pathname and fifteen-minute capability → finalize fresh authorization | No client pathname, token or claimed proof accepted; bounded 200 MiB direct private upload |
| Durable execution | Finalize → existing queued split + attached stage under request lock → detached cut/poll | No browser lifetime dependence; same existing worker lease, deadline and Sandbox cleanup |
| Proof reuse | Successful cut receipt → verified source pair → later boundary correction | Same original audio identity and MP4 content required; never repeat summary processing |
| Safe replacement | Explicit manual action names current review split → locked start → supersede only exact review | Fresh source/review mismatch refuses; approved edition remains |
| Privacy cleanup | Exact stored pathname → bounded maintenance after capability expiry and no active attached worker → Blob delete + cleared receipt | Cleanup runs with admission off; unresolved cleanup retries; no broad token enters Sandbox |
| External visibility | Candidate cut → existing human ending check and Coordinator edition approval → external reader | Pair proof never approves, publishes or withdraws |

Allocation: authorized production filenames-only query returned 84 rows through 085; 380 local/remote refs through 088 and both checkout migration directories contain no 089. 089 was allocated immediately after this check; production remains untouched.

Local synthetic media probe accepted byte-identical copied AAC after normalized PCM decode and rejected re-encoded AAC. This conservative mechanism intentionally asks for a matching original file when conversion changed audio samples; it does not infer offsets or repair timelines. Runtime rehearsal with paid Sandbox is not authorized by this document.

Failed/superseded processing restores an unexpired attached stage for retry atomically with the split transition; definite correspondence failures reject it. Verified/rejected raw bytes are cleaned after capability expiry by the existing video drain, with bounded batch and per-path backoff. A completed upload may finalize through its 24-hour stage lifetime after the write capability has expired. New manual admission remains separately disabled by default.
