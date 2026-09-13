// The one chevron every menu button in the header wears, and the reason it is
// a component rather than two copies of an <svg>.
//
// A menu button announces itself to assistive tech through aria-haspopup and
// aria-expanded; this mark is the same promise made to everyone else — "there
// is more behind this, and it is open or it is not". Both parts have to agree,
// and they only stay agreed if there is one of them: the profile trigger in
// `auth-nav.tsx` carried the ARIA without the mark for a release (issue #411),
// which read as a menu to a screen reader and as a plain label to a sighted
// contestant. An organizer with no visible route to /admin is the version of
// that bug that costs a support message.
//
// `rotate-180` on open is behaviour, not decoration — it is how the mark says
// which of the two states it is in — so it travels with the component instead
// of being re-applied at each call site and drifting.
export default function MenuChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
      data-testid="menu-chevron"
      className={`transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
