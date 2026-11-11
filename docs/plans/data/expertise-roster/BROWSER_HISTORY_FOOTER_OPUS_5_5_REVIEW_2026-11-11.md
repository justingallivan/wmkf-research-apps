# Browser history footer — Opus 5.5 review

## Current disposition

[VERIFIED via the exact transcript below and coordinating session's check results]
Opus returned READY for the three display guards. Three focused UI metadata tests
passed. The rebuild passed (`outputs/roster-browser-history-build.log`). A second
real OAuth walkthrough with a fresh fixture showed only Model, Tokens 0 and Cost
$0.0000 in the synthetic history footer, with no NaN, Latency or empty Roster label.
Its read-only run made no Dataverse writes. The private
`browser-history-recheck-20261111/result.json` recorded success, 46 unchanged profiles,
unchanged canary ETag, unchanged public SQL and removal of the owned schema.
The review's unrelated nullable-token observation remains outside this correction.

Source transcript: `outputs/roster-history-footer-opus.md`, preserved verbatim below.

## Archived transcript

**READY.** None of the three guards hides a valid value from the live, batch or history paths.

**Where the values come from**
- **Single match** (`pages/api/expertise-finder/match.js:195-202`): `estimatedCostCents` is `estimateCostCents(...) || 0`, so always a number. `latencyMs` is `Date.now() - startTime`, an integer. `rosterSize` is `rosterResult.rows.length`, an integer. It reaches the footer through `setMetadata(data.metadata)` (`pages/expertise-finder.js:217`), and numbers stay numbers through JSON.
- **Batch** (`lib/services/expertise-finder/batch-match-service.js:259-267`): the values are built the same way. `batch-match.js:52` returns the service result unchanged. The client spreads it into `results[requestId]` (`pages/expertise-finder.js:826-828`), and it reaches the footer at :1072.
- **History** (`pages/expertise-finder.js:1153-1158`): only model, tokens and `parseFloat(match.estimated_cost_cents)` are set. `history.js:28` doesn't select latency or roster size, and the table has no such columns, so those two are always missing here.

**What each guard does**
- **Cost:** the column is `NUMERIC(10,4)`, so it can come back as a string like `"0.0000"`. `parseFloat` turns that into 0, which still shows as `$0.0000`. A null historical cost becomes `parseFloat(null)` = NaN and is hidden. If the driver returns a number instead of a string, `parseFloat` still gives the same number.
- **Latency:** live and batch values always show, including 0. Missing history values are hidden instead of showing NaN.
- **Roster size:** live and batch `rows.length` always shows, including 0. Missing history values are hidden.
- None of these three fields is ever sent as a string on the live or batch paths, so the guards can't hide a real value there.

**One unrelated issue (not a blocker):** the Tokens line at :164 can still show "undefined" if the history token columns are null. That isn't a regression from this fix.

I didn't save this review to the plan file because the Write tool is disabled in this session.
