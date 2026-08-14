// Formats an ISO timestamp as a short relative string ("4m ago"). Done on the
// server and stored as a plain string so client and server render identical
// markup — a live Date() in the client would drift from the server render
// and trigger a hydration mismatch.
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const diffMs = now - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
