import { createServer } from "node:http";

const score = (author, target, solved, pr) =>
  `Scored ✅\n<!-- ctf-score: ${JSON.stringify({ author, target, solved, pr, sha: "deadbeef" })} -->`;

const comments = [
  { id: 1, user: { login: "github-actions[bot]" }, updated_at: "2026-08-13T10:00:00Z",
    body: score("octocat", "dvwa", ["sqli-low", "exec-low"], 7) },
  { id: 2, user: { login: "mallory" }, updated_at: "2026-08-13T10:05:00Z",
    body: score("mallory", "dvwa", ["sqli-low", "exec-low", "csrf-low", "upload-low"], 8) }, // forged — must be ignored
  { id: 3, user: { login: "github-actions[bot]" }, updated_at: "2026-08-13T10:10:00Z",
    body: score("mona", "juice-shop", ["restfulXss"], 3) },
];

createServer((req, res) => {
  if (/^\/repos\/[^/]+\/[^/]+\/issues\/comments/.test(req.url)) {
    res.writeHead(200, { "content-type": "application/json", etag: 'W/"fixture"' });
    res.end(JSON.stringify(comments));
    return;
  }
  res.writeHead(404).end();
}).listen(8080, () => console.error("mock-github on :8080"));
