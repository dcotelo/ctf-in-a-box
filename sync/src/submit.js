export async function submitScore(cfg, payload, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.scorerUrl}/score`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.scorerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (res.ok) return true;
  if (res.status >= 400 && res.status < 500) return false;
  throw new Error(`scorer ${res.status}`);
}
