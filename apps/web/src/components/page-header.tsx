// Reusable heading block for content routes: teal eyebrow, display title,
// optional lede, and the signature gradient divider. Server Component.

export default function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  // ReactNode rather than string so a lede can carry an inline link — several
  // pages point at the Discord or a policy document from the header copy.
  description?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-[0.25em] text-[#14b8a6]">
        {eyebrow}
      </p>
      <h1 className="text-balance text-4xl font-bold tracking-tight text-white sm:text-5xl">
        {title}
      </h1>
      {description && (
        <p className="max-w-2xl text-base leading-relaxed text-zinc-400">
          {description}
        </p>
      )}
      <div className="mt-2 h-px w-full bg-gradient-to-r from-[#2563eb]/40 via-white/[0.06] to-transparent" />
    </div>
  );
}
