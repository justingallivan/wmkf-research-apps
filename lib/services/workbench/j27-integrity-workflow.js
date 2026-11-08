import { sleep } from 'workflow';
import { runJ27IntegrityJob, recoverJ27IntegrityJob } from './j27-integrity-worker';

async function screenStep(target, requestId, version) {
  'use step';
  return runJ27IntegrityJob(target, requestId, version);
}
// A retry can recover infrastructure failure before the claim. Once claimed,
// another step attempt cannot call paid providers for that job.
screenStep.maxRetries = 3;

async function recoverStep(target, requestId, version) {
  'use step';
  await recoverJ27IntegrityJob(target, requestId, version);
}

/** Workflow state contains only target, request ID, version, and status. */
export async function j27IntegrityWorkflow(target, requestId, version) {
  'use workflow';
  try {
    for (const delay of [15_000, 30_000, 60_000]) {
      await sleep(delay);
      const outcome = await screenStep(target, requestId, version);
      if (outcome === 'done') return;
      if (outcome === 'recover') break;
    }
  } catch {
    // An ambiguous paid call is fenced by the claim and never repeated here.
  }
  await sleep(360_000);
  await recoverStep(target, requestId, version);
}
