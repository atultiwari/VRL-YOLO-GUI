import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "VRL YOLO GUI",
  description: "Clinician-facing YOLO toolkit for histopathology and hematology.",
};

// Inline CSS for a hand-off splash that shows in the static HTML before
// React hydrates. Lives in <head> so it lands on the first paint.
//
// IMPORTANT: this used to remove the loader from the DOM via an inline
// script that ran on DOMContentLoaded. That broke React's hydration —
// removing a server-rendered element before hydration leaves the React
// tree inconsistent, and the next client-side navigation throws an
// "Application error: a client-side exception has occurred". So now the
// loader stays in the React tree forever and is dismissed purely via a
// one-shot CSS animation with `animation-fill-mode: forwards`.
const INITIAL_LOADER_STYLE = `
  #initial-loader {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    background: #0a2540;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    animation: il-dismiss 220ms ease-out 600ms forwards;
  }
  @keyframes il-dismiss {
    to {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }
  }
  #initial-loader .il-title { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.01em; }
  #initial-loader .il-sub   { font-size: 0.875rem; color: #7dd3fc; }
  #initial-loader .il-ring  {
    width: 24px; height: 24px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.18);
    border-top-color: #7dd3fc;
    animation: il-spin 0.8s linear infinite;
  }
  @keyframes il-spin { to { transform: rotate(360deg); } }
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: INITIAL_LOADER_STYLE }} />
      </head>
      <body className="min-h-screen bg-surface text-ink" suppressHydrationWarning>
        <div id="initial-loader" aria-hidden="true">
          <div className="il-title">VRL YOLO GUI</div>
          <div className="il-ring" />
          <div className="il-sub">Loading…</div>
        </div>
        <Providers>
          <div className="grid min-h-screen grid-cols-[260px_1fr] grid-rows-[56px_1fr]">
            <header className="col-span-2 row-start-1 border-b border-surface-muted bg-surface">
              <Topbar />
            </header>
            <aside className="row-start-2 border-r border-surface-muted bg-surface-subtle">
              <Sidebar />
            </aside>
            <main className="row-start-2 overflow-auto">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
