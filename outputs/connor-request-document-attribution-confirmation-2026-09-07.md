# Request Document attribution — confirmation only

**Send on:** Monday, September 7, 2026
**Requested Dataverse changes:** None

## Suggested message

**Subject:** Request Document attribution — confirmation only, no role change

Hi Connor,

We revisited a draft request from August 27 about adding Create, Write, and
Append privileges for `wmkf_requestdocument` to the broad staff role. I never
sent that request, and it is withdrawn. Please do not make that privilege or
role change.

Our proposed direction is to keep Request Document writes under the application
service principal and store the authenticated staff actor and action time in
explicit application-controlled fields or event records.

Before we implement that design, can you confirm whether WMKF has either of the
following?

1. A compliance, audit, or CRM-reporting requirement that user-initiated
   Request Document operations show the individual staff member in Dataverse's
   built-in **Created By** or **Modified By** fields; or
2. An existing report, view, Power Automate flow, business rule, or plug-in that
   relies on those built-in Request Document actor fields.

If yes, please identify the exact requirement or consumer so we can design
around it before changing anything. If no, there is no action needed from you.

Thanks,

Justin

## Response handling

- **No requirement or consumer:** proceed with the explicit-actor design; no
  Connor action and no staff-role privilege change.
- **Requirement or consumer exists:** record the exact requirement and consumer
  before revisiting architecture. Do not treat the answer as authorization to
  add privileges.
