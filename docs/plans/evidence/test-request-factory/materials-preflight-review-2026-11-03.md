# Reviewer materials preflight: expected archive misses

Status: implemented on review branch; no merge, Production deployment or materials send authorized.
Owner: Codex. User authorized the narrow fix and Claude Fable reviews.

Contract-reconcile Mode B. Entry: materials-release UI or acceptance drain →
existing authenticated preflight route/service → request identity read → shared
reviewer-materials lister → SharePoint metadata reads → sanitized availability
and count → existing preview/drain guards. Persistence: none in preflight;
downstream release writes are outside this change. Prior finding: coarse
`unavailable` incorrectly treats expected missing speculative archive folders as
an operational failure even with the canonical reviewer PDF present.

| Invariant | Surface | Verification |
|---|---|---|
| Only positively classified expected archive misses are exempted | Preflight service | Real shared lister, three typed archive misses, canonical PDF present |
| Other partial failures remain blocking even with a usable file | Service/shared lister | Archive 403/429/500/unknown404 and Dynamics missing, with canonical file present |
| Missing/malformed classification never exempts an unavailable result | Service | Unavailable mock with absent/null/malformed source metadata |
| Exact reviewer folder and request-bound filename remain authoritative | Unchanged shared lister | Internal and wrong-request files present in regression setup |
| Verified empty is distinct from unavailable | Service/route | Successful primary with no canonical PDF plus expected archive misses returns zero |
| Auth and sanitized response stay intact | Existing route | Existing auth/GUID/exception tests plus classification cases |
| No new mutation, token or email path | Preflight service/probe | Source trace; no production writes or sends exercised |

[VERIFIED via read-only Production metadata probe and matching deployed source]
The primary bucket lists all seven fixture files including its canonical reviewer
PDF. Three speculative archives return `graph_folder_not_found` (404). The shared
lister reports a nonempty file list, `unavailable=true` and
`unavailableSources=[]`. The preflight's coarse Boolean causes the refusal.
The reproducible probe is `scripts/probe-reviewer-materials-availability.mjs`;
private raw metadata/logs are not committed or sent for model review.

[VERIFIED via branch source/tests] Shared lister semantics are unchanged. An unavailable result is exempted
only when its server-owned `unavailableSources` is explicitly an empty array.
Nonempty classified failure sources also block a contradictory false coarse
flag. Without valid source classification, the prior coarse flag behavior is
preserved. The staff modal treats unavailable as advisory and asks for
confirmation on verified zero files; it does not hard-block sending solely on
unavailable. The acceptance drain blocks unavailable and holds verified zero as
proposal_missing. Its other eligibility, address, isolation and send guards remain. Ordinary
materials follow-up can resume for the same expected-archive-only condition;
this is not a Factory-only exception or permission to send during development.

No tracked Dynamics locations plus absent speculative archives also yields
verified zero. In the ordinary acceptance drain this reaches the existing
terminal proposal_missing hold rather than proposal_unavailable retries; adding
a PDF later does not automatically retry that held step. Staff release remains
available. Fixing preflight does not prove the entire remaining release flow.

## Whole-flow audits

Whole-flow: both consumers and the existing authenticated GET route traced.
Partial success: read availability only; actual failures stay unavailable even
with a qualifying file present. Missing proposal is verified zero, not success
with a downloadable file. Cross-system send outcomes are unchanged/out of scope.
Async: no new async/UI/background path. Existing modal cancellation guard and
drain leases/revalidation remain. Helper extraction: none; the preflight consumes
the existing trusted classification, leaving portal arrays and invitation
semantics unchanged. Durable surface: no new field/table/migration/route or
status; existing service header updated. Fan-out: all detailed-lister and
preflight consumers searched; no changed DTO reaches browser auth decisions.
Docs: scoped searches found general folder/filename/sanitized-response statements
compatible with this correction; dated audit receipts remain historical. The
route's existing header uses a shortened lister name and is unchanged.

Complement: expected root archive misses permit availability; missing Dynamics,
archive access/throttling/server/unknown404 errors and absent/malformed failure
classification hold. A canonical file is present in the relevant negative cases.
A missing child or drive-resolution failure is not the typed root-folder miss
(`lib/services/graph/files.js`) and remains classified as unavailable.

## Reviews and validation

Fable plan review: READY TO IMPLEMENT with named refinements. Incorporated
no-location zero semantics, contradictory metadata hold, realistic typed-error
fixtures and explicit malformed diagnostics tests. The existing boundary mock
calls jest.requireActual's real lister with injected I/O; initial code review
confirmed that harness exercises the real classification/filter. No new test-only
production seam or separate implementation was added.

Fable code review: READY FOR OWNER REVIEW, no blocking findings. Final focused
verification of the plan refinements: READY FOR OWNER REVIEW, all named findings
closed against the frozen source and tests. Host OAuth, safe-mode read-only
Read/Grep/Glob, empty MCP configuration, environment whitelist; no provider keys,
private operational artifacts or substitute review products.

Local validation: three positive regressions failed before the patch; final
10 focused/consumer suites and 240 tests passed. Type check, scoped ESLint and
production build passed. Relevant API/Atlas/DAL/route-service gates and their
self-tests passed sequentially. Hosted CI is tracked on PR #623; this source-review receipt does not assert its outcome.

## Frozen fingerprints

SHA-256 verified unchanged after Fable's final verdict. Runtime/test files are
frozen; this receipt records the separate review and local validation checkpoint.

| File | SHA-256 |
|---|---|

| `lib/services/review-manager/materials-preflight-service.js` | `d249332b9af2aade84f46a388a4a59d9934e5ef27fc01c1278a4249eab1ba784` |
| `tests/unit/materials-preflight-service.test.js` | `cf35fdfa51282f27c10562106c97e651188913e1de3185625a9739586023a060` |
| `tests/unit/materials-preflight.test.js` | `f38b71890dfbbbacf9565f1f6c2987235aa986d9f0436dcb05ad0609aa529cc4` |
| `scripts/probe-reviewer-materials-availability.mjs` | `129b3a10a9c3287bc2f510762e30e709f61e2d0b363b68d9bf705bbf0564391e` |

Source-only Fable response fingerprints (private response files not committed):

- plan: `5797bb9bb59aff8de571980595f1ff142d513962b5e76dacd58ed814cda4407c`
- code: `3cbceb54382722ba3f9326c2c0072f372c900743a066f7e1d2bfcb7b856a622e`
- final: `e7a4ccfc5be5a5de4cd0f29a78db2c1d808b1fa0f15955d91719600255a9dae2`
