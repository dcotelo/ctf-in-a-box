// Passthrough layout whose only job is to exist: Next attaches a segment's
// not-found.tsx to the segment's LAYOUT boundary, so without a layout here
// the [id] page's notFound() bubbled up and rendered the board's boundary —
// whose "your link is fine, the module is switched off" copy is exactly
// wrong for a bad challenge id (verified on the deployed branch: a made-up
// id showed the switched-off page while the module was live).
export default function ChallengeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
