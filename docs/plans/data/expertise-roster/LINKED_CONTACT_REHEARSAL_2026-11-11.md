# Linked-Contact browser rehearsal

[VERIFIED via the coordinating session's real authenticated browser walkthrough,
private `browser-linked-contact-20261111/result.json` and `contact-verification.json`]
Normal Microsoft SSO reached the synthetic Consultant editor. Linking the approved
existing active Contact, saving, reloading and displaying its primary email passed;
manual preferred email was unavailable while linked. Reactivating and deactivating
only the roster canary passed, followed by unlinking and restoring its managed values.
No Contact or User was created, edited, activated or deactivated.

The complete census retained 46 profiles. All 45 non-canary profiles were unchanged;
the canary's managed values were restored with native attribution to the signed-in
operator. Exact Contact fields and ETag were unchanged and zero roster links to that
Contact remained. Cleanup removed the owned fixture and preserved public SQL.
No inference, message, shared-storage write or Production mutation was part of this run.

The strict attachment resolver correction is source-built: both resolved-parent and
complete-result flags are mandatory at the governed attachment call, and resolver
errors become `folder_unavailable` 503 before Graph ensure/upload. Opus returned READY;
the build, types, DAL and request-document-writer gates and their self-tests passed.
The final focused run passed 77 tests across three suites: 29 attachment,
12 controlled matching and 36 linked-service tests, without live inference.
See the [exact review](REMAINING_CHECKS_BUILD_OPUS_5_5_REVIEW_2026-11-11.md).

Actual shared-storage attachments remain pending exact fixture/store/folder approval,
including named Blob usage. Live model execution remains pending named model/spend
authorization. User lifecycle and inactive/missing Contact refusals remain controlled
test evidence, not live people mutations. Public cutover/deployment admission is
separate. See the [remaining plan](REMAINING_FLOW_REHEARSAL_2026-11-11.md).
