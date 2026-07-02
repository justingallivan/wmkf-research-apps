---
title: "BILL.com Honorarium Integration — Claude Code Handoff"
domain: finance-honoraria
kind: history
status: active
summary: "The project was approved after an Ops Team review meeting (May 2026)."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
---

# BILL.com Honorarium Integration — Claude Code Handoff

## Project Overview

The W. M. Keck Foundation (WMKF) pays honoraria to external proposal reviewers via BILL.com. Currently, onboarding a reviewer into BILL requires manual staff effort across multiple emails after the reviewer has already accepted their invitation. This project integrates BILL.com's API into the existing reviewer portal so that payment setup is triggered automatically at the moment of acceptance — reducing friction for reviewers and eliminating manual work for staff.

The project was approved after an Ops Team review meeting (May 2026).

---

## Organization Context

- **Organization:** W. M. Keck Foundation (wmkeck.org)
- **Project lead:** Justin Gallivan, Program Director
- **Tech stack:** Next.js / Vercel frontend, Dynamics 365 / Dataverse backend, Power Automate for workflow triggers, Anthropic Claude API for AI-powered tools
- **Payment processor:** BILL.com (already in use by finance; API access needs to be confirmed)
- **Existing reviewer portal:** A Next.js app (App Router) already handles reviewer invitation, acceptance, and assignment — this integration hooks into the acceptance step

---

## The Problem Being Solved

When a reviewer accepts an invitation today:
1. Staff separately send BILL onboarding instructions (often days later)
2. There is no automated link between acceptance and payment setup
3. Reviewers unfamiliar with BILL require back-and-forth support

**Goal:** At the moment a reviewer clicks "Accept," the portal silently creates their vendor record in BILL and triggers the onboarding flow — so payment setup is a natural part of acceptance, not a separate task.

**Important:** Payment is not issued at acceptance. It is triggered later, after the reviewer submits their review and staff confirm the work is complete. The integration here covers only the *vendor onboarding* half of the flow.

---

## BILL.com API Capabilities (Researched)

### Authentication
All API calls require a session token obtained via:
```
POST https://gateway.bill.com/connect/v3/login
Headers: devKey: <BILL_DEV_KEY>
Body: { userName, password, orgId }
Returns: { sessionId }
```
Use `https://gateway.stage.bill.com/connect` for sandbox testing.

### Key API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /v3/vendors` | Create a vendor record for a reviewer |
| `GET /v3/network?email=...&scope=BILL` | Check if reviewer already has a BILL Network account |
| `POST /v3/network/invitation/vendor/{vendorId}` | Send network invitation (email or direct connect) |

### Vendor Creation Payload
```json
{
  "name": "First Last",
  "accountType": "PERSON",
  "email": "reviewer@university.edu",
  "phone": "...",
  "address": {
    "line1": "...",
    "city": "...",
    "zipOrPostalCode": "...",
    "country": "US"
  }
}
```
No payment/banking information is included — the reviewer provides that directly to BILL. WMKF never sees it.

### Network Invitation Logic
- If the reviewer **already has a BILL account** (found via network search): send a direct connection request with their `networkId`
- If they **don't have a BILL account**: send an email invitation (`networkType: "EMAIL"`) — BILL emails them a signup link

### Webhook
BILL fires a `vendor.updated` event when a reviewer completes their BILL setup and their `networkStatus` becomes `"CONNECTED"`. Use this to update the reviewer's status in your data store.

---

## Two Integration Options

### Option A — Email Invitation (recommended starting point)
- **Dev time:** ~1–2 days
- **How it works:** On acceptance, server-side Next.js API route runs three calls: create vendor → search network → send invitation or connect. BILL emails the reviewer separately.
- **Requires:** BILL API dev key + org credentials in environment variables

### Option B — BILL Elements Embedded Widget
- **Dev time:** ~3–5 days
- **How it works:** After acceptance, the portal's confirmation page embeds a BILL-hosted UI widget ("Vendor Setup Element") directly on the page. The reviewer completes payment setup without leaving the portal. No separate email needed.
- **Requires:** Administrator-level BILL account to generate Elements developer keys; more involved setup with BILL

**Recommendation:** Build Option A first. It proves the concept with minimal investment and can be upgraded to Option B later if the UX warrants it.

---

## Proposed Integration Flow (End-to-End)

```
1. ACCEPT       Reviewer clicks "Accept" in portal
2. TRIGGERED    Next.js API route fires server-side (reviewer never sees this)
                → POST /v3/vendors (create vendor record, save billVendorId)
                → GET /v3/network (check for existing account)
3. INVITED      If found: direct connect. If not: BILL sends invitation email.
4. CONNECTED    Reviewer follows link, sets up BILL account & payment method
                → Webhook fires → portal marks reviewer payment-ready
5. PAYMENT      (Later) Review submitted → confirmed complete → payment triggered
   ROUTED       by staff or automated signal
```

---

## Proposed Code Structure (Option A)

### Environment Variables Needed
```
BILL_DEV_KEY=
BILL_USERNAME=
BILL_PASSWORD=
BILL_ORG_ID=
BILL_BASE_URL=https://gateway.stage.bill.com/connect  # swap for prod
```

### `lib/bill.js` (server-side only)
Three functions:
- `getBillSession()` — authenticates, returns sessionId
- `createBillVendor(sessionId, reviewer)` — creates vendor, returns billVendorId
- `inviteReviewerToBill(sessionId, vendorId, email)` — searches network, sends invite or connects; returns `{ status: 'auto-connected' | 'invitation-sent' }`

### `app/api/reviewer/accept/route.js`
- Receives `{ reviewerId }` in POST body
- Fetches reviewer from Dataverse
- Calls the three BILL functions in sequence
- Saves `billVendorId` and `billStatus` back to the reviewer record in Dataverse
- **Important:** BILL errors should be caught and logged but must NOT block the acceptance flow — a BILL failure should not prevent a reviewer from accepting

### `app/api/webhooks/bill/route.js`
- Listens for `vendor.updated` events from BILL
- When `networkStatus === 'CONNECTED'`, marks reviewer as payment-ready in Dataverse
- Returns `{ received: true }`

---

## Dataverse Schema Changes Needed

Two new fields on the reviewer record:
- `billVendorId` (string) — the ID returned by `POST /v3/vendors`
- `billStatus` (string) — one of: `pending`, `invitation-sent`, `auto-connected`, `connected`

---

## Open Questions / Prerequisites (from Ops Team meeting)

1. **Does WMKF's existing BILL account have API access enabled?** API access requires a request to BILL — may take a few days to activate if not already on.
2. **Is there an Administrator-level BILL account available for development?** Required to generate developer keys (and required for Option B / Elements).
3. **Does IT or legal need to sign off** on connecting a financial platform (BILL) to the portal via API?
4. **Sandbox first:** Sign up at developer.bill.com before any development begins — test all API calls without touching real vendor records or payments.

---

## What Has NOT Been Built Yet

Everything described above is at the design/research stage. No code has been written. This document is the starting point for implementation.

The immediate next steps for Claude Code:
1. Confirm prerequisites above with Justin
2. Set up the sandbox BILL developer account
3. Scaffold `lib/bill.js` with the three helper functions
4. Wire the acceptance API route to call them
5. Add the two Dataverse fields
6. Set up the webhook endpoint and test end-to-end in sandbox
