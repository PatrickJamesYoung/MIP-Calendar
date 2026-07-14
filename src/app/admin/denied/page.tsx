import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function AdminDeniedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-mip-white">
      <div className="w-full max-w-md text-center">
        <h1
          className="mip-heading text-2xl mip-double-underline inline-block pb-1"
          style={{ color: "var(--color-mip-purple)" }}
        >
          Access Denied
        </h1>
        <p className="mt-6 text-sm text-mip-gray-700">
          You&apos;re signed in
          {user?.email ? (
            <>
              {" "}as <strong>{user.email}</strong>
            </>
          ) : null}
          , but this account isn&apos;t on the admin whitelist.
        </p>
        <p className="mt-3 text-sm text-mip-gray-700">
          If you should have access, ask an existing super admin to invite you.
        </p>
        <div className="mt-8 flex gap-3 justify-center">
          <Link
            href="/"
            className="px-4 py-2 mip-button-text border border-mip-gray-300 hover:border-mip-purple"
            style={{ borderRadius: "var(--radius-button)" }}
          >
            Back to Calendar
          </Link>
          <Link
            href="/admin/logout"
            className="px-4 py-2 mip-button-text"
            style={{
              backgroundColor: "var(--color-mip-purple)",
              color: "var(--color-mip-white)",
              borderRadius: "var(--radius-button)",
            }}
          >
            Sign out
          </Link>
        </div>
      </div>
    </div>
  );
}
