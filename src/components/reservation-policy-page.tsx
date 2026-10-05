import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { MipSiteHeader } from "@/components/mip-site-header";
import { SiteFooter } from "@/components/site-footer";

export function ReservationPolicyPage({ kind, content }: { kind: "privacy" | "terms"; content: string }) {
  return <div className="flex min-h-screen flex-col">
    <MipSiteHeader />
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10 md:py-14">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-mip-purple">MIP Reservations</p>
      <h1 className="mip-heading text-3xl text-mip-purple md:text-4xl">
        {kind === "privacy" ? "Privacy Policy" : "Terms of Use"}
      </h1>
      <nav aria-label="Reservation policies" className="my-6 flex flex-wrap gap-x-6 gap-y-3 border-y border-mip-gray-200 py-4 text-sm">
        <Link href="/reservations/privacy" aria-current={kind === "privacy" ? "page" : undefined} className="underline underline-offset-4">Privacy Policy</Link>
        <Link href="/reservations/terms" aria-current={kind === "terms" ? "page" : undefined} className="underline underline-offset-4">Terms of Use</Link>
        <Link href="/gear" className="underline underline-offset-4">Gear</Link>
        <Link href="/spaces" className="underline underline-offset-4">Spaces</Link>
      </nav>
      <article className="break-words text-base leading-7 text-mip-gray-900
        [&_h2]:mb-3 [&_h2]:mt-9 [&_h2]:font-semibold [&_h2]:text-xl
        [&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:my-3
        [&_a]:text-mip-purple [&_a]:underline [&_a]:underline-offset-4">
        <ReactMarkdown>{content.replace(/^## [^\n]+\n+/, "")}</ReactMarkdown>
      </article>
    </main>
    <SiteFooter />
  </div>;
}
