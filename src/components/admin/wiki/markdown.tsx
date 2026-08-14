import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Server-rendered markdown for wiki page bodies.
 *
 * GFM enabled (tables, task lists, strikethrough, autolinks). We deliberately
 * do NOT enable rehype-raw or any HTML passthrough — the body is user-authored
 * but rendered inside the admin console where an XSS payload would run against
 * other admins. Keeping it markdown-only avoids that class of risk.
 */
export function WikiMarkdown({ source }: { source: string }) {
  if (!source.trim()) {
    return (
      <p className="text-sm text-mip-gray-500 italic">
        This page is empty. Click Edit to add content.
      </p>
    );
  }

  return (
    <div className="wiki-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Only set target/rel here — visual styling comes from
          // `.wiki-prose a` in globals.css so markdown and HTML
          // renderers stay in sync.
          a: ({ href, children }) => (
            <a
              href={href}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noreferrer" : undefined}
            >
              {children}
            </a>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
