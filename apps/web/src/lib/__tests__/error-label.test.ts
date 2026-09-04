// The one string a store may hand `console.error` for a caught value. Three
// stores share it so they cannot drift: the invariant is "never the object",
// and an object's own fields (`command`, `cause`, `body`) are where a client
// puts the request it failed on — which, on a grading path, is the flag.
import { describe, expect, it } from "vitest";

import { errorLabel } from "@/lib/error-label";

describe("errorLabel", () => {
  it("keeps only the error's name and message", () => {
    expect(errorLabel(new TypeError("fetch failed"))).toBe("TypeError: fetch failed");
  });

  it("drops own properties, the cause and the stack — where a driver attaches the request", () => {
    const FLAG = "CTF{do-not-log-me}";
    const decorated = Object.assign(new Error("Upstash EVAL failed: ERR timeout"), {
      command: ["EVAL", "...", FLAG],
      cause: new Error(`while sending ${FLAG}`),
    });
    const label = errorLabel(decorated);
    expect(label).toContain("ERR timeout");
    expect(label).not.toContain(FLAG);
    expect(label).not.toContain("\n"); // no stack frames
  });

  it("caps the message so an interpolated payload cannot ride in on it", () => {
    expect(errorLabel(new Error("x".repeat(1000)))).toHaveLength(200);
  });

  it("never stringifies a non-Error throw — a thrown string could BE the flag", () => {
    expect(errorLabel("CTF{thrown-as-string}")).toBe("non-Error throw");
    expect(errorLabel({ flag: "CTF{obj}" })).toBe("non-Error throw");
    expect(errorLabel(undefined)).toBe("non-Error throw");
  });
});
