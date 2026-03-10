/**
 * Timeout utilities that properly clean up timer handles.
 *
 * These replace the leaky pattern:
 *   const t = new Promise<never>((_, rej) => setTimeout(() => rej(...), ms));
 *   await Promise.race([work, t]); // timer leaks if work resolves first
 *
 * With the safe pattern:
 *   await raceWithTimeout(work, ms, 'message'); // timer always cleared
 */

/**
 * Race a promise against a timeout. Rejects with `message` if the timeout
 * fires first. The timer is **always** cleared — whether the work resolves,
 * rejects, or the timeout wins.
 */
export function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

/**
 * Race a promise against a deadline. Resolves `null` if the timeout fires
 * first (instead of rejecting). Useful for read loops where timeout means
 * "no more data" rather than an error.
 */
export function raceWithDeadline<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}
