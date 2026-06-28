[HIGH] Approve/reject writes are not concurrency-safe
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` §5 lines 139-168; `lib/services/dynamics-service.js` lines 806-820; `docs/REVIEWER_STAGE_2A_BUILD_PLAN.md` lines 299-301.
The plan handles sequential double-submit idempotency, but it does not require `If-Match`/ETag optimistic locking, so two staff can read `requested` and race approve vs. reject with last-writer-wins semantics.
Require the GET/list response to carry the row ETag and have approve/reject pass it to `DynamicsService.updateRecord(..., { ifMatch, actingUserSystemId })`, returning/recovering from 412 conflicts the way the Stage 2a plan does.

[HIGH] Literal app registry snippet does not match the actual registry shape
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` §3 lines 56-67; `shared/config/appRegistry.js` lines 8-159; `shared/components/Layout.js` lines 47-50.
The plan shows a keyed object with `route` and singular `category`, but the live registry is an array of objects using `href` and `categories`, and Layout reads `app.href`.
Change the plan snippet to an array element with `href: '/apply/admin'` and `categories: ['admin']` so the nav link and `ALL_APP_KEYS` registration work as intended.

[MODERATE] Staff-without-grant page path is not a 403 as described
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` §4 lines 102-105 and §8 line 234; `shared/components/RequireAppAccess.js` lines 25-63; `lib/utils/auth.js` lines 245-312.
For `/apply/admin/memberships` as a page route, middleware will pass a staff JWT and the client guard renders an "Access Not Available" page, while only the API routes protected by `requireAppAccess` return HTTP 403.
Update the verification language to distinguish page denial from API denial, or add a server-side page guard if the requirement is a true 403 for the page route.

[MODERATE] Intake audit logging requirement is omitted
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` §5 lines 145-168 and §9 line 250; `docs/INTAKE_PORTAL_DESIGN.md` lines 529-531; `lib/services/intake-audit-service.js` lines 1-15; `lib/db/migrations/005_intake_portal.sql` lines 41-58.
The build plan relies on Dataverse audit visibility, but the predecessor design and existing `IntakeAuditService` say every state-changing portal action, including membership approve/reject, writes an `intake_audit` row.
Add explicit non-blocking `IntakeAuditService.log` calls for `membership.approve` and `membership.reject`, with staff `azureId`, target `wmkf_portal_membership`, payload digest, and request metadata.

[MODERATE] Rejected re-application contract is underspecified
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` §2 line 50 and §5 lines 142-149, 157-166; `docs/INTAKE_PORTAL_DESIGN.md` lines 117 and 202-203.
The plan correctly says the `(contact, account)` alternate key forces re-application to reuse the existing row, but the admin slice only says "the next applicant action updates this same row" without specifying the reset from `rejected` back to `requested`.
Add a cross-slice contract for the applicant claim flow: upsert by alternate key, set `wmkf_approvalstatus='requested'`, refresh `requestedby/requestedat`, clear stale rejection fields as appropriate, and avoid treating direct admin approval from the Rejected tab as the only re-apply path.

[MODERATE] Approver field reuse changes the schema semantics without a named downstream contract
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` §2 lines 45-47 and §5 lines 161-165; `docs/INTAKE_PORTAL_DESIGN.md` lines 112-114 and 556-558.
The predecessor schema calls `_wmkf_approvedby_value` a "staff approver" field, while the plan reuses it as either approved-by or rejected-by and `wmkf_approvedat` as decided-at.
Either document the renamed semantic contract for PA/reporting as "decided by/at" or add explicit rejected-by/rejected-at fields before entity creation if reports or flows need disposition-specific names.

[MODERATE] Impersonation can silently not fire if no systemuser mapping exists
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` §5 line 112 and §8 line 236; `lib/services/dataverse-identity-map.js` lines 70-74; `lib/services/dynamics-service.js` lines 166-170; `pages/api/auth/[...nextauth].js` lines 238-254 and 283-291.
The plan says write paths derive a staff `systemuserid` and pass it so `MSCRMCallerID` fires, but the resolver can return null and `DynamicsService` simply omits the header when no `actingUserSystemId` is present.
Make approve/reject fail closed with a clear 403/500 if the staff profile cannot resolve to a Dynamics systemuser, or explicitly accept service-principal attribution and adjust the verification expectations.

[LOW] Middleware prefix match is broader than the intended admin route family
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` §4 lines 86-95; `middleware.js` lines 100-107.
`pathname.startsWith('/apply/admin')` and `startsWith('/api/apply/admin')` also match sibling prefixes such as `/apply/administrator`, which would be treated as staff-only instead of applicant-surface.
Use exact-or-slash prefix checks such as `pathname === '/apply/admin' || pathname.startsWith('/apply/admin/')` and the equivalent API check.

[LOW] Applicant-session admin-route result is probably a middleware redirect, not a route-level 403
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` §4 lines 89-95 and 102-104; `middleware.js` lines 81-117; `pages/api/auth/[...nextauth].js` lines 16-18.
Returning `false` from `withAuth`'s `authorized` callback rejects the request before the page/API handler runs, so an applicant hitting `/apply/admin/memberships` should be expected to get the configured sign-in redirect rather than a `requireAppAccess` 403.
Keep the verification wording as "middleware redirect/reject" for applicant sessions and reserve "403" for API calls that actually reach `requireAppAccess`.

[LOW] Lookup write notation could lead to an invalid Dataverse PATCH
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` §5 lines 145-149 and 161-165; `lib/services/dynamics-service.js` lines 768-770.
The side-effect table says to set `_wmkf_approvedby_value` directly, but Dataverse Web API lookup writes normally use the navigation-property `@odata.bind` payload rather than the read-only lookup shadow field.
Name the actual bind key in the plan once the relationship schema exists, while keeping `_wmkf_approvedby_value` only as the read/select field.

[LOW] Build slice table lists CI-gated docs too late for incremental commits
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` §7 lines 217-226; `scripts/check-api-route-security-matrix.js` lines 67-95; `docs/API_ROUTE_SECURITY_MATRIX.md` line 155.
The note says slices 6 and 7 must land in the same commit as underlying code, but the numbered table places them after all API/UI work, which conflicts with the stated one-PR-sized-commit workflow.
Fold the Atlas update into slice 0/schema creation and the route-matrix rows into the exact commits that add the GET, approve, and reject route files, or rename slices 6/7 as per-commit checklist gates rather than later slices.

[LOW] Missing prior-art context file
Requested context path `pages/api/apply/`; repo directory listing under `pages/api` shows no `apply` directory.
The review could not compare against `pages/api/apply/` conventions because that directory is absent in this workspace.
Do not infer an apply-specific convention from missing files; use the existing API conventions from `pages/api/cron/`, `requireAppAccess`, and comparable route plans.

[NIT] Method handling is not stated for the new API endpoints
`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` §5 lines 114-168; `pages/api/cron/reconcile-identities.js` lines 21-24.
The endpoint specs describe GET/POST behavior but do not explicitly say unsupported methods return 405, while existing API routes check methods early.
Add one sentence that each route rejects unsupported methods with 405 before doing Dataverse work.

## Specific Question Answers

1. The middleware carve-out works for the broad session split only if it is inserted before the current applicant check, as the plan says in §4 lines 83-98. For `applicant-session-hits-staff-admin-route`, `isStaffAdminSurface` is true, `token.userType === 'applicant'` returns false from `authorized`, and `withAuth` should reject before the page/API handler, most likely via the configured `/auth/signin` redirect rather than a route-level 403. For `staff-session-without-grant`, middleware returns `!!token.azureId`, so the request reaches the page/API layer; the API path gets a 403 from `requireAppAccess`, but the page path renders the client-side `RequireAppAccess` denial UI rather than returning HTTP 403. The prefix check should also be narrowed to exact-or-slash matching.

2. Slice 0 must happen before anything that reads/writes `wmkf_portal_membership`, so 0 before 1-5 is correct. Slice 1 can build routing and an empty skeleton without API, and slices 2 then 3 then 4 then 5 are logically ordered. The caveat is slices 6 and 7 are not really later functional slices: route-matrix entries must land with the API files that trigger `check:api-routes`, and the Atlas page belongs with the schema/entity creation commit if the Atlas gate observes the new entity.

3. The alternate-key behavior is correctly characterized by the design doc: one row per `(contact, account)` regardless of approval state, and re-applying after rejection updates the existing row rather than creating a duplicate. The plan says rejected rows stay active and the next applicant action updates the same row, which is the right model, but it does not specify the applicant-side reset back to `requested`. A previously rejected applicant should hit an upsert/update path that refreshes `requestedby/requestedat`, sets status to `requested`, and handles stale rejection/decision fields deliberately. That contract should be written down because this admin slice is being built before the applicant flow.

4. I found no text showing that `_wmkf_approvedby_value` or `wmkf_approvedat` is load-bearing for an existing PA flow or report. The only explicit PA contract in the predecessor design is that Connor's existing flows are origin-agnostic on the `'Phase II Pending'` flip, while membership approval workflow is portal-side. The reuse is still semantically risky because the schema labels the field as staff approver, and reports could later misread rejected rows as "approved by." Treat the fields as disposition-by/at in docs and reporting, or add rejected-specific fields before schema deployment.

5. Sequential idempotency is partially covered: already-approved approve returns 200, and already-rejected reject is intended to be idempotent. The endpoints are not safe against concurrent staff decisions as written because there is no ETag/`If-Match` guard or transaction around the read-then-PATCH. Concurrent approve/reject can both validate a `requested` row and the later PATCH wins, while concurrent same-action submits can re-stamp decision fields. Use Dataverse optimistic locking and return/recover from 412 conflicts.

6. The "same-commit gates" idea is right, but their placement as slices 6 and 7 is misleading. `check:api-routes` fails when new `pages/api/**/*.js` files are missing from `docs/API_ROUTE_SECURITY_MATRIX.md`, so those rows must be committed with slices 2, 3, and 4 as the files appear. The Atlas update should travel with the schema/entity creation pre-req, not after the admin UI, if `wmkf_portal_membership` is live or referenced by Atlas checks. Keep them as gates, not deferred cleanup slices.

7. I do not see a missing CSRF/origin protection for the API writes if the endpoints use `requireAppAccess` exactly as planned. `requireAppAccess` runs `validateOrigin` for POST/PUT/PATCH/DELETE before returning access, rejecting cookie-bearing state-changing requests with missing or mismatched Origin/Referer. The implementation should call `requireAppAccess` before any streaming/body side effects, matching the convention noted in `pages/api/virtual-review-panel.js`. No extra CSRF token appears necessary under the current helper contract.

8. Treating `wmkf_portal_membership` creation as slice 0/out of scope for this admin build is reasonable because the predecessor design says the shape is approved and the schema deploy is under delegated authority. It is still a hard prerequisite, not optional background work: the admin page cannot exercise real GET/approve/reject without the entity, relationship names, alternate key, and choice values existing. The plan should tie the Atlas/catalog update and exact lookup bind names to that schema-deploy step. That keeps this build focused while avoiding code against a guessed Dataverse shape.
