function splitPath(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

export function getPathBasename(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] ?? path;
}

export function compactFilePath(path: string, maxSegments = 3): string {
  const parts = splitPath(path);
  const segmentCount = Math.max(1, maxSegments);
  if (parts.length <= segmentCount) return path;
  return `.../${parts.slice(-segmentCount).join("/")}`;
}
