# Expertise Roster Access for Power Automate

**Status: ON HOLD — awaiting Connor’s review (owner instruction, November 19, 2026).**

This is a discussion draft. Do not begin implementation, connector/authentication setup, or migration work until Connor has reviewed it and the owner directs the next step.
**Purpose:** Let Connor use the expertise roster in his existing proposal-processing Claude call without migrating Postgres data or adding another Claude call.

## Recommended approach

Keep Postgres as the roster’s source of truth. Add a small, authenticated, read-only API endpoint that Power Automate calls before Connor’s existing Claude request. The flow includes the returned roster alongside the proposal and its other instructions.

This adds a data-fetch request, **not another Claude call**. It does not require direct database access, a database migration, or a synchronized copy in Dataverse.

```text
Postgres expertise roster → Read-only roster API ─┐
                                                ├→ Existing Claude call → Proposal outputs + recommendations
Dataverse proposal → Existing Power Automate flow┘
```

The API and automation authentication described below are proposed work, not existing integration capabilities. Connor’s current licensing, tenant policies, and authentication setup still need to be confirmed.

## Responsibilities

| Owner | Work |
|---|---|
| App team | Build the read-only roster endpoint, configure authentication, document its response, and provide a sample response and test endpoint. |
| Connor | Fetch and parse the roster, include it in his existing Claude prompt, validate the returned recommendations, and incorporate them into his flow. |
| Power Platform / identity administrator, if needed | Confirm connector licensing and data policies; configure or approve API authentication and permissions. |

## 1. Agree on the roster data

Initially, return active **Research Program Staff** and **Consultants**, excluding Board members. Confirm which staff members are eligible to serve as lead PDs; roster membership alone should not imply eligibility.

Each person would include:

- Stable roster ID, name, role, and affiliation.
- Expertise description, primary fields, specialties, methods, and keywords where populated.
- A Dataverse identifier where an appropriate, verified mapping exists.

The app already stores these expertise attributes. The new endpoint would expose an agreed subset, excluding email addresses and unrelated fields unless Connor identifies a need for them.

**Identity decision:** use the roster ID in Claude’s output. Before writing an assignment to Dataverse, establish the correct mapping to that destination’s record type. A Dataverse Contact ID must not be assumed to be a staff/System User ID, and names should not serve as join keys.

## 2. App team builds one read-only endpoint

The endpoint would:

- Return both eligible groups in one response, ordered consistently by stable identifiers.
- Return a roster version that changes when the exported content changes.
- Permit only authenticated roster reads; expose no roster-write operations.
- Return a clear failure if roster retrieval is unavailable, rather than presenting an error as an empty roster.

The app team would provide Connor with the URL, authentication instructions, a sample JSON response, and a schema for Power Automate’s **Parse JSON** action.

Connor would not need Postgres credentials or SQL access. The existing application endpoint uses signed-in application access, so the integration needs automation-appropriate authentication rather than browser cookies.

## 3. Connor updates the flow

For each proposal—or once at the start of a proposal batch—Connor would:

1. Fetch the roster and parse the response.
2. Include the relevant roster information in the existing Claude request alongside the proposal and other processing instructions.
3. Request separate ranked recommendations for lead PDs and consultants, with roster IDs and brief explanations.
4. Validate that each returned roster ID belongs to the supplied eligible group. Reject unknown IDs or candidates from the wrong group.
5. Store or present the recommendations through the existing flow, retaining the request ID and roster version for traceability.

Claude should be allowed to return **“no suitable match.”** Initially, recommendations should support staff decisions rather than automatically assign people. Expertise matching alone does not establish availability, workload, or freedom from conflicts.

If roster retrieval fails, retry briefly and then flag the matching step as incomplete. Decide whether unrelated proposal-processing steps should continue; do not silently treat missing roster data as a valid matching result.

## 4. Preserve the existing caching strategy

Review Connor’s current prompt layout before changing it. The exported roster should have stable ordering and formatting, with no fresh retrieval timestamp embedded in the content sent to Claude. Keep operational metadata outside the cached prompt unless it is needed there.

- **Across different proposals:** common instructions and roster content can form a stable prefix before the proposal-specific content.
- **Repeated processing of the same proposal:** preserve Connor’s existing cached prefix where possible and choose the roster placement accordingly.
- **Across a batch:** fetching the roster once gives the batch a consistent snapshot. A later fetch picks up roster edits.

Cache reuse depends on exact prefix matching, model-specific minimum lengths, cache lifetime, and the API/provider Connor uses. Confirm actual reuse through the returned cache-usage information rather than assuming it from prompt structure. Adding the roster may increase input size even though it does not add a Claude call.

Reference: [Anthropic prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

## 5. Power Automate access and prerequisites

These are items to confirm, not additional access we have verified Connor lacks.

| Item | What to confirm | Likely owner |
|---|---|---|
| Flow editing | Connor can edit the relevant flow and create its connection in the intended Power Platform environment. | Connor / environment administrator |
| Connector licensing | The flow has the appropriate Premium entitlement for the selected HTTP or custom-connector approach. Microsoft lists HTTP with Microsoft Entra ID as Premium; confirm the applicable user or flow licensing. | Power Platform administrator |
| API authentication | Prefer an Entra-authenticated connection if supported by the tenant setup. Choose the exact connector and identity approach before building authentication; configure the API and grant only roster-read access. | App team + identity administrator |
| Consent and app registration | Confirm who can register/configure the API application and approve any permissions or consent required by the chosen connection method. | Identity administrator |
| Data policies | The roster connection, Dataverse connection, and Claude connection are allowed to exchange the required data under the environment’s policies. | Power Platform administrator |
| Operational ownership | Name the owner of the flow connection and the person responsible for maintaining authentication when staff or credentials change. | Connor + administrator |
| Existing data access | Confirm the flow’s existing Dataverse identity can read the proposal and, if needed, write recommendations to the agreed destination. The roster API does not grant those Dataverse permissions. | Connor / Dataverse administrator |

The goal is one narrow read permission, not database administrator access or broad application access. A reusable custom connector is optional; use the simplest approved connector that supports the selected authentication method.

References:

- [HTTP with Microsoft Entra ID connector and licensing](https://learn.microsoft.com/en-us/connectors/webcontents/)
- [Authenticate an API and custom connector with Microsoft Entra ID](https://learn.microsoft.com/en-us/connectors/custom-connectors/azure-active-directory-authentication)
- [Power Platform connector classification and data policies](https://learn.microsoft.com/en-us/power-platform/admin/dlp-connector-classification)

## 6. Pilot and acceptance criteria

Use a few proposals with familiar expertise requirements. Confirm:

- The authorized flow can retrieve the intended active roster; unauthorized requests are refused.
- Lead PD and consultant candidate groups reflect the agreed eligibility rules.
- Claude returns valid roster IDs and useful explanations, including a no-match result when appropriate.
- Existing notes or unrelated roster fields are not exposed unnecessarily.
- A roster edit appears on the next fetch and changes the exported roster version.
- A failed retrieval is visible and does not produce misleading recommendations.
- The flow makes only its existing Claude call, with the additional matching output included.
- Cache behavior is measured and consistent with Connor’s intended reuse pattern.
- Any Dataverse assignment mapping is verified before automated assignment is considered.

## Decisions to settle before implementation

1. Which staff members are eligible to serve as lead PDs?
2. Which expertise fields does Connor need, and how many recommendations per role should Claude return?
3. What connector and authentication method are approved in the target Power Platform environment?
4. Is the roster fetched per proposal or once per batch?
5. Where will recommendations be stored or presented, and which Dataverse identifiers are required there?
6. How is Connor currently arranging and measuring his Claude prompt cache?

Once these are settled, the first implementation can remain limited to one read-only endpoint and a small addition to Connor’s existing flow.
