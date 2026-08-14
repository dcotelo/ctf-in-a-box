import "server-only";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

/**
 * DynamoDB access for the leaderboard migration (the dc34 scorer writes solves to
 * Upstash AND DynamoDB; the web app moves its team/hint writes with it).
 *
 * On Vercel the app authenticates to AWS with NO stored keys: Vercel mints an OIDC
 * token per deployment, and `awsCredentialsProvider` exchanges it for the
 * `ctf-web-dynamodb` role (trust + table access are defined in the dc34 repo's
 * terraform/vercel-aws.tf). Locally the role trust doesn't cover the development
 * environment, so the client falls back to the SDK default credential chain —
 * `aws sso login` + AWS_PROFILE works out of the box. Nothing here holds a secret.
 *
 * Config is HARDCODED for now so it works with zero Vercel setup; each value still
 * reads an env var first, so any of them can move to Vercel-managed env vars
 * (Project → Settings → Environment Variables) without touching this file.
 *
 *   CTF_AWS_REGION   where the table lives. Deliberately NOT the standard AWS_REGION:
 *                    Vercel injects that with the function's own execution region
 *                    (us-east-1 for iad1), which silently pointed every request at
 *                    the wrong region — the IAM policy is scoped to the table's ARN
 *                    in us-west-2, so writes failed with AccessDenied.
 *   AWS_ROLE_ARN     the role Vercel's OIDC token may assume.
 *   CTF_DYNAMO_TABLE the single leaderboard table, shared with the scorer.
 */
export const AWS_REGION = process.env.CTF_AWS_REGION ?? "us-west-2";
export const AWS_ROLE_ARN = process.env.AWS_ROLE_ARN ?? "arn:aws:iam::942548380662:role/ctf-web-dynamodb";
export const CTF_DYNAMO_TABLE = process.env.CTF_DYNAMO_TABLE ?? "ctf-leaderboard";

/**
 * Which store backs team/hint state. Existing gates keep precedence: when
 * TEAM_WRITES_ENABLED / HINTS_ENABLED are off, no backend is touched at all, and
 * HINTS_ENABLED always requires Upstash creds because hint TEXT only exists there.
 *
 *   dual    (default) Upstash stays authoritative — its atomic Lua verdict decides
 *           the response — and every successful write also runs the equivalent
 *           conditional DynamoDB mutation as a best-effort mirror that never
 *           throws. Verdict mismatches are logged as [dynamo-mirror]: that log is
 *           the drift detector to watch before cutting over.
 *   upstash Today's behavior; zero AWS calls.
 *   dynamo  DynamoDB is the only store: conditional transactions replace the Lua
 *           guards, and the team/hint read paths come from DynamoDB too.
 */
export type DataBackend = "dual" | "upstash" | "dynamo";
const rawBackend = process.env.CTF_DATA_BACKEND;
export const DATA_BACKEND: DataBackend =
  rawBackend === "upstash" || rawBackend === "dynamo" ? rawBackend : "dual";
if (rawBackend && rawBackend !== DATA_BACKEND) {
  console.warn(`[dynamo] unknown CTF_DATA_BACKEND "${rawBackend}" — defaulting to "dual"`);
}

let client: DynamoDBClient | undefined;

/** Lazily-built client. On Vercel the OIDC credential provider is lazy too — it
 *  resolves the token per request, not at module load, so importing this file never
 *  reaches for AWS. Gate on VERCEL rather than VERCEL_OIDC_TOKEN: `vercel env pull`
 *  writes a development-environment token into .env.local that the role trust
 *  rejects, while the default chain (AWS_PROFILE / SSO) just works locally.
 *
 *  IAM note: the role grants PutItem/UpdateItem/DeleteItem/GetItem/Query/
 *  BatchGetItem only. Transactions authorize per entry as those actions, but a
 *  ConditionCheck entry would need dynamodb:ConditionCheckItem added in the dc34
 *  repo's terraform/vercel-aws.tf — the stores deliberately avoid ConditionCheck.
 */
export function getDynamoClient(): DynamoDBClient {
  if (!client) {
    client = new DynamoDBClient({
      region: AWS_REGION,
      credentials: process.env.VERCEL === "1" ? awsCredentialsProvider({ roleArn: AWS_ROLE_ARN }) : undefined,
    });
  }
  return client;
}
