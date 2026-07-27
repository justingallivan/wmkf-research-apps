/**
 * Guide Content - Structured content for the in-app /guide page.
 *
 * Each section has a key (used as the URL hash), display metadata,
 * and markdown-ish content rendered as React elements in pages/guide.js.
 */

export const GUIDE_SECTIONS = [
  {
    key: 'getting-started',
    title: 'Getting Started',
    icon: '🚀',
    appKey: null, // always visible
    sections: [
      {
        heading: 'Signing In',
        content: `The suite uses your organization's Microsoft account. Navigate to the application URL, click Sign In, and authenticate with your organizational credentials. You'll be redirected back to the home page.`,
      },
      {
        heading: 'Home Page',
        content: `After signing in, you'll see cards for each application you have access to. Apps are organized into categories: Concepts, Phase I, Phase II, and Other. Click any card to open that app.`,
      },
      {
        heading: 'Default Access',
        content: `New users start with limited access. An administrator will grant you access to the applications you need from the Admin dashboard. To request access, email jgallivan@wmkeck.org.`,
      },
      {
        heading: 'Navigation',
        content: `The top navigation bar lists all apps you can access. On mobile, tap the hamburger menu to see the full list. Your user avatar in the top-right opens profile settings and sign-out.`,
      },
    ],
  },
  {
    key: 'reviewers',
    title: 'Request Workbench',
    icon: '🗂️',
    appKey: 'reviewers',
    sections: [
      {
        heading: 'Overview',
        content: `The Request Workbench is the per-request home for managing peer review. It consolidates what the Reviewer Finder and Review Manager did into one request-scoped workspace, opened from a cycle dashboard of your assigned requests. (Rolling out in phases — some panels arrive in later updates.)`,
      },
      {
        heading: 'Cycle Dashboard',
        content: `Pick a grant cycle to see the requests you are Program Director on, each with a cue showing what work remains (reviewers to find, invitations to send, reviews still pending or to read). Choose My to see only your requests or All to see the whole cycle. Click a request to open its Workbench.`,
      },
      {
        heading: 'Reviewers Tab',
        content: `Inside a request, the Reviewers tab brings together finding candidates, inviting them, tracking responses, and marking reviews complete. Applicant-recommended and applicant-excluded reviewers are surfaced and badged so you can see them on equal footing with candidates Claude discovers.`,
      },
    ],
  },
  {
    key: 'integrity-screener',
    title: 'Integrity Screener',
    icon: '🔍',
    appKey: 'integrity-screener',
    sections: [
      {
        heading: 'Overview',
        content: `Screen grant applicants for research integrity concerns by searching the locally loaded Retraction Watch records, PubPeer (post-publication peer review), and Google News (media coverage of misconduct).`,
      },
      {
        heading: 'Running a Screening',
        content: `Enter applicant names (one per line), then click Screen Applicants. Results stream in as each source is checked. Each applicant gets a results card with match counts, confidence values, and source-specific details; PubPeer and news may include AI-written source summaries.`,
      },
      {
        heading: 'Understanding Confidence Levels',
        content: `High = exact or near-exact name match with corroborating evidence. Medium = partial match or common name with some supporting context. Low = weak match that may be a different person.`,
      },
      {
        heading: 'Dismissing False Positives',
        content: `The current Dismiss button is a placeholder: it does not yet save a durable dismissal or suppress the match in a later screening. Record adjudication outside the screener until that workflow is completed.`,
      },
      {
        heading: 'History & Export',
        content: `The current page has no History tab, although authenticated history APIs exist. PDF, JSON, and Markdown exports cover the current run, including matches, confidence values, and available PubPeer/news summaries; they do not include dismissal records.`,
      },
      {
        heading: 'Important Caveats',
        items: [
          'Common names may produce false positives — always review matches carefully',
          'A clean screening does not guarantee no issues exist',
          'Retractions can happen for honest errors, not just misconduct — read the notice',
          'Use results as a starting point for further investigation, not a final determination',
        ],
      },
    ],
  },
  {
    key: 'dynamics-explorer',
    title: 'Dynamics Explorer',
    icon: '💬',
    appKey: 'dynamics-explorer',
    sections: [
      {
        heading: 'Overview',
        content: `Query your Dynamics 365 CRM using natural language. The AI translates your questions into CRM queries, executes them, and presents results in a readable format.`,
      },
      {
        heading: 'What You Can Ask',
        content: `Find records ("Find all requests from Stanford"), search by content ("Search for proposals about fungi"), count and summarize ("How many active requests?"), and explore relationships ("Who are the contacts for request 1001289?").`,
      },
      {
        heading: 'Multi-Turn Conversations',
        content: `The chat sends up to three recent user/assistant exchanges (six messages) as context. Follow-ups can refine recent results, but older turns fall outside that active window.`,
      },
      {
        heading: 'Exporting Data',
        content: `Click Export Chat to download the conversation with all query results. Tables in results can be copied to clipboard for pasting into spreadsheets.`,
      },
      {
        heading: 'Tips',
        items: [
          'Be specific — "Find requests from Stanford" works better than "Show me some university requests"',
          'Ask "What tables are available?" or "What fields does the request table have?" to explore the schema',
          'Natural dates work — "Requests from last month", "Proposals submitted before January 2024"',
          'If a search returns too many results, add qualifiers: time range, institution, status',
        ],
      },
    ],
  },
  {
    key: 'admin',
    title: 'Administration',
    icon: '⚙️',
    appKey: null, // visibility controlled by isSuperuser check
    adminOnly: true,
    sections: [
      {
        heading: 'Dashboard Overview',
        content: `The Admin dashboard at /admin provides system health monitoring, usage analytics, role management, app access control, and model configuration. Restricted to superusers.`,
      },
      {
        heading: 'Managing User Access',
        content: `Go to Admin → App Access to see a grid of users and apps. Check or uncheck boxes to grant or revoke access, then click Save. New users start with limited access and need to be granted apps manually.`,
      },
      {
        heading: 'Model Configuration',
        content: `Each app uses a default AI model. Override it from Admin → Models by selecting a different model from the dropdown. Overrides take effect immediately and persist in the database.`,
      },
      {
        heading: 'Health Monitoring',
        content: `The health panel checks Database, Claude API, Azure AD, Dynamics CRM, and Encryption status. A red indicator means the service is unreachable — check environment variables and service status.`,
      },
      {
        heading: 'Adding a New User',
        content: `New users are auto-provisioned on first Azure AD sign-in. Ask them to sign in once (creates their profile), then go to Admin → App Access to grant the apps they need.`,
      },
    ],
  },
];
