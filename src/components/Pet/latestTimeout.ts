export interface TimeoutRef {
  current: ReturnType<typeof setTimeout> | null;
}

export function clearLatestTimeout(ref: TimeoutRef): void {
  if (ref.current !== null) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

export function scheduleLatestTimeout(
  ref: TimeoutRef,
  callback: () => void,
  delay: number,
): void {
  clearLatestTimeout(ref);
  ref.current = setTimeout(() => {
    ref.current = null;
    callback();
  }, delay);
}
