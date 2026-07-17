import type { Metadata } from "next";
import type { ReactNode } from "react";

// Minimal layout for iframe embedding. No SiteHeader, no SiteFooter — the
// parent page (movementinfrastructureproject.org/calendar) provides the site
// chrome. This route is designed to be embedded via <iframe>.

export const metadata: Metadata = {
  title: "MIP Movement Calendar",
  description: "Embed view of the MIP Movement Calendar.",
  // Allow iframe embedding from any origin. The site-wide layout may set
  // frame-ancestors via headers; if it does, this metadata is informational
  // only. Actual CSP is enforced in next.config or middleware if needed.
  robots: { index: false, follow: false },
};

export default function EmbedLayout({ children }: { children: ReactNode }) {
  // No <html> or <body> here — Next.js already provides those from the root
  // layout. We just render the children with a wrapper that fills the iframe.
  return (
    <div className="embed-shell min-h-screen bg-white">
      {children}
    </div>
  );
}
