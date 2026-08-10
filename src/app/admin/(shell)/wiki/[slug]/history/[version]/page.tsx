import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { WikiMarkdown } from "@/components/admin/wiki/markdown";
import { diffLines, diffStats } from "@/lib/wiki/diff";
import { restoreVersion } from "../../../actions";
import { RestoreVersionButton } from "./restore-button";

export const dynamic = "force-dynamic";

interface PageRow {
  id: string;
  slug: string;
  title: string;
}

interface VersionRow {
  id: string;
  version: number;
  title: string;
  summary: string | null;
  body_md: string;
  edited_by_email: string | null;
  created_at: string;
}

export default async function WikiVersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; version: string }>;
  searchParams: Promise<{ view?: "diff" | "rendered" | "source" }>;
}) {
  const { slug, version: versionStr } = await params;
  const { view = "diff" } = await searchParams;
  await requireAdmin();

  const versionNum = Number.parseInt(versionStr, 10);
  if (!Number.isFinite(versionNum) || versionNum < 1) return notFound();

  const supabase = await createClient();

  const { data: pageData } = await supabase
    .from("wiki_pages")
    .select("id,slug,title")
    .eq("slug", slug)
    .maybeSingle();
  if (!pageData) return notFound();
  const page = pageData as PageRow;

  // Fetch this version + the previous one (for diff) + the latest version
  // (to render a "restore" affordance when viewing an older snapshot).
  const [thisRes, prevRes, latestRes] = await Promise.all([
    supabase
      .from("wiki_page_versions")
      .select("id,version,title,summary,body_md,edited_by_email,created_at")
      .eq("page_id", page.id)
      .eq("version", versionNum)
      .maybeSingle(),
    supabase
      .from("wiki_page_versions")
      .select("body_md,title,version")
      .eq("page_id", page.id)
      .lt("version", versionNum)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("wiki_page_versions")
      .select("version")
      .eq("page_id", page.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!thisRes.data) return notFound();
  const thisVersion = thisRes.data as VersionRow;
  const previousBody = (prevRes.data?.body_md as string | undefined) ?? null;
  const previousVersion = (prevRes.data?.version as number | undefined) ?? null;
  const latestVersion = (latestRes.data?.version as number | undefined) ?? versionNum;
  const isCurrent = versionNum === latestVersion;

  const diff = previousBody !== null
    ? diffLines(previousBody, thisVersion.body_md)
    : null;
  const stats = diff ? diffStats(diff) : null;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link
          href={`/admin/wiki/${page.slug}/history`}
          className="text-mip-gray-500 hover:text-mip-gray-900"
        >
          ← History
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1
              className="mip-heading text-2xl mip-double-underline inline-block pb-1"
              style={{ color: "var(--color-mip-purple)" }}
            >
              v{thisVersion.version}
            </h1>
            {isCurrent && (
              <span
                className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5"
                style={{
                  backgroundColor: "var(--color-mip-purple)",
                  color: "var(--color-mip-white)",
                  borderRadius: "var(--radius-button)",
                }}
              >
                Current
              </span>
            )}
          </div>
          <p className="mt-2 text-base text-mip-gray-700">{thisVersion.title}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-mip-gray-500">
            <Clock className="w-3 h-3" />
            {new Date(thisVersion.created_at).toLocaleString()}
            {thisVersion.edited_by_email && <> · {thisVersion.edited_by_email}</>}
          </p>
        </div>

        {!isCurrent && (
          <RestoreVersionButton
            action={restoreVersion}
            pageId={page.id}
            slug={page.slug}
            version={thisVersion.version}
            title={thisVersion.title}
          />
        )}
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-1">
        <ViewTab
          href={buildHref(page.slug, versionNum, "diff")}
          label={
            stats
              ? `Diff vs v${previousVersion} (+${stats.added} / −${stats.removed})`
              : "Diff"
          }
          active={view === "diff"}
          disabled={!diff}
        />
        <ViewTab
          href={buildHref(page.slug, versionNum, "rendered")}
          label="Rendered"
          active={view === "rendered"}
        />
        <ViewTab
          href={buildHref(page.slug, versionNum, "source")}
          label="Source"
          active={view === "source"}
        />
      </div>

      {/* Body */}
      {view === "rendered" && (
        <article
          className="border border-mip-gray-200 bg-white p-6"
          style={{ borderRadius: "var(--radius-card)" }}
        >
          <WikiMarkdown source={thisVersion.body_md} />
        </article>
      )}

      {view === "source" && (
        <pre
          className="border border-mip-gray-200 bg-mip-gray-50 p-4 text-xs font-mono whitespace-pre-wrap overflow-x-auto"
          style={{ borderRadius: "var(--radius-card)" }}
        >
          {thisVersion.body_md}
        </pre>
      )}

      {view === "diff" && (
        <DiffPane
          diff={diff}
          previousVersion={previousVersion}
          thisVersionNum={thisVersion.version}
        />
      )}

      {/* Restore hint at bottom too, so it's not lost when scrolling long diffs */}
      {!isCurrent && (
        <div className="pt-4 border-t border-mip-gray-100 text-xs text-mip-gray-500">
          Viewing an older snapshot. The current version is{" "}
          <Link
            href={`/admin/wiki/${page.slug}/history/${latestVersion}`}
            className="text-mip-purple underline underline-offset-4"
          >
            v{latestVersion}
          </Link>
          .
        </div>
      )}
    </div>
  );
}

function buildHref(slug: string, version: number, view: string): string {
  const p = new URLSearchParams();
  if (view && view !== "diff") p.set("view", view);
  const q = p.toString();
  return q
    ? `/admin/wiki/${slug}/history/${version}?${q}`
    : `/admin/wiki/${slug}/history/${version}`;
}

function ViewTab({
  href,
  label,
  active,
  disabled = false,
}: {
  href: string;
  label: string;
  active: boolean;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span
        className="inline-flex items-center px-3 py-1.5 mip-button-text text-xs text-mip-gray-400"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`inline-flex items-center px-3 py-1.5 mip-button-text text-xs transition-colors ${
        active
          ? "bg-mip-purple text-mip-white"
          : "text-mip-gray-700 hover:bg-mip-gray-100"
      }`}
      style={{ borderRadius: "var(--radius-button)" }}
    >
      {label}
    </Link>
  );
}

function DiffPane({
  diff,
  previousVersion,
  thisVersionNum,
}: {
  diff: ReturnType<typeof diffLines> | null;
  previousVersion: number | null;
  thisVersionNum: number;
}) {
  if (!diff) {
    return (
      <div
        className="border border-mip-gray-200 bg-mip-gray-50 p-4 text-sm text-mip-gray-700"
        style={{ borderRadius: "var(--radius-card)" }}
      >
        This is v{thisVersionNum} — the first version of this page, so there is
        no earlier snapshot to compare against.
      </div>
    );
  }

  return (
    <div
      className="border border-mip-gray-200 bg-white overflow-hidden"
      style={{ borderRadius: "var(--radius-card)" }}
    >
      <div className="px-4 py-2 border-b border-mip-gray-100 text-xs text-mip-gray-500 bg-mip-gray-50">
        Diff from v{previousVersion} → v{thisVersionNum}
      </div>
      <div className="text-xs font-mono">
        {diff.map((line, idx) => {
          const bg =
            line.op === "insert"
              ? "bg-emerald-50"
              : line.op === "delete"
                ? "bg-rose-50"
                : "bg-white";
          const marker =
            line.op === "insert" ? "+" : line.op === "delete" ? "−" : " ";
          const markerColor =
            line.op === "insert"
              ? "text-emerald-700"
              : line.op === "delete"
                ? "text-rose-700"
                : "text-mip-gray-400";
          return (
            <div key={idx} className={`flex ${bg}`}>
              <div className="shrink-0 w-10 px-1 text-right text-mip-gray-400 border-r border-mip-gray-100 select-none">
                {line.oldLineNo ?? ""}
              </div>
              <div className="shrink-0 w-10 px-1 text-right text-mip-gray-400 border-r border-mip-gray-100 select-none">
                {line.newLineNo ?? ""}
              </div>
              <div
                className={`shrink-0 w-6 px-1 text-center font-bold ${markerColor} select-none`}
              >
                {marker}
              </div>
              <pre className="flex-1 whitespace-pre-wrap break-words px-2 py-0.5">
                {line.text || "\u00A0"}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
