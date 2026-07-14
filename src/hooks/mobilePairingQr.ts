export function mobilePairingSecondsRemaining(
  expiresAt: number,
  nowMs = Date.now(),
): number {
  return Math.max(0, Math.ceil(expiresAt - nowMs / 1000));
}

export function shouldShowMobilePairingQr(
  pairingActive: boolean,
  expiresAt: number,
  nowMs = Date.now(),
): boolean {
  return pairingActive && mobilePairingSecondsRemaining(expiresAt, nowMs) > 0;
}
