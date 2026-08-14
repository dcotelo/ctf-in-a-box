// Unit tests for the DynamoDB hint store — most importantly that a purchase
// charges exactly once (the conditional Put is the SADD-style guard, in the
// same transaction as the spend increment). The client is mocked at
// getDynamoClient.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";

const mocks = vi.hoisted(() => ({
  send: vi.fn<(command: { input: Record<string, unknown> }) => Promise<unknown>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dynamo", () => ({
  CTF_DYNAMO_TABLE: "ctf-leaderboard",
  DATA_BACKEND: "dual",
  getDynamoClient: () => ({ send: mocks.send }),
}));

import {
  dynamoChargeHint,
  dynamoGetHintAvailability,
  dynamoGetHintPenalties,
  dynamoGetHintText,
  dynamoGetHintTexts,
  dynamoGetViewerPurchases,
  mirrorHintCharge,
} from "@/lib/dynamo-hint-store";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dynamoChargeHint", () => {
  it("charges once: conditional purchase Put + spend ADD in one transaction", async () => {
    mocks.send
      .mockResolvedValueOnce({}) // TransactWriteItems
      .mockResolvedValueOnce({ Item: { spent: { N: "10" } } }); // follow-up spend read
    const result = await dynamoChargeHint("octocat", "juice-shop", "Challenge-5-Admin-Section", 10);
    expect(result).toEqual({ status: "charged", spent: 10 });

    const transact = mocks.send.mock.calls[0][0].input as { TransactItems: Record<string, Record<string, unknown>>[] };
    const [purchase, spend] = transact.TransactItems;
    expect(purchase.Put).toMatchObject({
      Item: {
        pk: { S: "USER#octocat" },
        sk: { S: "HINT#juice-shop#Challenge-5-Admin-Section" },
        cost: { N: "10" },
      },
      ConditionExpression: "attribute_not_exists(pk)", // the charge-once guard
    });
    expect(spend.Update).toMatchObject({
      Key: { pk: { S: "HINTSPEND" }, sk: { S: "AUTHOR#octocat" } },
      UpdateExpression: "ADD #spent :cost SET #login = :login, #updatedAt = :now",
      ExpressionAttributeValues: expect.objectContaining({ ":cost": { N: "10" } }),
    });
  });

  it("returns owned (free) when the purchase item already exists", async () => {
    mocks.send
      .mockRejectedValueOnce(
        new TransactionCanceledException({
          message: "Transaction cancelled",
          $metadata: {},
          CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
        }),
      )
      .mockResolvedValueOnce({ Item: { spent: { N: "30" } } });
    expect(await dynamoChargeHint("octocat", "juice-shop", "Challenge-1", 10)).toEqual({
      status: "owned",
      spent: 30,
    });
  });

  it("returns error (not a throw) on an unexpected failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.send.mockRejectedValueOnce(new Error("dynamo down"));
    expect(await dynamoChargeHint("octocat", "juice-shop", "Challenge-1", 10)).toEqual({ status: "error" });
    consoleError.mockRestore();
  });
});

describe("dynamoGetHintText", () => {
  it("reads one hint's text from pk=HINTS", async () => {
    mocks.send.mockResolvedValueOnce({ Item: { text: { S: "Check the admin route." } } });
    expect(await dynamoGetHintText("juice-shop", "Challenge-5-Admin-Section")).toBe("Check the admin route.");
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({
      Key: { pk: { S: "HINTS" }, sk: { S: "HINT#juice-shop#Challenge-5-Admin-Section" } },
    });
  });

  it("returns null when the hint does not exist", async () => {
    mocks.send.mockResolvedValueOnce({});
    expect(await dynamoGetHintText("juice-shop", "Challenge-999-Nope")).toBeNull();
  });
});

describe("dynamoGetHintTexts", () => {
  it("batch-reads texts in input order, null where missing", async () => {
    mocks.send.mockResolvedValueOnce({
      Responses: {
        "ctf-leaderboard": [
          // Deliberately out of input order — the sk map restores it.
          { sk: { S: "HINT#dvwa#brute-low" }, text: { S: "Brute hint." } },
          { sk: { S: "HINT#juice-shop#Challenge-1" }, text: { S: "Admin hint." } },
        ],
      },
    });
    expect(
      await dynamoGetHintTexts([
        { app: "juice-shop", id: "Challenge-1" },
        { app: "juice-shop", id: "Challenge-Gone" },
        { app: "dvwa", id: "brute-low" },
      ]),
    ).toEqual(["Admin hint.", null, "Brute hint."]);
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({
      RequestItems: {
        "ctf-leaderboard": {
          Keys: [
            { pk: { S: "HINTS" }, sk: { S: "HINT#juice-shop#Challenge-1" } },
            { pk: { S: "HINTS" }, sk: { S: "HINT#juice-shop#Challenge-Gone" } },
            { pk: { S: "HINTS" }, sk: { S: "HINT#dvwa#brute-low" } },
          ],
        },
      },
    });
  });

  it("retries UnprocessedKeys until they drain", async () => {
    mocks.send
      .mockResolvedValueOnce({
        Responses: { "ctf-leaderboard": [] },
        UnprocessedKeys: { "ctf-leaderboard": { Keys: [{ pk: { S: "HINTS" }, sk: { S: "HINT#dvwa#brute-low" } }] } },
      })
      .mockResolvedValueOnce({
        Responses: { "ctf-leaderboard": [{ sk: { S: "HINT#dvwa#brute-low" }, text: { S: "Brute hint." } }] },
      });
    expect(await dynamoGetHintTexts([{ app: "dvwa", id: "brute-low" }])).toEqual(["Brute hint."]);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it("makes no request for an empty list", async () => {
    expect(await dynamoGetHintTexts([])).toEqual([]);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("dynamoGetHintAvailability", () => {
  it("groups challenge ids by app from one pk=HINTS Query with the text projected out", async () => {
    mocks.send
      .mockResolvedValueOnce({
        Items: [
          { app: { S: "juice-shop" }, challengeId: { S: "Challenge-1" } },
          { app: { S: "juice-shop" }, challengeId: { S: "Challenge-2" } },
        ],
        LastEvaluatedKey: { pk: { S: "HINTS" }, sk: { S: "HINT#juice-shop#Challenge-2" } },
      })
      .mockResolvedValueOnce({ Items: [{ app: { S: "dvwa" }, challengeId: { S: "brute-low" } }] });
    expect(await dynamoGetHintAvailability()).toEqual({
      "juice-shop": ["Challenge-1", "Challenge-2"],
      dvwa: ["brute-low"],
    });
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": { S: "HINTS" } },
      ProjectionExpression: "#app, #id", // never the text — this shape is public
    });
  });
});

describe("dynamoGetViewerPurchases", () => {
  it("queries the viewer's HINT# items and reads the spend total", async () => {
    mocks.send
      .mockResolvedValueOnce({
        Items: [{ app: { S: "juice-shop" }, challengeId: { S: "Challenge-1" } }],
        LastEvaluatedKey: { pk: { S: "USER#octocat" }, sk: { S: "HINT#juice-shop#Challenge-1" } },
      })
      .mockResolvedValueOnce({ Items: [{ app: { S: "dvwa" }, challengeId: { S: "brute-low" } }] })
      .mockResolvedValueOnce({ Item: { spent: { N: "20" } } });
    expect(await dynamoGetViewerPurchases("octocat")).toEqual({
      purchases: [
        { app: "juice-shop", id: "Challenge-1" },
        { app: "dvwa", id: "brute-low" },
      ],
      spent: 20,
    });
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": { S: "USER#octocat" }, ":prefix": { S: "HINT#" } },
    });
  });
});

describe("dynamoGetHintPenalties", () => {
  it("builds the login → points map from one HINTSPEND partition Query", async () => {
    mocks.send
      .mockResolvedValueOnce({
        Items: [{ login: { S: "octocat" }, spent: { N: "30" } }],
        LastEvaluatedKey: { pk: { S: "HINTSPEND" }, sk: { S: "AUTHOR#octocat" } },
      })
      .mockResolvedValueOnce({
        Items: [
          { login: { S: "dcotelo" }, spent: { N: "10" } },
          { login: { S: "zeroed" }, spent: { N: "0" } }, // dropped: non-positive
          { spent: { N: "10" } }, // dropped: no login
        ],
      });
    expect(await dynamoGetHintPenalties()).toEqual(
      new Map([
        ["octocat", 30],
        ["dcotelo", 10],
      ]),
    );
  });
});

describe("mirrorHintCharge", () => {
  it("never throws — a failed mirror is logged, not surfaced", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.send.mockRejectedValueOnce(new Error("boom"));
    await expect(mirrorHintCharge("octocat", "juice-shop", "Challenge-1", 10)).resolves.toBeUndefined();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  it("logs a drift warning when DynamoDB says owned for a charge Upstash confirmed", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.send
      .mockRejectedValueOnce(
        new TransactionCanceledException({
          message: "Transaction cancelled",
          $metadata: {},
          CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
        }),
      )
      .mockResolvedValueOnce({ Item: { spent: { N: "30" } } });
    await mirrorHintCharge("octocat", "juice-shop", "Challenge-1", 10);
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining("upstash=charged dynamo=owned"));
    consoleWarn.mockRestore();
  });
});
