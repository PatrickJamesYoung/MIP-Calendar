import { redirect } from "next/navigation";

/**
 * The calendar now lives at /calendar as a standalone page with a header
 * that mirrors the parent MIP site. Keep the root URL working by
 * redirecting to it.
 */
export default function RootPage() {
  redirect("/calendar");
}
