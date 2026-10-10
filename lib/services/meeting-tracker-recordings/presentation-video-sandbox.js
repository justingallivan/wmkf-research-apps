/**
 * The only module that touches @vercel/sandbox (Stage 4 slice 3). The worker is tested with a fake of this adapter.
 * Auth is the runtime OIDC token. Handles are the SDK's Sandbox objects, opaque to the worker.
 *
 * Verified against @vercel/sandbox 3.4.0 (node_modules/@vercel/sandbox/dist):
 *  - `getCommand(cmdId)` is a non-waiting GET; `Command.exitCode` is `cmd.exitCode ?? null`, so it is null while the
 *    command runs and the number once it has finished. `wait()` is never used.
 *  - `Sandbox.get` does not resume (`resume` defaults to false); a missing sandbox is an APIError with
 *    `response.status === 404`. Every other sandbox method resumes a stopped sandbox on a stopped error, so the
 *    worker never runs a command to probe, and `status` is read from the handle.
 *  - `stop()` updates the handle's session in place, so `activeCpuUsageMs` is readable from the same handle after it.
 */
const APP_TAG = 'wmkf-stage4';
const SANDBOX_DIR = '/vercel/sandbox';

export const isNotFound = error => Number(error?.response?.status) === 404;

let sdkPromise = null;
const sdk = () => {
  sdkPromise ||= import('@vercel/sandbox');
  return sdkPromise;
};

async function drain(paginator) {
  const items = [];
  for await (const item of paginator) items.push(item);
  return items;
}

export const presentationVideoSandboxAdapter = {
  appTag: APP_TAG,
  sandboxDir: SANDBOX_DIR,

  async create({ name, vcpus, timeoutMs, tags }) {
    const { Sandbox } = await sdk();
    const sandbox = await Sandbox.create({
      name, persistent: false, region: 'iad1', failoverRegions: [], resources: { vcpus }, timeout: timeoutMs,
      networkPolicy: 'deny-all', tags,
    });
    return { handle: sandbox, persistent: sandbox.persistent };
  },

  /** The sandbox handle, or null when it does not exist (404). */
  async get(name) {
    const { Sandbox } = await sdk();
    try {
      const sandbox = await Sandbox.get({ name });
      return { handle: sandbox, status: sandbox.status };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  },

  writeFiles: (sandbox, files) => sandbox.handle.writeFiles(files),
  updateNetworkPolicy: (sandbox, policy) => sandbox.handle.updateNetworkPolicy(policy),
  readFileToBuffer: (sandbox, path) => sandbox.handle.readFileToBuffer({ path }),

  /** Detached: resolves to the command id. */
  async runDetached(sandbox, { cmd, args, env }) {
    const command = await sandbox.handle.runCommand({ cmd, args, env, cwd: SANDBOX_DIR, detached: true });
    return command.cmdId;
  },
  /** Waits for the command to finish: resolves to its exit code. */
  async run(sandbox, { cmd, args, env }) {
    const finished = await sandbox.handle.runCommand({ cmd, args, env, cwd: SANDBOX_DIR });
    return finished.exitCode;
  },
  /** `{ exitCode: number | null }`, null while the command is still running. */
  async commandState(sandbox, cmdId) {
    const command = await sandbox.handle.getCommand(cmdId);
    return { exitCode: command.exitCode ?? null };
  },

  /** Stops the sandbox (awaiting the promise is the wait) and reads its usage. A stop of a gone session is tolerated. */
  async stopAndReadUsage(sandbox) {
    try {
      await sandbox.handle.stop();
    } catch (error) {
      if (![404, 409, 410].includes(Number(error?.response?.status))) throw error;
    }
    const handle = sandbox.handle;
    const number = value => (Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : null);
    return { activeCpuMs: number(handle.activeCpuUsageMs), provisionedMs: number(handle.totalDurationMs), vcpus: number(handle.vcpus) };
  },
  /** Every snapshot of the sandbox, across all pages, as `{ delete() }` handles. */
  listSnapshots: async sandbox => drain(await sandbox.handle.listSnapshots()),
  deleteSnapshot: snapshot => snapshot.delete(),
  deleteSandbox: sandbox => sandbox.handle.delete(),

  /** Tagged sandboxes of this app: `{ name, tags }`. */
  async listTagged() {
    const { Sandbox } = await sdk();
    const items = await drain(await Sandbox.list({ tags: { app: APP_TAG } }));
    return items.map(item => ({ name: item.name, tags: item.tags || {} }));
  },
};
