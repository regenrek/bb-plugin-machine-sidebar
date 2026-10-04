/** Trailing debounce with a deadline measured from the first mark. */
export function createBoundedDebounce(callback: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstMark: number | undefined;
  return {
    mark() {
      firstMark ??= Date.now();
      if (timer !== undefined) clearTimeout(timer);
      const delay = Math.max(0, Math.min(300, firstMark + 1_500 - Date.now()));
      timer = setTimeout(() => {
        timer = undefined;
        firstMark = undefined;
        callback();
      }, delay);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      firstMark = undefined;
    },
  };
}
