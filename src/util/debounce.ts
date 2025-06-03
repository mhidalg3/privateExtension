/**
 * Creates a debounced function that delays invoking the provided function
 * until after the specified wait time has elapsed since the last time the debounced function was invoked.
 */
export function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function(this: any, ...args: Parameters<F>) {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func.apply(this, args), waitFor);
  };
}
