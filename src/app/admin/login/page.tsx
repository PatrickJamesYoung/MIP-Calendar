import Link from "next/link";
import { LoginForm } from "./login-form";

interface Props {
  searchParams: Promise<{ redirectTo?: string; error?: string }>;
}

export default async function AdminLoginPage({ searchParams }: Props) {
  const { redirectTo = "/admin", error } = await searchParams;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-mip-white">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link
            href="/"
            className="mip-heading text-2xl mip-double-underline inline-block pb-1"
            style={{ color: "var(--color-mip-purple)" }}
          >
            MIP Calendar Admin
          </Link>
          <p className="mt-4 text-sm text-mip-gray-700">
            Sign in with your MIP Google account.
          </p>
        </div>

        {error === "oauth" && (
          <div
            className="mb-4 p-3 text-sm border-l-4"
            style={{
              borderLeftColor: "var(--color-mip-purple)",
              backgroundColor: "var(--color-mip-yellow)",
            }}
          >
            Sign-in failed. Please try again or contact a super admin.
          </div>
        )}

        <LoginForm redirectTo={redirectTo} />

        <p className="mt-8 text-center text-xs text-mip-gray-500">
          Access is limited to invited admins. If you should have access,
          contact a super admin.
        </p>
      </div>
    </div>
  );
}
