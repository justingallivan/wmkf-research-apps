# B4 reviewer-slot readiness: production read-only review (2026-09-29)

Status: **first Potential Reviewer slot PATCH blocked**. This records the post-merge, read-only section 13 rerun and the classifications requested by the owner. It does not authorize or perform a Dataverse write. B4 runtime remains planned in `TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md` §6.

## Evidence and scope

- [VERIFIED via production section 13 receipt, 2026-09-29 23:24Z] The sanitized local receipt is `/private/tmp/b4-prod-readiness-2026-09-29-rerun/reviewer-slot-readiness-receipt-2026-09-29T23-24-15-597Z.json`. The probe made GET requests only. It found no hard `incompleteReasons`, three `dispositionRequired` flow mentions, zero Request-update cloud-flow triggers, no unreadable flow definitions, and no slot-triggered classic workflow. Request auditing is enabled; Potential Reviewer slots 1–5 are not audited. The receipt is a metadata census, not a test of a slot write.
- [VERIFIED via production `RetrieveUserPrivilegeByPrivilegeName('prvReadWorkflow')` read, 2026-09-29] The probe app user has effective `Global` Process read depth. The same readiness session read both production isolation switches as literal `on` through the Vercel production environment. These observations must be checked again for the eventual B4 runtime release.
- [VERIFIED via `scripts/probe-test-request-factory-production-readiness.js` and `tests/unit/production-readiness-probe-cast.test.js`] Section 13 now recognizes only the observed manual flow shape (`manual`, `Request`, `ApiConnection`, with exactly `dataset` and `table` parameters) as a non-subscription trigger. A Request/slot mention in such a flow still enters `dispositionRequired`. Other unknown Request trigger shapes remain hard incomplete reasons.

## Flow dispositions for the reviewer-slot PATCH

The owner requested classification after the first receipt. The following dispositions apply only to whether **updating a Request reviewer slot automatically starts these flows**; they do not approve invoking a flow or changing a Request.

| Activated flow | Live trigger and relevant actions (read-only definition GET, 2026-09-29) | Disposition |
|---|---|---|
| GOapply Add Request to Review Group (Deprecated) | Manual `Request`/`ApiConnection` trigger with `dataset,table`, no Dataverse subscription. `GetItem` reads `akoya_requests`; the only record create in the inspected action tree is `akoya_reviewgroupapplicationses`. No reviewer-slot reference or Request update action was found. | [VERIFIED via live flow definition] A reviewer-slot PATCH does not invoke this manual flow. |
| Bill.com - Push Payments | Same manual trigger shape. Its Request action is `GetItem` on `akoya_requests`; inspected record updates target `akoya_requestpayments`. It also has HTTP actions, which run only when the flow is invoked. No reviewer-slot reference or Request update action was found. | [VERIFIED via live flow definition] A reviewer-slot PATCH does not invoke this manual flow. This does not classify an independently invoked payment run. |
| GOapply AutoFill Next Phase (Deprecated) | Dataverse webhook subscribes to **create** (`message=1`) of `akoya_goapplystatustracking`. Its Request action is `GetItem`; inspected record update targets `akoya_goapplystatustrackings`. No reviewer-slot reference or Request update action was found. | [VERIFIED via live flow definition] A reviewer-slot PATCH does not match its trigger or write target. |

These classifications explain the three `dispositionRequired` entries; the receipt intentionally retains those entries for human review. The combined evidence does **not** make section 13 `complete: true`, and it does not clear the separate plug-in gate.

## Remaining gate before any slot PATCH

- [VERIFIED via the section 13 receipt] An update of any Request column can invoke `AkoyaGo.CalculatedFieldsAsync` on Request and three enabled global custom steps: `AkoyaGo.RequestPreOperation`, `AkoyaGo.RequestPaymentFundAnonymity`, and `AkoyaGo.RequestPostOperation`. Two hidden `ObjectModel Implementation` steps on `Update`, two on `UpdateMultiple`, and the hidden Request rollup trigger are also listed. The custom plug-in implementations are not present in this repository [VERIFIED via repository symbol search]. Their behavior on a Potential Reviewer slot update is **UNKNOWN**; names and metadata do not prove harmlessness. Obtain platform-owner classification or an equally strong implementation/observational proof for each custom step before clearing this gate.
- [PLANNED] The B4 slot binder, its concrete-ETag fence and receipt/journal migration are not yet built. The release checklist in `TEST_REQUEST_FACTORY_CAST_AND_STATUS_PLAN_2026-09-28.md` §6 still applies, including a fresh section 13 run and classification at the time of the first slot PATCH.

No production record, reviewer slot, environment switch, or migration was changed in this review.
