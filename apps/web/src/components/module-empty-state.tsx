import Link from "next/link";

// The "this module has no content yet" card, shared by /quiz and /flags.
//
// Every new event starts in this state, so it is the first thing an organizer
// sees after provisioning — and it used to show them the same dead end it
// shows a contestant ("Check back soon."), with no route to the admin tab
// where the content is authored. Meanwhile the homepage promotes both modules
// as primary calls to action, so that dead end is where an organizer's first
// click lands.
//
// The contestant copy is unchanged and stays the default: an organizer's
// authoring route is additive, shown only to someone who can actually use it.

export default function ModuleEmptyState({
  message,
  authoring,
}: {
  /** What a contestant sees. Module-specific wording, since "questions" and
   *  "challenges" are each module's own noun. */
  message: string;
  /** The organizer's way out, or null for anyone who isn't an admin — a
   *  contestant must never be shown a link that 403s at them. */
  authoring: { href: string; label: string } | null;
}) {
  return (
    <div className="ds-card flex flex-col items-center gap-3 rounded-lg border border-white/[0.06] bg-[#16162a] px-5 py-10 text-center">
      <p className="text-sm text-zinc-400">{message}</p>
      {authoring && (
        <Link
          href={authoring.href}
          className="rounded-md bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1d4ed8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
        >
          {authoring.label}
        </Link>
      )}
    </div>
  );
}
