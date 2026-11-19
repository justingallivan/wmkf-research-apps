import { start } from 'workflow/api';
import { queueJ27IntegrityScreen, confirmJ27IntegritySchedule } from './j27-integrity-jobs';
import { j27IntegrityWorkflow } from './j27-integrity-workflow';

export async function scheduleJ27IntegrityScreen(input) {
  try {
    if (!await queueJ27IntegrityScreen(input)) return 'existing';
    // Confirm durable dispatch before saving the recommendation. The workflow
    // waits for that write and the search is never part of the save response.
    await start(j27IntegrityWorkflow, [input.target, input.requestId, input.version]);
    return 'started';
  } catch {
    console.error('J27 Integrity Screen dispatch could not be confirmed', { requestId: input.requestId });
    return 'unconfirmed';
  }
}

export async function confirmJ27IntegrityDecision(input) {
  try {
    return await confirmJ27IntegritySchedule(input) ? 'scheduled' : 'unconfirmed';
  } catch {
    console.error('J27 recommendation saved but the Integrity Screen could not be confirmed', { requestId: input.requestId });
    return 'unconfirmed';
  }
}
