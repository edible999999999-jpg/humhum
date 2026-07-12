export async function resizePetWindow(
  resize: () => Promise<void>,
  expanded: boolean,
  report: (error: unknown) => void = console.error,
): Promise<boolean> {
  try {
    await resize();
  } catch (error) {
    report(error);
    return false;
  }
  return expanded;
}

export async function drainLatestPetWindowResize(
  initialHeight: number,
  latestHeight: () => number,
  resize: (height: number) => Promise<void>,
  releaseClaim: () => void = () => {},
  reclaim: () => void = () => {},
): Promise<number> {
  let height = initialHeight;
  while (true) {
    await resize(height);
    let next = latestHeight();
    if (next !== height) {
      height = next;
      continue;
    }
    releaseClaim();
    next = latestHeight();
    if (next === height) return height;
    reclaim();
    height = next;
  }
}
