/** Temporary SIGINT/SIGTERM fence while the rehearsal disables GoVerify. */

export function createBypassSignalFence(signalTarget = process) {
  let interruptedBy = null;
  const controller = new AbortController();
  const handlers = new Map();
  for (const signalName of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      if (interruptedBy) return;
      interruptedBy = signalName;
      controller.abort(new Error(`Sandbox rehearsal interrupted by ${signalName}.`));
    };
    handlers.set(signalName, handler);
    signalTarget.on(signalName, handler);
  }
  return {
    signal: controller.signal,
    get interruptedBy() { return interruptedBy; },
    dispose() {
      for (const [signalName, handler] of handlers) signalTarget.removeListener(signalName, handler);
    },
  };
}

export function throwIfInterrupted(signalFence) {
  if (signalFence?.interruptedBy) {
    throw new Error(`Sandbox rehearsal interrupted by ${signalFence.interruptedBy}; GoVerify restoration was awaited.`);
  }
}
