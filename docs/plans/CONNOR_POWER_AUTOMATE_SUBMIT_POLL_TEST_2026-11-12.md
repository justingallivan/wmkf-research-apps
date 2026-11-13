# Connor: Power Automate submission and polling test

This is a manual Sandbox test, entirely in Power Automate. No Node or repository access is needed. Your earlier `404 machine_job_not_found` confirmed authentication. This test submits the **same completed Short Title job**, then reads its status through a bounded polling loop. It should make no new AI call or Dataverse write.

The sandbox allows only one job, which has already completed. Keep the exact identifiers and idempotency key below. This proves Power Automate submission/replay and status handling; it does not demonstrate a fresh job progressing from queued to running. The worker is unscheduled and this test needs no worker ticks.

Run before **November 18, 2026 at 19:30 UTC**. Justin supplies the temporary app secret and deployment cookie through the same approved recipient-restricted password manager or encrypted channel used for the first test. If either was revoked after that test, ask Justin for renewed access before running. Never send either value in email, chat, screenshots or a flow export.

## 1. Create the flow and configure authentication

Create an **Instant cloud flow**, named `WMKF Sandbox Submit and Poll`, with **Manually trigger a flow** and no trigger inputs. Use the generic **HTTP** Premium action, as in your successful test. Restrict flow owners.

Use these authentication settings on **both** HTTP actions created below:

| Field | Exact value |
| --- | --- |
| Authentication | Active Directory OAuth |
| Tenant | `baea89d4-d4a9-449a-b1d6-ec31fb5b380c` |
| Audience | `api://e4493960-9701-4c0b-ae21-7a9716af67ba` |
| Client ID | `e4493960-9701-4c0b-ae21-7a9716af67ba` |
| Credential Type | Secret |
| Secret | App secret supplied privately |
| Advanced parameters → Cookie | Entire privately supplied `_vercel_jwt=…` line, without quotes or a `Cookie:` prefix |

For both HTTP actions, under **Settings**: **Retry Policy = None**, **Secure Inputs = On**, **Secure Outputs = Off** (these responses contain job status only), and **Asynchronous Pattern = Off**. This is required: if you cannot find that setting on either HTTP action, stop and tell Justin before running. This flow does its own GET polling. Do not add an Authorization header. Use the dedicated Cookie parameter, not a Cookie header. Microsoft documents the [HTTP action’s cookie and asynchronous behavior](https://learn.microsoft.com/en-us/azure/connectors/connectors-native-http).

Rename actions exactly as shown **before** adding expressions. Enter expressions through the **Expression / fx** editor, without a leading `@` or enclosing quotes. Save after configuring each section.

## 2. Submit the exact existing job

Add HTTP and name it `Submit_Job`.

- **Method:** `POST`
- **URI:** `https://wmkfresearchapps-n7hku44p8-justin-gallivans-projects.vercel.app/api/automation/prompt-jobs`
- **Headers:**

| Key | Value |
| --- | --- |
| Content-Type | `application/json` |
| Idempotency-Key | `eed7b200-c00f-42bc-8a23-9b98cc5fe6df` |

Paste this literal JSON into **Body**:

```json
{
  "requestId": "63dab4af-178f-4bbc-b24d-3ccbaf74cbfc",
  "sourceEventId": "3c745b72-300d-4a0c-83c3-d45d355679e4",
  "operation": "initialize",
  "taskKeys": ["preflight.short-title"]
}
```

Do not use `guid()` or change the key on rerun. Do not add a Dataverse update action or a worker action.

## 3. Poll the returned job

After `Submit_Job`, add **Initialize variable**: name `PollDone`, type **Boolean**, value **false**.

Add a **Condition** whose left value is this expression, operator **is equal to**, right value Boolean **true** (use the Expression editor for `true`):

```text
and(equals(outputs('Submit_Job')?['statusCode'],200),equals(body('Submit_Job')?['job']?['jobId'],'7e68cdfe-4dda-47f1-9163-7a3dc4b517f5'),equals(body('Submit_Job')?['job']?['state'],'succeeded'))
```

In **False**, add **Terminate**, Status **Failed**, Code `UnexpectedSubmit`, Message `Stop and report the sanitized submit status; do not change the key.` A 202 is unexpected for this completed-job replay and must not be treated as this test passing.

In **True**, add **Do until**, with left value variable `PollDone`, operator **is equal to**, right value Boolean **true** (enter `true` through the Expression editor). Under **Change limits** / settings, set **Count = 6** and **Timeout = PT2M**. Add these three actions inside the loop, in order:

1. **Delay:** Count **5**, Unit **Second**.
2. **HTTP**, named `Poll_Job`, using the same authentication, Cookie and settings as `Submit_Job`. Method **GET**; leave Headers and Body empty. Set URI using this expression:

   ```text
   concat('https://wmkfresearchapps-n7hku44p8-justin-gallivans-projects.vercel.app/api/automation/prompt-jobs/',body('Submit_Job')?['job']?['jobId'])
   ```

3. **Set variable:** `PollDone`; value expression:

   ```text
   equals(body('Poll_Job')?['job']?['pollAfterSeconds'],null)
   ```

Keep default **run after successful** dependencies. Do not configure actions to continue after a failed HTTP call. A missing status field is not success; the final check below must also pass. The loop should run **once** for this existing completed job. Count/timeout exhaustion is not a pass.

For later integrations, HTTP 200 from GET means the status request worked, not that the job finished. Continue bounded polling while `pollAfterSeconds` is non-null, including when state is `needs_attention`; report a settled non-success state for operator attention. Do not suppress a status observation just because its version is unchanged. This trial’s fixed five-second interval matches the current server hint.

## 4. Check the final result

Still in the **True** branch, after the Do until block, add a **Condition** with this expression equal to Boolean **true** (enter `true` through the Expression editor):

```text
and(equals(variables('PollDone'),true),equals(outputs('Poll_Job')?['statusCode'],200),equals(body('Poll_Job')?['job']?['jobId'],'7e68cdfe-4dda-47f1-9163-7a3dc4b517f5'),equals(body('Poll_Job')?['job']?['state'],'succeeded'),equals(body('Poll_Job')?['job']?['pollAfterSeconds'],null),equals(length(body('Poll_Job')?['job']?['tasks']),1),equals(first(body('Poll_Job')?['job']?['tasks'])?['taskKey'],'preflight.short-title'),equals(first(body('Poll_Job')?['job']?['tasks'])?['generationState'],'validated'),equals(first(body('Poll_Job')?['job']?['tasks'])?['writebackState'],'applied'),equals(first(body('Poll_Job')?['job']?['tasks'])?['errorCode'],null))
```

In **True**, add **Compose** with literal text `PASS: same completed Short Title job; status validated and writeback applied.` In **False**, add **Terminate**, Status **Failed**, Code `UnexpectedStatus`, Message `Stop and report the sanitized job status.` An expression error or loop failure also means the test did not pass.

## 5. Run and report

Save, then manually run **once**. Expected:

| Check | Expected |
| --- | --- |
| Submit HTTP status | `200` |
| Submit and poll job ID | `7e68cdfe-4dda-47f1-9163-7a3dc4b517f5` |
| Poll HTTP status | `200` |
| Job state | `succeeded` |
| Generation / writeback | `validated` / `applied` |
| Error / poll hint | `null` / `null` |
| Version | `16` in the verified fixture; report what you see |
| Final Compose | `PASS…` |

`resultAvailable: false` is expected: this status endpoint does not return generated text. The result was already written to Sandbox Request **1000339**, column `wmkf_wmkfprojectdescription`:

> To develop an optical imaging method for observing changes in living cells with improved temporal resolution

You do not need Dataverse access to pass the HTTP test. Justin’s operator will check the stored value and confirm the ledger still contains one job, one AI attempt and one publication after your run.

Reply with the UTC run time, Submit and Poll status codes, job ID, version, job state, generation state, writeback state and final PASS/failure. Share only these sanitized response values, not action inputs or an exported flow. Do not copy response headers containing `Set-Cookie`, and do not use Save As or copy the flow into another environment. If you see 429 `prompt_job_trial_limit`, check the literal key against this brief and stop; do not generate a new key. For 401/403, 404, 503, HTML/login responses, token errors, timeouts or any other non-200 status, stop and report the sanitized error. Do not edit the source record or clear its output to retry.

After reporting, delete the temporary flow and tell Justin so the sandbox owner can revoke its temporary credentials. No scheduled trigger or automatic worker is part of this test.

---

Operator verification: the hosted status was rechecked during preparation. The submission key is the persisted original key, not a secret. Source trace: submit/status routes → `machine-service.js` → `store.js` replay-before-cap guard → `machine-status.js` → the expressions above. Existing same-key replay returned the identical completed job; changed-key admission returned 429. This brief is prepared for Connor; actual execution of this new flow remains pending. Fresh queued/running transitions and repeated polling are not proven by a completed-job replay. HTTP/loop editor mechanics are based on Microsoft documentation; the exact flow has not been run in Connor’s tenant.
