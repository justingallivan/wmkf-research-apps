# Reviewer lifecycle wiki extraction audit

The 2026-10-22 compression split the mixed reviewer lifecycle page into nine capability topics and retained the original page as a byte-preserved historical snapshot.

The snapshot is 189,477 bytes and 2,260 lines with SHA-256 `fdccedfe393f7ae7db7afa04b5b48297080b5c269290637bbf70e192f68888e7`. All 23 assigned source segments were checked against their corresponding child-page bodies in original source order. The three retained hub source regions were checked byte-for-byte. All extracts match exactly except for two explicit, source-checked corrections recorded with hashes in the JSON manifest.

The corrections clarify that invitation Send is blocked only by the fixed review-due/proposal-release comparison (response-deadline conditions do not block Send), and that Stage 7 decisions D1–D5 are resolved. The J27-060 Initial Assessments excerpt now cites the exact statement in `workbench-shell-handoffs.md:148`.

The inherited `last_verified` date is not a fresh semantic verification date. **2026-10-22 extraction verification covered structural bounds and byte provenance only; it did not recertify claims, runtime behavior, repository drift, or live state.** Mixed current guidance, dated history, and owner decisions remain distinguished within the extracted content.

Detailed line bounds, byte lengths, hashes, and correction records: [`reviewer-lifecycle-extraction-2026-10-22.json`](./reviewer-lifecycle-extraction-2026-10-22.json). Historical source snapshot: [`reviewer-workbench-lifecycle-2026-10-22.txt`](./evidence/reviewer-workbench-lifecycle-2026-10-22.txt).
