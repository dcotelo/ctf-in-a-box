// Passthrough layout whose only job is to exist: Next attaches a segment's
// not-found.tsx to the segment's LAYOUT boundary, so without a layout here
// the [id] page's notFound() bubbled up and rendered the board's boundary —
// whose "your link is fine, the module is switched off" copy is exactly
// wrong for a bad challenge id. Mirrors flags/[id]/layout.tsx exactly (same
// bug, same fix, same reasoning — see that file's note).
export default function AiChallengeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
