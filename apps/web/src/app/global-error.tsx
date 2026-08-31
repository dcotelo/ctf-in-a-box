"use client";

// Last resort: the root layout itself failed, so `error.tsx` never mounted
// (an error boundary does not wrap the layout in its own segment). The root
// layout awaits the nav groups — a runtime read — plus the font and metadata
// setup, and a throw anywhere in there leaves nothing else able to render.
// Not a Redis-outage path: those reads fail open (see the note in error.tsx).
//
// This file REPLACES the root layout, which has two consequences worth
// spelling out because both are easy to trip over:
//
//   1. It must render its own <html> and <body>.
//   2. It gets none of the app's CSS or fonts — globals.css is imported by
//      the layout this file is standing in for. So every colour here is
//      inline, restating the palette rather than referencing the tokens, and
//      the type falls back to the system stack. Keeping it deliberately
//      plain is the point: this must render when nothing else in the app can.
//
// `metadata` can't be exported from a Client Component, so the tab title is
// set with React's own <title>.

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          background: "#1a1a2e",
          color: "#d4d4d8",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <title>Something went wrong</title>
        <div style={{ maxWidth: "32rem" }}>
          <p
            style={{
              margin: 0,
              fontSize: "0.75rem",
              fontWeight: 500,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: "#e53e3e",
            }}
          >
            Error
          </p>
          <h1
            style={{
              margin: "0.75rem 0 0",
              fontSize: "2.25rem",
              lineHeight: 1.1,
              color: "#ffffff",
            }}
          >
            The site failed to start
          </h1>
          <p style={{ margin: "1rem 0 0", lineHeight: 1.6, color: "#a1a1aa" }}>
            This is a fault on our side, not yours, and it usually clears on a
            retry. Your scores are unaffected — they live in the store, not in
            this page.
          </p>
          <p
            style={{
              margin: "1.5rem 0 0",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.875rem",
              color: "#8f8f9b",
              overflowWrap: "anywhere",
            }}
          >
            digest: {error.digest ?? "unavailable"}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: "1.5rem",
              cursor: "pointer",
              borderRadius: "0.375rem",
              border: "none",
              background: "#2563eb",
              color: "#ffffff",
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
