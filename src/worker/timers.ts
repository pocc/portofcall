/**
 * Timer tracking & cleanup for Cloudflare Workers.
 *
 * Patches globalThis.setTimeout/clearTimeout so every timer created during a
 * request is tracked via AsyncLocalStorage.  `withRequestTimeoutCleanup`
 * guarantees all timers are cleared when the request handler finishes —
 * preventing leaked timers that would keep the isolate alive.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

type TimeoutHandle = ReturnType<typeof setTimeout>;

type TimerTrackingStore = {
  timers: Set<TimeoutHandle>;
};

export const timerStore = new AsyncLocalStorage<TimerTrackingStore>();
const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);

const TIMER_PATCH_FLAG = '__portOfCallTimeoutPatchInstalled';
const timerPatchGlobal = globalThis as typeof globalThis & { [TIMER_PATCH_FLAG]?: boolean };

if (!timerPatchGlobal[TIMER_PATCH_FLAG]) {
  timerPatchGlobal[TIMER_PATCH_FLAG] = true;

  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const store = timerStore.getStore();

    if (!store) {
      return nativeSetTimeout(handler, timeout, ...(args as []));
    }

    if (typeof handler !== 'function') {
      const timeoutHandle = nativeSetTimeout(handler, timeout, ...(args as [])) as unknown as TimeoutHandle;
      store.timers.add(timeoutHandle);
      return timeoutHandle;
    }

    let timeoutHandle: TimeoutHandle;
    const wrappedHandler = (...handlerArgs: unknown[]): void => {
      try {
        (handler as (...callbackArgs: unknown[]) => unknown)(...handlerArgs);
      } finally {
        store.timers.delete(timeoutHandle);
      }
    };

    timeoutHandle = nativeSetTimeout(wrappedHandler, timeout, ...(args as []));
    store.timers.add(timeoutHandle);
    return timeoutHandle;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((timeoutHandle?: TimeoutHandle): void => {
    const store = timerStore.getStore();
    if (store && timeoutHandle !== undefined) {
      store.timers.delete(timeoutHandle);
    }
    nativeClearTimeout(timeoutHandle);
  }) as typeof clearTimeout;
}

export async function withRequestTimeoutCleanup<T>(operation: () => Promise<T>): Promise<T> {
  return timerStore.run({ timers: new Set<TimeoutHandle>() }, async () => {
    try {
      return await operation();
    } finally {
      const store = timerStore.getStore();
      if (store) {
        for (const timeoutHandle of store.timers) {
          nativeClearTimeout(timeoutHandle);
        }
        store.timers.clear();
      }
    }
  });
}
