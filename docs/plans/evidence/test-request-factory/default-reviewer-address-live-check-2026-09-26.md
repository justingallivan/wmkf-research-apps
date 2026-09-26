# Default reviewer address live check (sandbox Request 1000346, 2026-09-26)

Acceptance check for PR #343 (owner decision 2026-09-26, Session 544: reviewer addresses are never minted; a flagless reviewer takes `TEST_REQUEST_DEFAULT_REVIEWER_ADDRESS` plus-tagged per source reviewer). Source production Request 1003222, bundle v3 exported by the owner at 2026-09-26 ~19:31Z (`--with-reviewers --source-marker-column=absent`, D-R5 read scope); its three reviewers are non-synthetic, so all three took the default. `SYNTHETIC_REVIEWER_ISOLATION=on`; the default was read from `.env.local`. No address appears in any command output or in this record.

**Proof run `c1287577-c4b6-4c18-b453-bcd0d52a3360`**, reserved with no `--reviewer-address` flags: three assignments, each matching `^[^+@]+\+[0-9a-f]{12}@`, `reused: false`. Advanced with `--bypass-goverify` to `ready` in one invocation through all eighteen steps (sandbox Request 1000346). `seed_reviewers` created the three persons with plus-tagged `wmkf_emailaddress` values and `verify_reviews` passed, so the column accepts `+` [VERIFIED live; closes the design doc's ASSUMED]. GOverify's real-time workflow read back Activated afterwards (22:29:48Z).

**Reuse run `ddc0b4f9-45b2-4efd-a61d-88846d94827f`**, a second flagless reservation of the same bundle: all three assignments `reused: true`, the same three destination persons (`a53c4c75…`, `b269662d…`, `1bb03b0c…`) and the same address digests as the proof run. Left `prepared`, never advanced.

**Two stranded runs, `be486c6d-55fe-4f0c-b9f2-5ce587a2abf5` and `fe84d2fb-5152-4c89-be3d-25834090f0d5`**: advanced without `--bypass-goverify` (operator error), so GOverify rejected the create (400 `0x80040265`, "remote server returned (500)"). No Request was created; both are `needs_attention` at `create_request` and refuse any re-POST, as designed. First candidates for item 7's retire path with `ddc0b4f9…`.

Residue: sandbox Request 1000346 with its Initial Assessment, three marker-true synthetic persons (plus-tagged owner addresses), their suggestions and answer rows; four local-ledger runs (one `ready`, one `prepared`, two `needs_attention`). Nothing was written to production.

Not exercised: delivery of `+tag` mail to the owner's inbox (6d).
