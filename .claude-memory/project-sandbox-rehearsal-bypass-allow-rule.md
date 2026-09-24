---
name: project-sandbox-rehearsal-bypass-allow-rule
description: "Per-machine Claude Code allow rule so the sandbox rehearsal script's --bypass-goverify execute is not blocked by the auto-mode classifier; must be re-added on each machine"
metadata:
  node_type: memory
  type: project
  status: active
  originSessionId: 5fb56b4d-c45a-4872-8a32-38a75b670ef3
  modified: 2026-09-24T05:02:25.866Z
---

On 2026-09-24 (Session 537) the owner authorized a machine-local Claude Code
permission rule so the Test Request Factory sandbox rehearsal can run
`--execute ... --bypass-goverify` without the auto-mode classifier stopping it
(it flagged the bypass flag as a "Safety Bypass Flag"). The rule lives in the
gitignored `.claude/settings.local.json` at the repo root, under
`permissions.allow`, and does NOT travel with git:

```
"Bash(DYNAMICS_SANDBOX_URL=https://orgd9e66399.crm.dynamics.com node --env-file=/Users/gallivan/Code/WMKF_Apps/.env.local scripts/rehearse-test-request-sandbox.mjs:*)"
```

The prefix pins the sandbox URL and the env file, so it cannot match a
production target. Adjust the `--env-file` path if the repo lives elsewhere on
another machine. Whether the rule actually clears the classifier is unverified
until the first execute runs under it.

**Why:** every live sandbox create needs the bypass (GoVerify rejects the POST
otherwise; the script deactivates and restores it around the single POST, and
that path is proven on Requests 1000338, 1000339, 1000340). Without the rule the
owner must run each execute by hand.

**How to apply:** on a new machine, add the rule to
`.claude/settings.local.json` (create the file if missing; it is gitignored).
Never widen it beyond this script. See [[project-test-request-factory]] and
`docs/plans/TEST_REQUEST_FACTORY_DESIGN_2026-09-19.md` on the Factory branch.
