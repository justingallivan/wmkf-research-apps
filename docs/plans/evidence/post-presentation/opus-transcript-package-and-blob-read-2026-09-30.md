# Opus transcript follow-up closure — 2026-09-30

Read-only review via verified claude.ai Max subscription OAuth outside the sandbox; model claude-opus-5-5; API-key source none. The orchestrator verified the unchanged tracked code/test diff fingerprint `c0b23fd2694dba2ff2d8a22f188bffd6e86c8d41db75e42b88372df7d4b8dbee`. Incident/validation receipts were added separately and are outside that fingerprint. No production writes or paid review product.

**Verdict: approve. There are no blockers, and one condition about SharePoint's output remains.**

**How this was reviewed:**
- I read `/private/tmp/transcript-followup-review.diff` as it is on disk.
- I can't compute its SHA256 with my tools, so I have not checked it against `c0b23fd2…dbee`.
- I also read these source regions:
  - `lib/services/portal-upload-staging.js:231-333`
  - `lib/services/test-requests/docx-package-attestation.js:488-596`, `:770` and `:831-1024`
  - the installed `@vercel/blob` `get()` at `node_modules/@vercel/blob/dist/index.js:94-204`
  - `docxFailureDiagnostics` at `material-service.js:1571-1596`
  - every caller of the shared loaders, with their permanent-code sets
- I did not run the tests; the results are the implementer's.
- No commands, file writes or metered products were used. Plan mode wanted a plan file, but writing is disabled and you forbade it, so this reply is the whole review.

## B1 (compressed length): closed
- **The fix is in the loader.** At `portal-upload-staging.js:254-257`, any `Content-Encoding` other than `identity` sets `expectedSize = null`, so the compressed length is ignored. Stacked values such as `identity, gzip` also count as encoded.
- **The cap still applies to decoded bytes.** The file is capped at `max_bytes` as it is read, and the stream is cancelled at the cap (`:291-295`). Actual empty bytes still give `emptyCode`, and the hash and `actual_bytes` come from the decoded buffer.
- **Both requested tests exist.**
  - A response with `content-length: 3`, gzip and a longer body is accepted at its real length (diff `:361-367`).
  - An over-cap gzip response gives `file_too_large` with no ledger write (`:369-374`).
- **The new request header is safe.** The SDK applies `...options.headers` after `authorization` (`dist/index.js:134-139`), so `Accept-Encoding: identity` can't replace the bearer token.
- **One runtime assumption isn't tested.** Every test mocks `get()`, so none shows that Node's `fetch` keeps `content-encoding` in `response.headers` after decoding the body. I believe it does. If it didn't, a compressed response with a length would give the same mismatch as before this diff, so it can't cause a regression.
- **No other test checks the old `get()` arguments.** The only other `useCache: false` assertions are in `review-panel-storage` and `cycle-dossier-storage`, which don't use this loader.

## Optional hardening: done
- **Locked or failing stream:** `getReader()` is now inside the `try` (`:287`). A locked stream gives `staged_upload_unavailable` (503), which is retryable, and there is a test for it. The `finally` block is safe when `reader` was never set.
- **Root attributes:** `strictRoot` rejects unprefixed attributes on the `<Relationships>` root of `_rels/.rels`, on both source and stored sides (`:873-874`).
- **Added relationship ID:** it must match `^[A-Za-z_][A-Za-z0-9_.-]{0,63}$` (`:883`). Both this and the root check have tests (diff `:258-276`).
- **Logging:** my earlier finding 3 is fixed. The new message starts with `part _rels/.rels`, so the log names that part.

## Invariants re-checked and intact
- **Render comparison:** `fullContentTypes:false` means `addsCustomProperties` is false, so `_rels/.rels` is still compared byte-for-byte (`:843-844` → `:954-956`).
- **Source that already has custom properties:** `_rels/.rels` is still byte-exact.
- **Newly added custom properties:** these are allowed only when the source lacks the part.
  - Exactly one internal relationship with the exact type and target is required.
  - Exactly one override with the exact part name and content type is required.
  - Both counts are enforced (`:966-968`).
  - Duplicate IDs and part names fail.
  - A source with a dangling relationship or override for the part gets an added count of 0 and fails closed.
- **Existing root relationships:** these must survive with the same `Id`, `Type`, `Target` and `TargetMode` (`sameRel`, `:770`). A renumbered ID or a `/`-prefixed target fails closed, as intended.
- **Edits and hidden files:** source-content edits, unexpected parts, malformed XML, DOCTYPE, comments and processing instructions all still fail closed.
- **Staging loader:**
  - Pathname, MIME, privacy HEAD, `max_bytes` and known-length checks are kept. An explicit length of 0 with a non-empty body is a mismatch.
  - The ledger write is fenced by `lease_token`. A lease that expires during a slow read gives `finalize_lease_lost`, never a stale write.
- **Callers:** the transcript finalize route and the four image routes all treat `staged_upload_unavailable` as retryable (the route releases the upload). `empty_*`, `*_too_large` and `staged_upload_mismatch` stay permanent.
- **Image consumers:** the only change is that a response with no length is now read under the cap instead of being rejected as empty. That isn't a regression.
- **Transcript cleanup:** the exact stored-byte receipt and cleanup rules are untouched.

## Non-blocking residuals
1. **Check this condition on the stored 1002903 package before deploy.** I can't say the user's exact file passes. In the stored `_rels/.rels`, confirm:
   - the added relationship's `Id` matches the pattern above (no braces, colons, or GUID-style ID over 64 characters);
   - the `<Relationships>` root has no attributes other than `xmlns`;
   - the target is exactly `docProps/custom.xml`.

   Whether SharePoint kept the original relationship IDs can't be checked without the deleted source. If it didn't, the attestation fails closed.
2. **That failure would look like the old one in the logs.** A missing original relationship logs `{part:'_rels/.rels', kind:'content_changed'}`, exactly as before the fix. Optional fix: word the message so it logs as `structure_mismatch`.
3. **A small hidden-data gap remains (at most 32 KB).** `xmlns:*` declarations have no value or length check, and whitespace between elements is trimmed rather than checked. This applies to the root and each `Relationship`, and `[Content_Types].xml` and the document relationships part already have the same gap. Optional fix: reject any `xmlns:*` declaration other than the package namespace.
4. **Loader edge cases (optional):**
   - Early exits still don't cancel the response body (this was already the case).
   - An encoding undici can't decode would pass raw bytes through to downstream validation.
   - A stalled stream is only stopped by the function timeout and lease expiry.
5. **Test gaps (optional):**
   - A source that already has custom properties still requires a byte-identical `_rels/.rels`.
   - The render comparison rejects a changed `_rels/.rels`.

**Required fixes: none.**