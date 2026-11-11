# Roster PDF input bytes — Opus 5.5 review

## Current evidence boundary

[VERIFIED via the exact transcript below] Opus returned READY for the reviewed
source scope. The reviewer did not run the tests. The coordinating session reports
commit `27fd99574`, 245 passing tests across 16 suites
(`outputs/roster-post-blob-pdf-focused-tests.log`), four relevant gate/self-test pairs
passing and a credential-free build exiting zero (`outputs/roster-pdf-bytes-build.log`).
These are separate post-review verification results. The transcript describes its
reviewed snapshot, including its explicitly limited scope and observations.

This review alone does not establish live outcomes. Subsequent batch success and
final cleanup, with the unsuccessful single proof still explicit, are recorded in
[final results](LIVE_ATTACHMENT_MATCHING_RESULTS_2026-11-11.md).

Source transcript: `outputs/roster-pdf-bytes-opus.md`, preserved verbatim below.

## Archived transcript

**READY.** I found nothing that blocks this fix. I couldn't write the plan file because Write is disabled in this session.

**What I checked:** I had no shell, so I never ran `git diff` and never saw the lines before the fix. This verdict covers `pages/api/expertise-finder/match.js:71`, `lib/services/expertise-finder/batch-match-service.js:126` and `tests/unit/expertise-finder-pdf-input.test.js` as they are in the working tree. Any other uncommitted changes in those two source files are unreviewed. I read the new test but did not run it, so I can't confirm it passes.

### How the parser treats the input (pdf-parse 1.1.4, using its bundled pdf.js v1.10.100)
1. `node_modules/pdf-parse/lib/pdf-parse.js:70` passes the input unchanged to `PDFJS.getDocument`.
2. `pdf.js:3407`: anything that is `instanceof Uint8Array`, including a Node Buffer, skips the parser's own conversion step.
3. In Node, pdf.js uses an in-process "fake worker" that copies the data it is sent. `pdf.js:4166-4167` turns copying on whenever typed arrays exist (`Uint8Array !== Float32Array`). No ownership transfer is requested, so the copy at `pdf.js:3944` is `new value.constructor(value)`:
   - A **plain Uint8Array** becomes a fresh copy starting at position 0 of its own memory, of exactly the right length, with the input's offset and length respected.
   - A **Buffer** becomes `new Buffer(buf)`. That can return a slice of Node's shared memory pool that starts at a non-zero offset.
4. `pdf.worker.js:1847` (`makeSubStream`) reads `this.bytes.buffer`, the whole underlying memory, and ignores where the view starts. A copy with a non-zero offset therefore reads the wrong bytes, which is consistent with the "bad XRef entry" error. For small files the pool explains this from the source. For large PDFs I did not establish the mechanism from source; your 8/8 offline reproduction is the evidence there.

### Both call sites
- **`match.js:71`** `new Uint8Array(fileBuffer)`: the fetched body is an ArrayBuffer, so this view covers all of it from position 0 and the bytes are exact. Even if `arrayBuffer()` ever returned a Buffer, this would still make an exact copy.
- **`batch-match-service.js:126`** `new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)`: an exact view of the Buffer's bytes without copying them. A non-zero offset is safe here only because of the fake worker's copy in step 3. That copy produces a fresh array starting at position 0 before the worker reads `.buffer`. In production the Buffer comes from `lib/services/graph/downloads.js:120` (`Buffer.from(arrayBuffer)`), which normally starts at position 0 anyway.
- Memory use and error paths are unchanged: pdf.js already made one copy before, and still makes exactly one.

### Does the test catch a regression?
- Jest's Node environment uses the host's `Buffer` and `Uint8Array` (`jest-environment-node/build/index.js:181,186`). So a Buffer counts as `instanceof Uint8Array` inside the test, just as in production. If the fix were reverted, a Buffer would go down the same failing path.
- The synthetic PDF is one page with a standard font and object streams off, so it is probably smaller than the pool threshold [ASSUMED]. In that case a revert would fail the parse and text assertions as well. Either way, a revert to a Buffer is caught by `Buffer.isBuffer(input) === false`.
- The batch path receives a sub-view that starts 16 bytes into a padded buffer, and the sha256 check compares against the source. That catches slicing mistakes such as `new Uint8Array(buffer.buffer)`.
- The test checks that parsing finishes before any model call: `LLMClient` is never constructed, and with `CLAUDE_API_KEY` removed both paths stop at the missing-key error.
- The existing tests (`expertise-finder-match-route`, `batch-match-service`, `expertise-finder-batch-match-route`) mock `pdf` and never check its arguments, so they are unaffected.

### Outside this review (not blocking)
Other places that call pdf-parse may still pass Buffers: `lib/utils/file-loader.js`, `pages/api/process*.js` and `shared/api/handlers/fileProcessor.js`.
