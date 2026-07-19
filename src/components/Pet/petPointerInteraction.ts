export interface PointerPosition {
  x: number;
  y: number;
}

const PET_DRAG_THRESHOLD = 5;

export function pointerMovedBeyondDragThreshold(
  start: PointerPosition,
  current: PointerPosition,
): boolean {
  return (
    Math.abs(current.x - start.x) >= PET_DRAG_THRESHOLD ||
    Math.abs(current.y - start.y) >= PET_DRAG_THRESHOLD
  );
}
