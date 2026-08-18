// Small OWASP category badge. When the code maps to a known OWASP page it
// renders as a link (new tab) to that Top-10 / API-Top-10 category; otherwise
// it's plain text. Shared by the per-challenge breakdown and the team's
// solved-flags list so the link + styling stay in one place.

import { owaspUrl } from "@/lib/owasp";

export default function OwaspBadge({ code, className = "" }: { code: string; className?: string }) {
  const base = `flex-none rounded border border-white/10 px-1 text-[11px] text-muted ${className}`;
  const url = owaspUrl(code);
  if (!url) return <span className={base}>{code}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={`OWASP ${code} — opens owasp.org`}
      onClick={(e) => e.stopPropagation()}
      className={`${base} transition-colors hover:border-[#2563eb]/50 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]`}
    >
      {code}
    </a>
  );
}
