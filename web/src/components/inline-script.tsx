"use client";

/**
 * A boot script that must run before first paint (Next's "preventing flash before hydration" guide).
 * The server HTML carries it as JavaScript, so the browser runs it while parsing; when React renders
 * it on the client (a soft navigation) it is inert text/plain, which React does not warn about.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
