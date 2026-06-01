---
name: project-dataverse-odata-null-filter
description: Dataverse OData $filter drops rows whose expression evaluates to null, so `field ne X` silently EXCLUDES null-valued rows — use `(field eq null or field ne X)` for any nullable field.
metadata:
  type: project
---

**Dataverse Web API `$filter` omits any row whose expression evaluates to `null`** (not just `false`) — per the MS "Filter rows" doc: "The response includes only records where the expression evaluates to `true`. Records aren't included if the expression evaluates to `false` or `null`."

Consequence: for a **nullable** field, `field ne X` evaluates to `null` when the field itself is null (three-valued logic), so those rows are **silently dropped**. A bare `wmkf_applicantdisposition ne 100000001` would hide EVERY null-disposition row — which is the *normal* case, not the exception. This is a footgun: the query looks correct and returns plausible (but undercounted) results.

**Fix — always null-guard a `ne` on a nullable field:** `(field eq null or field ne X)`.

Live precedent in this repo:
- `notExcludedFilter()` in `lib/dataverse/adapters/reviewer-suggestion.js` → `(wmkf_applicantdisposition eq null or wmkf_applicantdisposition ne 100000001)` (S208).
- `reviewer-suggestion-sweep.js` predates it: `(wmkf_accepted eq false or wmkf_accepted eq null)` instead of `ne true` — same workaround for a nullable boolean.

Caught in S208 Phase 0 pre-impl: the build plan's casual "add `disposition ne excluded` belt-and-suspenders" would have been a regression that dropped all normal candidates from counts/lists. Verify nullable-field `ne`/`eq false` filters before shipping. Applies to `$apply=filter(...)` aggregates too. See [[project-dataverse-schema-deploy-gotchas]].
