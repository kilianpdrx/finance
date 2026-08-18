"use client";

import { useEffect } from "react";

/** Last-resort boundary: catches errors thrown in the root layout itself, which
 *  `error.tsx` cannot. It replaces the whole document, so it must ship its own
 *  <html>/<body> and cannot rely on the app's providers or Tailwind theme
 *  variables — hence the inline styles. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0f19",
          color: "#e5e7eb",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ maxWidth: "28rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: "0 0 .5rem" }}>
            L&apos;application n&apos;a pas pu démarrer
          </h1>
          <p style={{ fontSize: ".875rem", color: "#9ca3af", margin: "0 0 1.25rem" }}>
            Vos données ne sont pas affectées. Réessayez ; si le problème persiste,
            fermez puis relancez l&apos;application.
            {error.digest ? ` (référence ${error.digest})` : ""}
          </p>
          <button
            onClick={reset}
            style={{
              padding: ".5rem 1rem",
              borderRadius: ".5rem",
              border: "1px solid #374151",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              fontSize: ".875rem",
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
