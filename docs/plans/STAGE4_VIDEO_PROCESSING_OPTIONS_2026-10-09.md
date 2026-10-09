---
title: Stage 4 video processing options and privacy benchmark
domain: transcription
kind: plan
status: proposed
summary: "Research recommendation: benchmark full audio/video re-encoding in an Azure Container Apps job if WMKF has Azure; Vercel Sandbox is the fallback. No processor is approved, no benchmark has run, and Board publication requires source-timeline and output-content verification."
owner: product-engineering
related:
  - docs/plans/MEETING_RECORDING_WORKFLOW_PLAN_2026-10-07.md
  - docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md
---

# Stage 4 video processing options

Research date: **2026-10-09, America/Los_Angeles**. All public pricing and limit sources below were read on this date. This is input to Justin and Claude's separate Stage 4 design, not that design or implementation authorization.

## Recommendation and decision status

**[ASSUMED — engineering recommendation, not benchmark-proven] Prefer a pinned FFmpeg container in a WMKF-owned Azure Container Apps Consumption job, fully re-encoding the retained presentation's video and audio.** First confirm an Azure subscription and approved region. Start the benchmark with 2 vCPU / 4 GiB, one job at a time. Keep scheduling/status in the application; do not run the encoder inside a browser request. At 60 recordings/year, reducing code and privacy-proof complexity matters more than saving a few CPU dollars through smart cutting.

**[ASSUMED] Vercel Sandbox is the fallback benchmark venue** if Azure is unavailable or materially more work to operate. It supports the necessary long-running process and scratch space [VERIFIED via S2]. Vercel is already part of the infrastructure described by the owner, but permission to place full discussion-bearing MP4s there is **not** established. Explicitly disable persistence and audit snapshots: stopping a current Sandbox can preserve its filesystem [VERIFIED via S3]. This retention difference is material.

**[VERIFIED via Justin's answers in this research chat, 2026-10-09]** Planning volume is **30 recordings per cycle, twice yearly: 60/year**. Azure subscription availability remains unknown. External processing permission is undecided; compare without sending any data. These are not blockers to this conditional research recommendation, but they block selecting/provisioning a real venue and uploading real recordings.

**[ASSUMED] Do not choose a synchronous Vercel Function, raw stream-copy, or a player-only trim for the first implementation.** Mux asset clipping and AWS MediaConvert are credible managed alternatives, but would still require our independent timeline and exported-file verification. No service's marketing phrase “frame accurate” establishes that the M4A transcript boundary maps correctly or that every audio sample is safe.

## Evidence boundary and local baseline

- [VERIFIED via `git rev-parse HEAD`, `git status`, 2026-10-09] Research started at `06816d870fc710559674e598f63efc7f4518797a`, clean branch `codex/stage4-video-processing-research`, in the Stage 4 worktree. No `.codegraph/` directory was present. No runtime, migration, environment or deployment change belongs to this research.
- [VERIFIED via owner request and recorded probes in the Stage 3b plan, “Pre-implementation read-only probes,” items 3 and 5; not independently re-probed] Sample: 15 meetings, 107.5–527.5 MB, one permitted MP4 variant each. The owner reports durations of 47–85 minutes. Cap: 2,000,000,000 bytes. Three container probes found `moov@13374`, 1.24–1.41 MB long; it **starts** in the first MiB, but does not fit wholly there. `mvhd` duration agrees within 1 second; this is not synchronization proof.
- [VERIFIED via owner request and workflow plan §3; not a Production check] Stage 3a imports/transcribes audio and staff confirm the boundary; Stage 3b copies full MP4s to staff SharePoint. Stage 4 is the requested future derivative. The historical session handoff predates parts of the later release record; this research does not reconcile main-checkout release history.
- [VERIFIED via local `package.json:161`, `vercel.json`, and `video-copy-worker.js:91–96`] Workflow is pinned at 5.0.0; relevant function configurations reach 300 seconds; the copy worker declares a 270-second work budget. **[ASSUMED] A resumable byte-copy strategy does not make an arbitrary FFmpeg process resumable.** Encoder partitioning and durable intermediate files would add a separate protocol.
- [ASSUMED — unmeasured] Codec/profile, pixel dimensions, variable frame rate, closed/open GOPs, audio priming, edit lists, stream offsets and recording-pause behavior remain unknown. “Zoom MP4” is not a sufficient encoding specification.
- [VERIFIED via `command -v ffmpeg` and `command -v ffprobe`] Neither command was on this session's PATH. No synthetic encoder experiment ran, no binary was installed, and no benchmark result is claimed.

## Comparison: venues, guarantees and operations

**[ASSUMED — applies to all runtime figures]** Planning case: 500 MB source, 85-minute meeting, 60-minute presentation, H.264/AAC output preserving source resolution up to assumed 1080p. CPU encoding throughput of 0.5–3 times real time gives **20–120 minutes encoding** for the presentation. Allow another **5–20 minutes** for transfer, probing and complete output decoding: **25–140 minutes/job**, excluding provider queue delays. This is a sizing envelope, not observed performance; 500 MB alone cannot predict encoding time. A 2 GB high-resolution input can be slower and produce an output larger than its source. For 2-core GitHub/Functions scenarios use the same unproven envelope, not an implied performance ranking.

In the table, **F** means “our full re-encode plus the acceptance procedure below can be evaluated here,” **not** “venue guarantees no leak.” All setup/maintenance judgments are [ASSUMED]. Compute estimates exclude engineering, tax, existing SharePoint storage and supporting cloud resources. Costs are expanded in the next section.

| Venue | Accuracy and realistic execution limits | Runtime and cost/recording → annual at 60 | Data handling, burden and SharePoint return |
|---|---|---|---|
| **Azure Container Apps job (preferred conditionally)** | F. Configurable job timeout/retries [VERIFIED via S4]. More than 1 vCPU gets 8 GiB ephemeral storage [VERIFIED via S5]; proposed 2 vCPU/4 GiB must enforce a scratch-space/output cap. | [ASSUMED] 25–140 min; $0.09–$0.50 → $5.40–$30.24 compute, provisional rates. | [ASSUMED proposal] Microsoft processes full source in selected Azure region; job-local files only, removed on completion/failure, no media in logs. Container/replica storage disappears when stopped [VERIFIED via S5]; physical erasure/diagnostic retention needs approved terms. Moderate setup: subscription, image registry, identity, dispatch, retry/reaper. Worker returns validated bytes through Graph upload session. |
| **Vercel Sandbox** | F. Pro: up to 8 vCPU/16 GB, 24-hour session; current SDK/custom image gets 64 GB ephemeral disk [VERIFIED via S2]. FFmpeg lives in an image rather than the Function bundle. | [ASSUMED] 25–140 min at 2 vCPU/4 GB; $0.142–$0.795 → $8.52–$47.71 compute, plus transfer if charged. | Full source goes to Vercel. Region selectable [VERIFIED via S2]. Persistence defaults on; sandbox deletion does not delete independent snapshots [VERIFIED via S3]. [ASSUMED proposal] Explicit nonpersistent run, no media snapshots/drives, cleanup reconciliation. Moderate setup, likely less account setup than Azure; Graph return from sandbox. |
| **Vercel Function / Fluid / Workflow step + static FFmpeg** | F in principle; **poor fit under current 300 s config**. Current public docs: 2 GB Hobby/4 GB Pro memory, 800 s general Pro maximum, 1800 s extended beta, 250 MB standard bundle/5 GB large-function beta [VERIFIED via S1]. Historical Vercel maintainer answer says 512 MB `/tmp`; current entitlement unverified [S1b]. | [ASSUMED] 25–140 min exceeds the current 5-minute configuration; most of the range also exceeds the 30-minute beta maximum; no credible whole-file success price. Hypothetical partitioned compute $0.124–$0.696 → $7.46–$41.78 before overhead; **not a working solution quote**. | Vercel receives source bytes; regional invocation with explicit temp cleanup proposed. Workflow orchestration does not prove a child encoder can outlive a step; verify deployed step limits. High complexity if partitioning. 4.5 MB HTTP body limit [S1] excludes returning MP4 through route; worker-to-Graph transfer required. |
| **Mux asset clips** | Vendor documents frame-accurate asset clips; instant clips are not equivalent [VERIFIED via S8/S9]. Audio sample edge/priming and export must pass our test. Full asset ingestion precedes clipping. | [ASSUMED] budget 25–140 min including ingest/clip/export; queue/SLA unknown. Basic 1080p example $0.54 → $32.40 gross with conservative one-month storage accounting. | Mux receives full meeting and stores source + clip; explicit asset deletion after validated SharePoint return proposed. US/other-country processing policy [S11]; region pinning and post-delete backup/CDN purge time unverified. Moderate integration, less encoder maintenance; private asset, standard MP4 export, validate, then Graph upload. Never publish full-asset playback ID. |
| **Cloudflare Stream** | Clip API accepts start/end seconds; reviewed docs do **not establish** frame/sample boundary semantics [VERIFIED via S12]. Treat accuracy as [ASSUMED/unproven], not as a confirmed keyframe-only implementation. | [ASSUMED] 25–140 min plus queue. Serial jobs and prompt deletion: $13.60/year for two active months, $0.227/job; keeping minimum subscription year-round: $63.60/year, $1.06/job. | Cloudflare receives full source and new clip. Clips do not inherit scheduled deletion [VERIFIED via S12]. Region confinement and erasure delay unverified. Moderate setup, inadequate proof currently. Export MP4, independently validate, upload through Graph; delete both assets. |
| **AWS Elemental MediaConvert** | Frame-number clipping; **EndTimecode includes that frame** [VERIFIED via S14]. Round down to a safe last frame, not directly to rounded transcript seconds. Audio output still requires validation. | [ASSUMED] 25–140 min plus queue; $0.90 → $54/year encoding for one 60-min AVC HD <=30 fps Basic output using 2× normalization; add S3/egress/orchestration. | AWS receives source, normally staged in private S3; regional job and output bucket proposed. Customer controls object lifecycle/versions; service-internal copy retention unverified. Moderate setup: AWS account, IAM, S3, job callback. Download validated output from S3 into Graph; remove source/output versions and failed intermediates by exact identity. |
| **AWS Fargate task** | F. 20 GiB included ephemeral disk, configurable task CPU/memory [VERIFIED via S15]; long job not tied to Lambda's timeout. | [ASSUMED] 25–140 min at 2 vCPU/4 GiB; $0.041–$0.230 → $2.47–$13.82 compute. | AWS processes full source in selected region. [ASSUMED proposal] Ephemeral task disk, no media-bearing logs/volumes; stop/reaper and verification. Moderate/high setup: ECS, registry, network, IAM. Network/NAT/IPv4 fixed costs can outweigh compute. Direct Graph return. |
| **AWS Lambda container** | F subject to execution cap. 900 s, up to 10,240 MB memory and `/tmp`, 10 GB container image [VERIFIED via S16]. More memory buys CPU, not unlimited duration. | [ASSUMED] proposed 25–140 min fails 15-min cap. A hypothetical 10-min successful 4 GB run costs $0.04 → $2.40/year, **not a forecast**; retries/splitting extra. | AWS receives full source; selected region, warm `/tmp` cleanup/reaper needed. Medium packaging, high partitioning complexity. Direct Graph return; timeout before validation means no publication. |
| **Azure Functions** | Consumption 10-min maximum; Flex unbounded configured execution but 0.8 GB temporary storage and max 4 GB memory; Premium 11–61 GB temp with warm-instance billing [VERIFIED via S17]. Containers do not remove hosting-plan limits. | [ASSUMED] 25–140 min: Consumption fails; Flex needs external scratch/streaming; at assumed $0.000026/GB-s and 4 GB, $0.156–$0.874 → $9.36–$52.42 Flex compute. Premium quote required. | Microsoft receives full source in selected Azure region; extra storage/Functions-host lifecycle to own. [ASSUMED] More moving parts than a job for a single batch encoder. Graph return after validation; storage copies included in cleanup. |
| **GitHub Actions hosted runner** | F. Hosted job max six hours [VERIFIED via S18]; private-repo Linux runner 2 CPU/8 GB/14 GB SSD [S19]. Disk is shared with installed tools; measure free space. | [ASSUMED] 25–140 min at published $0.006/min: $0.15–$0.84 → $9–$50.40, ignoring included minutes. | GitHub/runner infrastructure gets full source. [ASSUMED] Avoid for production processing: privileged workflow edits/actions and logs/artifacts add disclosure paths; standard runner region confinement not established. No upload-artifact/cache of media; secure Graph identity and direct return required. Fine synthetic CI candidate **only after metered-use approval**. |

**[VERIFIED via local `vercel integration discover --category video`]** Marketplace discovery listed Mux. This identifies availability, not approval or suitability. No integration was installed. **[ASSUMED] Other managed encoders can be reconsidered if these fail:** Transloadit supports custom FFmpeg parameters [S22], but its retention FAQ says at least 24 hours even when earlier purge is requested [S23]. It adds a processor without removing our verification need; not shortlisted or costed as a proposed venue. api.video and Coconut were not evaluated; no unsupported accuracy/retention claims are made about them.

## Reproducible cost arithmetic

**[ASSUMED] USD planning estimates, one output and one successful attempt each, 60/year.** No existing credit, free grant or trial is treated as authorization or guaranteed savings. Rates are verified where identified; runtime, output duration, region and resource size are assumptions. Double attempts roughly double variable costs. Round monetary results only after calculation.

| Model | Rate evidence and arithmetic |
|---|---|
| Azure job | [ASSUMED rate] $0.000024/vCPU-s and $0.000003/GiB-s; regional prices did not render numerically on S6, so obtain a quote. `seconds × (2×0.000024 + 4×0.000003)` for 1,500–8,400 s = $0.09–$0.504. Azure bills active job resources; free grants are shared subscription allowances [VERIFIED via S7]. |
| Sandbox | [VERIFIED via S2] default US rate $0.128/active CPU-hour and $0.0212/GB-hour. Assume both CPUs fully busy throughout: `(2×0.128 + 4×0.0212) × 25/60..140/60`. Sandbox creation $0.60/million adds negligible per-run cost [S2]. [ASSUMED] A 0.5 GB export adds $0.075 where $0.15/GB applies; current Pro transfer bundling and project plan must be checked. No snapshot charge assumed because media persistence is prohibited in the proposal. |
| Hypothetical Fluid partitions | [VERIFIED via S20] iad1 CPU $0.128/hour, memory $0.0106/GB-hour (different from Sandbox). [ASSUMED] `(2×0.128 + 4×0.0106) × 25/60..140/60` = $0.1243–$0.6963; 60 runs = $7.46–$41.78. Invocation, workflow, intermediate storage and retry costs excluded. |
| Fargate | [VERIFIED via S15, N. Virginia Linux/x86 example] $0.000011244/vCPU-s and $0.000001235/GB-s. `seconds × (2×0.000011244 + 4×0.000001235)` = $0.041142–$0.2303952. Excludes image storage, logs, IPv4, NAT and egress; no continuously running NAT is assumed. |
| Mux | [VERIFIED rates via S10] Basic input free; 1080p storage $0.003/min-month, standard static rendition $0.000750/min-month, delivery $0.001/min before allowances. [ASSUMED conservative gross model] `(85+60)×0.003 + 60×0.000750 + 60×0.001 = $0.54`. Source and clip both incur Basic's one-month minimum; deletion can still happen promptly. Static-rendition one-month treatment is a conservative budget assumption, not an asserted minimum. Credits may reduce invoice. |
| Cloudflare | [VERIFIED rates via S13] $5/1,000 stored-minute capacity/month in blocks; $1/1,000 delivered minutes. [ASSUMED] Process sequentially, delete each full source/clip after return: 145 minutes fits one block. Two processing months: `2×5 + 60×60/1000 = $13.60`; year-round minimum: `12×5 + 3.60 = $63.60`. If all 30 pairs coexist, 4,350 minutes requires five blocks: $53.60 for two active months. |
| MediaConvert | [VERIFIED via S21] Basic first-tier Ohio example $0.0075/normalized minute; AVC HD <=30 fps single-pass multiplier 2. [ASSUMED] `60×2×0.0075=$0.90`; one rendition only. Higher frame rates/resolution/multipass alter this. |
| Lambda / Azure Functions / Actions | Lambda published x86 first-tier example $0.0000166667/GB-s [S24]: `4×600×rate≈$0.04`, requests/scratch extra. Flex's $0.000026/GB-s is **[ASSUMED, region quote needed]**. Actions rate verified via S25; multiply billed minutes by $0.006. |

**[ASSUMED] Engineering/operations dominate at this volume.** Allow several days for a benchmark and several more for production identity, stale-output fencing, cleanup and observability; this is not a delivery estimate. Budget supporting services separately before approval. A comparison of $5 versus $50 annual encoder CPU does not justify a materially harder privacy proof.

## Cutting technique and what “accurate” must mean

**[ASSUMED — proposed acceptance contract]** Let `B` be the staff-reviewed boundary on the transcript audio timeline. Establish a mapping to the MP4 presentation clock from the actual matched M4A and MP4. Derive a conservative safe endpoint `E`, no later than the earliest plausible discussion onset. If mapping uncertainty cannot be bounded, do not manufacture a margin: block and ask staff to review the MP4 boundary. A constant offset is allowed only after multiple anchors support it; recording pauses may require piecewise mapping or rejection. Similar file durations do not establish any of these facts.

| Technique | Research assessment |
|---|---|
| Full re-encode of retained portion | [VERIFIED via S26/S27] FFmpeg can decode, filter video frames and trim decoded audio samples before encoding. [ASSUMED] This is the simplest candidate for auditable removal. Select only approved streams; discard captions/data/attachments/chapters and nonessential metadata. Encode from the already-trimmed frames/samples; do not merely encode full content and hide its tail with an edit list. |
| Stream copy (`-c copy`) | [VERIFIED via S26] Copies encoded packets without filtering. [ASSUMED] An end cut is not automatically “next keyframe,” but packet boundaries, B-frame dependency/reordering, open GOPs and audio packet spans prevent treating `-t B` as proof. Copying a safely earlier independently decodable prefix could work but sacrifices content and still needs payload inspection. Reject naive copy for initial Board publication. |
| Smart cut | [ASSUMED] Copy complete safe closed GOPs and encode the tail from a safe random-access point. Open-GOP dependencies may require re-encoding more than one GOP; audio should be decoded/trimmed/re-encoded throughout. Codec parameters, timestamps and join compatibility need verification. Lower CPU, substantially harder proof; defer at 60/year. |
| Separate video/audio cuts | [VERIFIED via S27] `trim` and `atrim` have distinct timestamp/sample behavior and do not reset timestamps themselves. [ASSUMED] Use a shared mapped clock, not independent `PTS-STARTPTS` on unequal stream starts. Preserve original relative offsets or intentionally pad the later stream. Whole video-frame/sample intervals must lie within the approved span; round down. Remux and verify again. `-shortest` alone is not an accuracy check. |

**[ASSUMED] Two different obligations must pass:** (1) no selected source content comes from after the approved boundary, and (2) no output stream plays past the approved endpoint. Duration alone proves neither. AAC encoder delay/padding, MP4 edit lists, retained packets and alternate tracks need explicit checks. A final AAC packet may contain padding; accept only proven silence/padding, otherwise trim earlier/re-encode or block. Original lossy audio can smear energy around a transition; a synthetic exact timestamp does not establish semantic privacy for real speech. Review a quiet endpoint before discussion, with measured alignment uncertainty and codec behavior accounted for. If there is no safe gap, require a more conservative reviewed cut or block.

**[ASSUMED] Minimal output contract:** one H.264 video stream and one AAC audio stream (or an explicitly reviewed silent-video case), no unexpected streams, no embedded full-source payload, no recoverable hidden discussion tail, and normal downloadable MP4 playback. No copied full-meeting captions, filenames containing private discussion, or thumbnails from the full source. An export that is only safe in one player fails.

## Small benchmark proposal — not executed

**[ASSUMED — proposed sequence, requires later approval for cloud charges and real data]** Stage A can run locally with synthetic media; Stage B needs Justin's explicit approval for the named cloud venue, spend cap and exact recordings. Nothing in this document authorizes those calls.

### Inputs

1. **Six short deterministic synthetic fixtures**, 20–40 seconds each, with a machine-readable frame counter plus burned-in source time. Before the boundary: green frames and a 440 Hz tone; after it: red “PRIVATE” frames plus a distinct pseudorandom audio watermark on **each** channel. Generate an uncompressed reference first, then H.264/AAC sources with pinned settings.
2. Cover: boundary mid-GOP with B-frames; just before/at/after a keyframe; variable frame intervals; MP4 audio delayed 350 ms relative to video; separate M4A with a different origin; a simulated pause/discontinuity; extra audio/caption/data tracks. Variations may share a fixture. Test fractional boundaries, not just integer seconds.
3. **One 85-minute synthetic screen-share-style input near 500 MB**, with a 60-minute cut, and **one input near the 2,000,000,000-byte cap** with deliberately larger output. Test quota failure separately. These are performance/space cases, not substitutes for real Zoom media.
4. **Only after approval:** two paired real MP4/M4A recordings in an isolated staff-only benchmark destination: one long/high-size file and one CC/pause/offset case if available. The owner selects them. No new Zoom/SharePoint read is authorized now. Keep all content and screenshots outside Git.

### Steps and measurements

1. Freeze source byte hashes, exact source identities, transcript revision/boundary, FFmpeg/ffprobe version and container digest. Record codec/profile, pixel format, resolution, frame/time bases, start times, edit lists, GOP positions, packet PTS/DTS/durations, audio sample rate/channels and encoder priming/skip metadata. Inspect all streams, not only stream 0.
2. Decode M4A and MP4 audio into the same sample format for alignment. Match at least three distinct nonsilent anchors (early, near boundary, late) and test the offset between anchors. Silence/repetitive tones are ambiguous. For synthetic files compare against exact ground truth; for real files use waveform/correlation plus staff listening near the proposed boundary. Unexplained drift/pause means mapping failure, not “close enough.”
3. Run full re-encode first, with stream-specific mapped cutoffs on a common clock. Run naive stream-copy as a **negative-control candidate**, not an accepted method. Smart cut is optional only after the simple path passes. Capture resource peaks, free disk, CPU time, total time, throughput, encoded size, transfer retries and cost estimate. Do not log signed URLs or audio/text content.
4. Independently decode the entire output and enumerate every frame/audio interval. Map output back to retained source provenance. Inspect final video frames and all audio channels around the boundary. In synthetic output, detect the post-boundary visual/audio watermark automatically against the reference; include a deliberately leaky remux and a bad-offset output to prove the detector rejects them.
5. Inspect the whole container, including packets hidden by edit lists, alternate tracks and trailing/unreferenced media. Test an edit-list-ignoring decode/remux. Packet DTS may be negative from reordering and is not alone a leak; inspect presentation intervals and actual decoded payload. Conversely, a short `format.duration` is not a pass. Verify in a second playback path (e.g. browser and VLC) for AAC priming/padding differences.
6. For the cloud finalist, run the long case three times sequentially, then simulate worker termination, expired Graph session and stale boundary revision. Recreate an attempt from immutable inputs; never publish a partial file. Benchmark dispatch/status and cleanup with local mocks before any authorized Graph use.
7. With authorized isolated SharePoint access, create the upload session only once validated output is ready; transfer sequential chunks, reconcile expected ranges, complete, re-download and hash-check the exact destination item/version. Avoid an idle session during encoding. No Board registration in the benchmark. Cleanup exact owned scratch/provider/source-copy/output identities and record outcomes.

### Pass/fail criteria

**[ASSUMED — proposed hard gates]** Every test case must pass; any ambiguous evidence blocks Board publication.

- **Mapping:** synthetic mapping matches ground truth within one audio sample and the expected video-frame interval. Real recordings require a reviewed safe boundary on the MP4, measured residual uncertainty and an earlier endpoint that covers it. No arbitrary one-second tolerance for private speech. Segmented/mismatched source or non-monotonic mapping is a failure until explicitly resolved.
- **Video:** no source frame at/after `E`; retained frame presentation intervals end no later than `E`. No red/private frame or hidden post-boundary frame can be recovered. A frame overlapping `E` is dropped or shortened only if its source content is demonstrably safe; default to dropping.
- **Audio:** no selected source sample interval crosses `E` on any channel. Decode final exported AAC, account for delay/padding, and prove no discussion watermark/content in audible or hidden recoverable samples. If the checker accepts either deliberately leaky control, the checker fails and its results cannot authorize publication. Real cut must be heard by staff before publication.
- **Container:** expected stream allowlist only, complete successful decode, no hidden full-source tail, bounded file size, timestamps and A/V offsets consistent with the frozen transform. Output duration and per-stream terminal timestamps must both be checked.
- **Performance:** proposed target <=150 minutes for the 500 MB case at 2 vCPU/4 GiB, peak memory <80% and scratch <70% of allocated capacity, with no truncation. Resource failure must stop safely; larger inputs cannot be silently admitted on evidence from small files. Missing the timing target changes sizing/venue, never the privacy gate.
- **Durability/security:** boundary or source replacement during any await makes the result ineligible; upload success alone is not publication success. A retry cannot create a current Board link to an old output. Crash cleanup is demonstrable, no full source in logs/artifacts/snapshots, and failed cleanup remains visible.

**[ASSUMED] Benchmark report:** fixture/result matrix; source and output hashes; build versions; exact cut settings; alignment evidence; final frame/sample measurements; resource/time/cost ranges; demonstrated rejection of deliberately leaky controls; cleanup receipts; and unresolved cases. Keep content-free evidence in the repo and content-bearing media in approved temporary storage only.

## SharePoint and Stage 4 design handoff

**[VERIFIED via `lib/services/graph/upload-session.js`, `createBrowserUploadSession`, `putUploadSessionChunk`, `getBrowserUploadSessionStatus`]** The existing transport offers server-created preauthenticated sessions and bounded chunk PUTs with expected-range/committed-item responses. Its `uploadFileLarge` convenience helper takes a whole Buffer; do not assume that helper is a streaming interface. Microsoft requires sequential fragments below 60 MiB and multiples of 320 KiB except the final fragment [VERIFIED via S28]. These are transport capabilities, not an already-approved Stage 4 publication path.

**[ASSUMED — requirements for the separate design]** Bind dispatch to immutable video identity/hash, transcript revision, reviewed boundary, mapping version, output hash and verification receipt. A worker may receive only short-lived, narrowly scoped access; never put durable Graph credentials or signed source URLs into logs. Return bytes to a private staging item. Reauthorize and verify current revision before registering presentation-only material. The application owns publication; provider “ready” callbacks do not authorize it. If file creation succeeds but registration fails, reconcile that exact file instead of uploading another. Recheck current binding in both Board listing and direct-open readers. Discussion failure must not erase a verified presentation. New schema/routes/status values are deliberately unallocated here.

**[ASSUMED — Stage 5 prerequisite]** Cleanup inventory includes local scratch, failed attempts, provider originals/renditions/thumbnails/captions, snapshots, object versions, Graph partial/committed items and diagnostic artifacts. Operational deletion is not proof of physical erasure from provider backups or Microsoft retention holds. Presentation proof must survive eventual removal of full sources; do not design permanent access around replaying the original private recording.

## Questions still requiring Justin / administrator decisions

- [VERIFIED via owner response] Azure availability unknown: confirm subscription, budget owner, approved region and who can manage the job identity.
- [VERIFIED via owner response] Outside full-recording processing undecided: approve provider, subprocessors, region, retention and discussion-byte handling before a real benchmark. “Presentation only may leave” means trimming must happen inside the approved boundary first; a video vendor cannot do the initial cut under that rule.
- [ASSUMED — decision needed] Is a conservative earlier cut acceptable, and who reviews the actual MP4 endpoint? Define acceptable lost presentation content without relaxing the no-discussion rule.
- [ASSUMED — decision needed] Desired turnaround, peak simultaneous imports, maximum output size/resolution, and whether staff-only discussion video is part of the first Stage 4 release. Costs here cover **presentation only**.
- [ASSUMED — decision needed] Select two real recordings, isolated destination and a named-service benchmark spend cap. Suggested cap: $10 of incremental compute/transfer, excluding any fixed subscription/registry cost; confirm a quote first. No trial or included entitlement is authorization.

## Research verification and scope

**[VERIFIED via local commands]** Startup `check:*` scripts and self-tests ran sequentially. The only initial failure was the missing worktree-specific Claude memory symlink; creating it and rerunning `check:agent-invariants` passed. No Production refresh was run. The final document gates (`check:docs-catalog`, `check:doc-currency`, `check:doc-symbol-refs`, `check:build-claim-freshness`) and available self-tests are required before commit; their actual results are reported in the handoff. FFmpeg/cloud benchmarks remain NOT RUN.

**[ASSUMED — contract reconciliation scope]** Change surface/entry point/persistence: this research document only. Consumers: Justin and Claude's Stage 4 design. Prior findings: none. Whole-flow, partial-success and stale-async concerns are proposed benchmark/design obligations above, not verified implementation behavior. Helper extraction, migrations, API registration and enum fan-out are N/A because none is implemented. Existing workflow/copy plans remain historical/product inputs, not newly audited Production evidence. No claim that the repository's full recording workflow has been reconciled is made.

### Recommendation evidence and disconfirming checks

| Recommendation | Prerequisite and execution point | Evidence actually tested | What would refute it | Status |
|---|---|---|---|---|
| Azure job + full re-encode | Subscription/region and full-source permission before dispatch; mapped endpoint before filtering | Public job/storage contracts only; no encoder run | Resource cap failure, unexplained timing drift, recoverable discussion, or unacceptable account setup | [ASSUMED] First benchmark candidate, not implementation-ready |
| Sandbox fallback | Approved full-source use; persistence disabled at creation; cleanup at every terminal outcome | Public capacity/persistence docs; no Sandbox created | Persistence cannot be reliably disabled/cleaned, or region/processor terms rejected | [ASSUMED] Conditional fallback |
| Reject naive stream-copy initially | Exact packet/content proof would be required before publication | FFmpeg documented copy semantics only | A representative, independently validated safe-prefix implementation could support reconsideration | [ASSUMED] Conservative technique choice |

[VERIFIED via fresh read-only research review, 2026-10-09] A separate reviewer found no material arithmetic or privacy overclaim and flagged ambiguous negative-control wording; corrected above. Review was document-scoped, with selected public-source checks, not an encoder or Production test. **[ASSUMED — verdict] Research supports selecting a benchmark; implementation readiness remains unproven.**

## Public sources (all accessed 2026-10-09)

- S1 — [Vercel Functions limits](https://vercel.com/docs/functions/limitations).
- S1b — [Vercel maintainer discussion of temporary storage](https://github.com/vercel/vercel/discussions/5320), historical; current `/tmp` contract requires confirmation.
- S2 — [Vercel Sandbox pricing and quotas](https://vercel.com/docs/sandbox/pricing).
- S3 — [Vercel Sandbox persistence and deletion](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes).
- S4 — [Azure Container Apps jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs).
- S5 — [Azure Container Apps storage](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts).
- S6 — [Azure Container Apps pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/), dynamic regional numeric quote not retrieved.
- S7 — [Azure Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing).
- S8 — [Mux asset clipping](https://www.mux.com/docs/guides/create-clips-from-your-videos).
- S9 — [Mux instant clips](https://www.mux.com/docs/guides/create-instant-clips).
- S10 — [Mux pricing details](https://www.mux.com/docs/pricing/overview).
- S11 — [Mux privacy policy](https://www.mux.com/privacy); this does not resolve contractual media-erasure timing.
- S12 — [Cloudflare video clipping](https://developers.cloudflare.com/stream/edit-videos/video-clipping/).
- S13 — [Cloudflare Stream pricing](https://developers.cloudflare.com/stream/pricing/).
- S14 — [MediaConvert timecodes](https://docs.aws.amazon.com/mediaconvert/latest/ug/setting-up-timecode.html) and [InputClippings EndTimecode semantics](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/MediaConvert.html).
- S15 — [AWS Fargate pricing and resource configuration](https://aws.amazon.com/fargate/pricing/).
- S16 — [AWS Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html).
- S17 — [Azure Functions hosting limits and billing](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale).
- S18 — [GitHub Actions limits](https://docs.github.com/en/actions/reference/limits).
- S19 — [GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
- S20 — [Vercel Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing).
- S21 — [MediaConvert pricing and normalization](https://aws.amazon.com/mediaconvert/pricing/).
- S22 — [Transloadit video encoder](https://transloadit.com/docs/robots/video-encode/).
- S23 — [Transloadit retention warning](https://transloadit.com/docs/faq/temporary-purge-sooner/).
- S24 — [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/).
- S25 — [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
- S26 — [FFmpeg command and stream-copy documentation](https://www.ffmpeg.org/ffmpeg.html).
- S27 — [FFmpeg trim, atrim and timestamp filters](https://ffmpeg.org/ffmpeg-filters.html).
- S28 — [Microsoft Graph upload sessions](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0).
