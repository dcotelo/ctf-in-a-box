"use client";

// The bulk import/export flow the quiz and classic admin panels share: a
// textarea an organizer pastes a bundle into (or fills from a chosen file),
// client-side validation that gates the Import button, the `{import: <raw
// text>}` POST, and the after-import summary. Both panels carried the same
// four useStates and the same three handlers; what differed — the endpoint,
// the module's `parseBundle`, the summary's shape, how to refresh the list
// afterwards — is the config.
//
// Wire contract: the raw pasted/uploaded text is sent exactly as
// `{ import: <raw text> }`, the ONLY key in the body — never a pre-parsed
// object. The route re-validates with the same `parseBundle` this hook ran
// client-side, which is what makes it safe to accept text from a client whose
// own validation could in principle be skipped or stale. On success the panel
// refreshes its list from the server (`afterImport`) rather than
// hand-mutating local state — an import can create and update an arbitrary
// number of rows at once, and the store, not this hook's memory of what it
// sent, is the source of truth for what landed.
//
// A summary of a write does not outlive the next write (#127): an organizer
// who imported a question and then deleted it was left reading "Imported 1
// question" under a list that no longer contained it. `retire()` is what the
// panel calls after every other successful write; errors go with it — a
// resolved import error is as stale as a resolved success.

import { useState, type ChangeEvent } from "react";
import { type DescribeError, NETWORK_ERROR, parseJson } from "@/components/admin/fetch";

/** One import problem, as both `quiz-io` and `classic-io` shape it. */
export type ImportError = { where: string; message: string };

/** What a module's `parseBundle` returns, as far as this hook cares. */
export type BundleParse = { ok: true } | { ok: false; errors: ImportError[] };

/** The counts a successful import reply carries. `categories` is classic's. */
export type ImportReply = { created?: number; updated?: number; categories?: number };

/** The client-side gate on the Import button. Convenience only — the server
 *  re-validates the raw text regardless — and skipped entirely on an empty
 *  textarea so the panel doesn't greet an organizer who hasn't typed anything
 *  yet with a wall of "must be an array" errors. Exported for direct testing. */
export function clientValidation(
  text: string,
  parse: (raw: string) => BundleParse,
): { errors: ImportError[] | null; canImport: boolean } {
  if (text.trim().length === 0) return { errors: null, canImport: false };
  const result = parse(text);
  return result.ok ? { errors: null, canImport: true } : { errors: result.errors, canImport: false };
}

/** Hands `text` to the browser as a JSON download. Entirely client-side — no
 *  endpoint round trip, so the secrets already in memory never cross the
 *  network a second time just to be downloaded again. The object URL is
 *  revoked right after triggering the download (deferred one tick so the
 *  browser has actually started it): an un-revoked URL keeps the whole Blob
 *  pinned in memory for the rest of the page's life. */
export function downloadJson(text: string, filename: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export type BundleImportState<Summary> = {
  text: string;
  /** Replaces the textarea's text and retires any stale summary or error. */
  setText: (value: string) => void;
  pending: boolean;
  clientErrors: ImportError[] | null;
  serverErrors: ImportError[] | null;
  result: Summary | null;
  canImport: boolean;
  submit: () => Promise<void>;
  /** Reads a chosen `.json` file client-side into the same textarea the
   *  paste path uses, so both paths share one validation/submit flow. Clears
   *  the input's value afterward so choosing the SAME file again (e.g. after
   *  editing it on disk) still fires a change event. */
  handleFile: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  /** Retires the summary and errors — call after any other write. */
  retire: () => void;
};

export function useBundleImport<Summary>({
  endpoint,
  describeError,
  parse,
  parseSummary,
  afterImport,
}: {
  endpoint: string;
  describeError: DescribeError;
  parse: (raw: string) => BundleParse;
  parseSummary: (reply: ImportReply) => Summary;
  afterImport: () => Promise<void>;
}): BundleImportState<Summary> {
  const [text, setTextState] = useState("");
  const [pending, setPending] = useState(false);
  const [serverErrors, setServerErrors] = useState<ImportError[] | null>(null);
  const [result, setResult] = useState<Summary | null>(null);

  function retire() {
    setResult(null);
    setServerErrors(null);
  }

  function setText(value: string) {
    setTextState(value);
    retire();
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setText(await file.text());
  }

  async function submit() {
    setPending(true);
    setServerErrors(null);
    setResult(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ import: text }),
      });
      const data = await parseJson<ImportReply & { errors?: ImportError[]; error?: string }>(res);
      if (res.ok) {
        setResult(parseSummary(data));
        setTextState("");
        await afterImport();
        return;
      }
      if (Array.isArray(data.errors)) {
        setServerErrors(data.errors);
        return;
      }
      setServerErrors([{ where: "(request)", message: describeError(res.status, data.error) }]);
    } catch {
      setServerErrors([{ where: "(request)", message: NETWORK_ERROR }]);
    } finally {
      setPending(false);
    }
  }

  const { errors: clientErrors, canImport } = clientValidation(text, parse);

  return { text, setText, pending, clientErrors, serverErrors, result, canImport, submit, handleFile, retire };
}
