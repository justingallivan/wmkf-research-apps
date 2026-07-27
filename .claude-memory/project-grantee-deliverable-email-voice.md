---
name: project-grantee-deliverable-email-voice
description: Current grantee invite/reminder email voice and live reminder template; both send from the named Program Director.
metadata:
  type: project
  status: active
  scope: global
  last_verified: 2026-07-27 via source trace, production settings probe, and owner-authorized body update
---

## Recall Rule

Read this when drafting/defaulting the grantee-deliverables invitation or reminder
email copy (`email.grantee_invite.*`, AwardeeTab fill behavior, or
`email.grantee_reminder.*`) or
the publish-image waiver wording.

## The facts (owner, S271)

- **Owner voice requirement:** the emails should read as coming from the named
  Program Director, not a generic Foundation sender. The invite uses the
  authenticated staff sender. The reminder requires the request's assigned PD
  systemuser, name, and email and sends with `noFallback:true`; if those cannot
  be resolved, it skips rather than sending from the service principal.
- **Signature fallback is narrower than the ideal example.** A saved signature
  may contain the PD's title. Without one, `resolveSignatureForRequest` produces
  the PD name plus `W. M. Keck Foundation`; if request/PD resolution fails, the
  body fallback can be Foundation-only. Source does not synthesize a title.
  Never accept sender identity from the grantee/client.
- **Invite salutation/structure (owner example, S271):** the original example used
  "Dear Professor [Name]:" (not "Dr.") and this sequence:
  1. Congratulations on the recent W. M. Keck Foundation grant.
  2. "We plan to post an abstract on the Foundation's website describing your award
     entitled '[title]'."
  3. Review-by-deadline with **implied concurrence**: "Please review … and let me
     know if you have any changes no later than COB [date]. If we have not heard
     from you by this date, we will assume that we have your concurrence to post the
     draft abstract on our website."
  4. Encourage a high-resolution project image (now handled IN the portal — the
     email points to the secure link instead of repeating format/caption/release
     mechanics, which the new interface subsumes).
  5. **Acknowledgment-of-support reminder** (KEEP — not subsumed by the portal):
     "in your application you and your institution agreed to acknowledge the
     Foundation's support … Please recognize the 'W. M. Keck Foundation' in
     publications and other scientific work related to this award, such as
     presentations and posters."
  6. "Please do not hesitate to contact me if you need additional information."
  7. The owner example ended with "Thank you," + PD name + title. The shipped
     invite default later removed that body closing to avoid colliding with the
     PD's saved Outlook signature; do not restore it to the invite by analogy.
- **Deadline model:** there IS a hard deadline
  (COB a named date) and **non-response = implied consent to post the draft**.
- **Approved abstract-provenance line (owner edit S271):** "The draft abstract is
  based on information you provided in your proposal, lightly edited to conform to
  the style that the Foundation uses in its publications." (Replaces the earlier
  "…with your Phase II proposal" phrasing — drop "Phase II" and "below".)
- **Image format/caption/release paragraphs are REMOVED from the email** — the
  portal interface now collects the image, caption+credit, and the publish
  permission (the waiver checkbox IS the release form).

## Current shipped reminder (verified 2026-07-27)

The automatic reminder is built and deployed. It runs daily, selects packages
still `Invited` at day 12, and uses invite-date + 14 days as the COB deadline.
It sends from the assigned PD to the PI and Cc's the liaison.

The live `email.grantee_reminder.subject/body` rows match
`lib/seed/email-defaults/grantee-reminder.js`. Current wording uses
`Dear Professor {{granteeName}},` (comma), a concise follow-up, the secure link,
the day-14 deadline/implied-concurrence sentence, the no-action-needed sentence,
the contact invitation, and `Thank you,` before `{{signature}}`. The owner
authorized restoring `Thank you,` on 2026-07-27. Do not copy the longer invite
sequence into the reminder unless the owner requests a reminder-copy change.

At verification time, all three production package rows were `Drafted`; the
probe found zero eligible rows and no evidence of successful live delivery.

**Why:** stakeholder/grantee emails in the Foundation's real voice are personal,
PD-signed, and deadline-driven; a generic Foundation sign-off and portal mechanics
in the body read wrong to a grantee. **How to apply:** preserve the editable
`email.grantee_invite.*` defaults and `fillInviteBody` placeholder behavior in the
PD-voice structure above; keep the message staff-editable. Related:
[[feedback-stakeholder-email-tone]].
