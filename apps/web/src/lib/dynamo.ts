import "server-only";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

/**
 * DynamoDB access for the leaderboard migration (the scorer writes solves to
 * Upstash AND DynamoDB; the web app moves its team/hint writes with it).
 *
 * Credentials come entirely from the AWS SDK's default credential chain —
 * environment variables, a shared config/credentials file, `AWS_PROFILE` /
 * `aws sso login`, or (when running on AWS compute) the ambient instance/task
 * role. Nothing here holds a secret; whoever deploys this configures AWS
 * credentials the normal way for their environment.
 *
 * Config is HARDCODED for now so it works with zero extra setup; each value
 * still reads an env var first, so any of them can be overridden per
 * deployment without touching this file.
 *
 *   CTF_AWS_REGION   where the table lives. Deliberately NOT the standard AWS_REGION:
 *                    some hosts inject that with the function's own execution region,
 *                    which can silently point requests at the wrong region — the IAM
 *                    policy is scoped to the table's ARN in us-west-2, so writes would
 *                    fail with AccessDenied.
 *   AWS_ROLE_ARN     unused unless credentials are configured to assume a role
 *                    (e.g. via the SDK's `AssumeRoleWithWebIdentity` / profile-based
 *                    role assumption); kept as a documented override point.
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

/** Lazily-built client. Credentials are resolved by the SDK's default chain,
 *  which itself resolves lazily per request rather than at module load, so
 *  importing this file never reaches for AWS.
 *
 *  IAM note: whatever role or user backs the resolved credentials must grant
 *  PutItem/UpdateItem/DeleteItem/GetItem/Query/BatchGetItem at minimum.
 *  Transactions authorize per entry as those actions, but a ConditionCheck
 *  entry would additionally need dynamodb:ConditionCheckItem — the stores
 *  deliberately avoid ConditionCheck.
 */
export function getDynamoClient(): DynamoDBClient {
  if (!client) {
    client = new DynamoDBClient({ region: AWS_REGION });
  }
  return client;
}
