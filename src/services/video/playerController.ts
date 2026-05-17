/**
 * Cross-tab video seek coordination.
 *
 * When a user taps "watch in video" on a PointCard (log tab), we can't directly
 * call seekTo on the VideoPlayer in the video tab (it may be unmounted). Instead
 * we write the desired seek target here, and the video tab reads it when it mounts
 * or becomes focused, then clears it.
 */

let pendingSeek: { sessionId: string; timeSec: number } | null = null;

export function setPendingSeek(sessionId: string, timeSec: number): void {
  pendingSeek = { sessionId, timeSec };
}

export function consumePendingSeek(sessionId: string): number | null {
  if (pendingSeek && pendingSeek.sessionId === sessionId) {
    const sec = pendingSeek.timeSec;
    pendingSeek = null;
    return sec;
  }
  return null;
}

export function clearPendingSeek(): void {
  pendingSeek = null;
}
