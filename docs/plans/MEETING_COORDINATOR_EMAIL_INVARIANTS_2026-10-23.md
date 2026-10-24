# Coordinator materials email guardrails

Change surface: applicant-materials invitation/reminder previews and manual dispatch. Entry points: Meeting Tracker materials route and email modal. Persistence: existing collection/reminder receipts and Dynamics email activities; no new schema. Consumers: applicant contributor context, manual staff UI, callable retired reminder sweep. Prior accepted finding: request-field/clicker sender mismatched the Shared Admin Program Coordinator assignment.

| Invariant | Surfaces | Verification |
|---|---|---|
| Helpers may prepare/review; only the authenticated assigned Coordinator sends | Route → collection service → transport, modal capability | A helper's valid signed preview cannot mint a link, insert a collection, claim or dispatch |
| Assignment is Shared Admin-owned | Shared coordinator resolver, contributor contact and template names | Divergent request coordinator does not change the sender/contact; inactive or unavailable configuration refuses |
| Preview freezes actor, coordinator revision/mailbox and rendered signature | Signed digest, prepared snapshot, actual create/send checks | Role/profile/mailbox/signature drift rejects; a change after activity creation leaves an unsent draft |
| No fallback sender at either email boundary | Dynamics create and SendEmail | Both receive `noFallback: true` and the authenticated Coordinator identity |
| Automatic reminders remain retired | Default sweep sender resolver | Even a creator with an enabled mailbox cannot trigger a claim or delivery; no schedule added |
| Existing recipient and partial outcome contracts survive | Applicant contacts, receipts, uncertainty classification | Institution Liaison stays authoritative; definite pre-dispatch refusal and uncertain network outcomes remain distinct |

[PLANNED] Production behavior requires deliberate branch promotion. This implementation sends no real email during verification. Existing at-most-once manual reminder claims are retained: a later refusal does not undo the claim. An activity created before a staffing/signature change remains a Dynamics draft and is not dispatched.
