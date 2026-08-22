# Microsoft Integration Requirements: SharePoint Access & Email Sending

**Prepared for:** IT Team Meeting — March 2026
**Context:** The WMKF internal tools suite (Next.js, deployed on Vercel) currently integrates with Dynamics 365 CRM via the Dataverse Web API using a dedicated Azure AD app registration with client credentials flow. We'd like to extend our Microsoft integration to cover two new capabilities.

---

## Current Azure AD Setup

| Component | Detail |
|-----------|--------|
| **User Authentication** | Azure AD (Entra ID) SSO via NextAuth.js |
| **Auth Scopes** | `openid email profile User.Read` (delegated) |
| **Dynamics CRM Access** | Separate app registration, client credentials flow |
| **Dynamics Scope** | `https://wmkf.crm.dynamics.com/.default` |
| **Deployment** | Vercel (server-side API routes, no desktop client) |

---

## Goal 1: Access SharePoint-Linked Documents from CRM Records

### The Problem

Dynamics CRM records contain document references (via the `annotation` entity and SharePoint document locations) that point to files stored in SharePoint. Our app can see the metadata (filename, size, type) but cannot retrieve the actual file content because we have no Microsoft Graph API access.

### What We Need

Access to the Microsoft Graph API to read files from the SharePoint sites that Dynamics links to.

### Permissions Required

| Permission | Type | Purpose |
|------------|------|---------|
| `Sites.Read.All` | Application | Read SharePoint site content |
| `Files.Read.All` | Application | Read file content and metadata |

- **Application permissions** (not delegated) are preferred so the server can access files without requiring an interactive user login on each request.
- If read-write access is ever needed (e.g., uploading generated reports back to SharePoint), the `.ReadWrite.All` variants would be required instead.

### Questions for IT

1. **Which SharePoint sites host CRM-linked documents?** We need the site URL(s) or site ID(s) to scope our queries.
2. **Can we add Graph permissions to the existing Dynamics app registration**, or should we create a separate one for Graph API access?
3. **Are there sensitivity labels, DLP policies, or Conditional Access policies** on these SharePoint libraries that might block server-to-server access?
4. **Is there a preferred pattern** for resolving Dynamics document locations to SharePoint paths? (e.g., `sharepointdocumentlocation` entity → SharePoint drive item)

### Technical Approach

Once permissions are granted:

1. Authenticate via client credentials: `https://graph.microsoft.com/.default`
2. Resolve the SharePoint site: `GET /sites/{site-id}`
3. Navigate to the document library: `GET /sites/{site-id}/drives`
4. Retrieve file content: `GET /drives/{drive-id}/items/{item-id}/content`

---

## Goal 2: Send Emails Programmatically

### The Problem

Our Reviewer Finder app generates invitation emails for potential grant reviewers. Currently it produces `.eml` files that staff must download, open in their email client, and manually send. We'd like to send these emails directly from the application.

### Option A: Dynamics 365 Email Activities (Recommended)

Send emails through the Dataverse API using the built-in email activity entity and `SendEmail` action. This is the simplest option since we already have a working Dynamics integration with an authenticated service principal.

**No new Azure AD permissions required** — this uses the existing Dynamics app registration and `{DYNAMICS_URL}/.default` scope. The service principal just needs the appropriate Dynamics security role.

**How it works:**

1. Create an email activity record:
   ```
   POST /api/data/v9.2/emails
   {
     "subject": "...",
     "description": "<html>email body</html>",
     "directioncode": true,
     "email_activity_parties": [
       { "participationtypemask": 1, "addressused": "sender@wmkeck.org" },
       { "participationtypemask": 2, "addressused": "recipient@example.com" }
     ]
   }
   ```

2. Send it via the `SendEmail` action:
   ```
   POST /api/data/v9.2/SendEmail
   { "EmailId": "{email-activity-id}", "IssueSend": true }
   ```

3. Server-Side Synchronization (already configured in Dynamics) delivers through Exchange Online.

**Advantages:**
- No new app registrations or Graph API permissions needed
- Emails are automatically tracked as CRM activities, visible to all staff on the relevant record
- Dynamics provides native status tracking (Sent, Delivered, Opened)
- Supports HTML body, attachments, CC/BCC
- Our app already generates the full email content — we'd replace `.eml` file creation with API calls

**Questions for IT:**

1. **Does our app's service principal have the `prvSendEmail` privilege?** This is typically part of an "Email Sender" or custom security role in Dynamics.
2. **Which mailbox or queue should outgoing emails route through?** Options:
   - A **shared mailbox/queue** (e.g., `grants@wmkeck.org`) — preferred, avoids tying emails to a specific person's account
   - A **service account mailbox**
3. **Is Server-Side Synchronization already configured** for that mailbox? (It likely is if your Dynamics instance already sends email.)
4. **Are there mail flow rules or transport policies** we should be aware of? (e.g., disclaimers, DLP, external recipient restrictions)

### Option B: Microsoft Graph Mail API

An alternative approach that bypasses Dynamics and sends directly through Exchange Online via Microsoft Graph.

| Permission | Type | Purpose |
|------------|------|---------|
| `Mail.Send` | Application | Send mail as a specified user or shared mailbox |

**How it works:**
- `POST /users/{user-or-mailbox}/sendMail` with the message payload
- Emails appear in the sender's Sent Items folder

**When to prefer this over Option A:**
- If the service principal cannot be granted email privileges in Dynamics
- If emails should NOT appear as CRM activities
- If sending from a mailbox not configured in Dynamics

**Additional requirements:**
- New or expanded Azure AD app registration with Graph API scope
- Admin consent for application-level `Mail.Send`
- Optional: [application access policy](https://learn.microsoft.com/en-us/graph/auth-limit-mailbox-access) to restrict which mailboxes the app can send from

### Option C: Dynamics 365 Customer Insights — Journeys

A marketing-oriented approach using Dynamics' email campaign capabilities.

**Pros:**
- Built-in open/click tracking and analytics
- Emails managed within the CRM ecosystem

**Cons:**
- More complex to implement
- May require additional licensing (Customer Insights — Journeys)
- Designed for marketing campaigns, less suited for transactional/one-off emails

**Question for IT:** Is Customer Insights — Journeys licensed and available in our Dynamics instance, or is the current email capability part of the base Dynamics 365 license?

---

## Summary of Requirements

### SharePoint Access (Graph API — new permissions needed)

| Permission | Type | Goal |
|------------|------|------|
| `Sites.Read.All` | Application | SharePoint site content access |
| `Files.Read.All` | Application | File content retrieval |

These are **application-level** permissions requiring **admin consent**. Can be scoped down to `Sites.Selected` if IT prefers per-site granular control.

### Email Sending (two paths — choose one)

| Approach | New Permissions? | Tracked in CRM? |
|----------|-----------------|-----------------|
| **Option A: Dynamics Email Activities** | No — just a Dynamics security role (`prvSendEmail`) | Yes, automatically |
| **Option B: Graph Mail API** | Yes — `Mail.Send` (application, admin consent) | No |

### Security Considerations

- The app runs on **Vercel** — credentials are stored as environment variables, never exposed to the client
- All API calls happen **server-side** in Next.js API routes
- If using Graph `Mail.Send`, we can scope it using an **application access policy** to restrict which mailboxes are accessible
- SharePoint access can use **`Sites.Selected`** instead of `Sites.Read.All` if IT prefers per-site control (requires IT to grant access via PowerShell or Graph API)

---

## Appendix: Application Access Policy for Graph Mail.Send

If using Option B (Graph Mail API) with the application-level `Mail.Send` permission, IT should configure an **application access policy** to restrict the app to only the designated sending mailbox. Without this policy, `Mail.Send` (application) grants the ability to send as *any* mailbox in the tenant.

### Prerequisites

- Exchange Online PowerShell module (`ExchangeOnlineManagement`)
- Exchange Administrator or Global Administrator role
- The app registration's **Client ID** (Application ID)
- A **mail-enabled security group** containing only the mailbox(es) the app should be allowed to send from

### Step 1: Install and Connect to Exchange Online PowerShell

```powershell
# Install the module (if not already installed)
Install-Module -Name ExchangeOnlineManagement

# Connect (will prompt for admin credentials)
Connect-ExchangeOnline
```

### Step 2: Create a Mail-Enabled Security Group

Create a security group that contains only the mailbox(es) the app is allowed to send from. This can also be done in the Microsoft 365 admin center.

```powershell
# Create the group
New-DistributionGroup -Name "WMKF App Email Senders" -Type Security -ManagedBy "admin@wmkeck.org"

# Add the designated sending mailbox
Add-DistributionGroupMember -Identity "WMKF App Email Senders" -Member "grants@wmkeck.org"
```

### Step 3: Create the Application Access Policy

This policy restricts the app so it can **only** access mailboxes in the security group.

```powershell
New-ApplicationAccessPolicy `
  -AppId "<your-app-client-id>" `
  -PolicyScopeGroupId "WMKF App Email Senders" `
  -AccessRight RestrictAccess `
  -Description "Restrict WMKF tools app to send only from grants mailbox"
```

### Step 4: Verify the Policy

Test that the app can access the allowed mailbox and is denied access to others.

```powershell
# Should return: "Granted"
Test-ApplicationAccessPolicy `
  -Identity "grants@wmkeck.org" `
  -AppId "<your-app-client-id>"

# Should return: "Denied"
Test-ApplicationAccessPolicy `
  -Identity "someother@wmkeck.org" `
  -AppId "<your-app-client-id>"
```

### Notes

- Policies can take **up to 30 minutes** to propagate after creation.
- To view existing policies: `Get-ApplicationAccessPolicy`
- To remove a policy: `Remove-ApplicationAccessPolicy -Identity "<policy-id>"`
- Multiple mailboxes can be added to the security group if the app needs to send from more than one address.
- This policy affects **all Graph API mail operations** for the app, not just `Mail.Send` — it also restricts `Mail.Read`, `Mail.ReadWrite`, etc. if those are ever added.

---

## Next Steps

1. IT reviews requirements and decides:
   - **SharePoint:** Approve Graph permissions (`Sites.Read.All` or `Sites.Selected` + `Files.Read.All`)
   - **Email:** Choose between Dynamics email activities (Option A) or Graph Mail API (Option B)
2. For SharePoint: extend existing Dynamics app registration for Graph, or create a separate one
3. For email Option A: grant `prvSendEmail` security role to the app's service principal in Dynamics
4. For email Option B: grant admin consent for `Mail.Send` on the app registration
5. Provide us with:
   - SharePoint site URL(s) for CRM-linked documents
   - Designated sending mailbox or queue address
   - Any scoping restrictions or mail flow policies
6. We implement and test in development before production deployment
