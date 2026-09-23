import { EventEmitter } from 'node:events';
import { createBypassSignalFence, throwIfInterrupted } from '../../lib/services/test-requests/bypass-signal-fence.js';

describe('sandbox rehearsal GoVerify interruption fence', () => {
  test.each(['SIGINT', 'SIGTERM'])('%s aborts in-flight cancellable work and removes its listener on disposal', signalName => {
    const target = new EventEmitter();
    const fence = createBypassSignalFence(target);
    target.emit(signalName);

    expect(fence.interruptedBy).toBe(signalName);
    expect(fence.signal.aborted).toBe(true);
    expect(() => throwIfInterrupted(fence)).toThrow(signalName);

    fence.dispose();
    expect(target.listenerCount('SIGINT')).toBe(0);
    expect(target.listenerCount('SIGTERM')).toBe(0);
  });
});
