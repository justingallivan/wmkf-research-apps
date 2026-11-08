# Synthetic J27 intake rehearsal

These are fictional applications prepared as prompt-input packets. Proposal
page markers and person-labeled attachments represent the text Connor's flow
will need to extract from the sandbox submission. The Keck award abstracts are
fictional reference data for the rehearsal.

| Packet | Fixture expectation |
| --- | --- |
| `complete.json` | Complete packet. Overall Fit, with all six P6 concerns clear. |
| `missing-other-support.json` | Overall Not a Fit. P2 passes a proposal quote to P6. P6 raises too-applied and marks funding overlap Cannot assess. |
| `known-keck-overlap.json` | Overall Fit alongside a yellow Keck-overlap concern. The quote is verified against the named mock award. |

## Fixture run

```sh
node --import ./scripts/lib/use-extensionless.mjs scripts/rehearse-j27-intake.mjs --fixtures
```

This runs the same orchestration, Executor, P1 title service, and P6 comparison
service as the sandbox runner. The tests replace Dataverse and provider HTTP
responses. They verify chained inputs, conditional writes, and repeat intake.
Fixture outcomes are assertions about wiring and state, not model evaluations.

## Sandbox preflight

For each packet, create a fresh Factory-marked sandbox request linked to J27
and use the exact packet title. Start with blank WMKF title, AI Summary, and
Intake fit comparison fields to exercise all six generations. Publish the
matching prompt versions in sandbox and apply the Intake fit comparison
column. Check the request and prompt read/write permissions before live use.

Run the independent ternary screen on the same materials version. Verify the
saved fit choice and rationale, then make a local binding file with the
following shape. Replace both example GUIDs with the actual sandbox request
and ternary run IDs, and replace the example choice and rationale with the
saved values. The choice is numeric: Fit is `682090000`, Not a Fit is
`682090001`, and Unclear is `682090002`.

```json
{
  "packetId": "complete",
  "requestId": "11111111-1111-4111-8111-111111111111",
  "ternary": {
    "materialsVersion": "j27-mock-complete-v1",
    "assessment": 682090000,
    "rationale": "Example ternary rationale",
    "runId": "22222222-2222-4222-8222-222222222222"
  }
}
```

Set `DYNAMICS_URL` to the registered sandbox origin, enable
`DATAVERSE_TARGET_INTERLOCK=on`, and set `DATAVERSE_ALLOW_PROD_READS=no` in the
local sandbox configuration.

```sh
node --env-file=/path/to/sandbox.env --import ./scripts/lib/use-extensionless.mjs \
  scripts/rehearse-j27-intake.mjs --preflight \
  scripts/fixtures/j27-intake/complete.json /path/to/complete-binding.json
```

Preflight checks the request, receipt, and published prompt contracts without
dispatching generation. After explicit authorization for metered Anthropic
API calls, use `--execute-anthropic` in place of `--preflight` and append a new,
private local receipt path. The runner saves P1, P2, and the paired Intake
comparison. It retains the P3–P5 drafts and separate review signals in the
receipt while those Dataverse destinations are pending. A retry preserves
populated P1/P2 fields and any matching P6 baseline. When P2 is preserved,
the runner has no new P2 fit hint to pass to P6.
