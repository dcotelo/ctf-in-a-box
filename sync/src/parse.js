const MARKER = /<!--\s*ctf-score:\s*(\{[\s\S]*?\})\s*-->/;
// Same grammar the scorer enforces — author becomes a Redis key segment there.
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}(?:\[bot\])?$/;

export function parseScoreComment(body, { targets }) {
  const m = MARKER.exec(body ?? "");
  if (!m) return null;
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const { author, target, solved } = data;
  if (typeof author !== "string" || !GITHUB_LOGIN.test(author)) return null;
  if (!targets.includes(target)) return null;
  if (!Array.isArray(solved) || solved.some((s) => typeof s !== "string")) return null;
  return {
    author,
    target,
    solved,
    pr: Number(data.pr ?? 0) || 0,
    sha: typeof data.sha === "string" ? data.sha : "",
  };
}
