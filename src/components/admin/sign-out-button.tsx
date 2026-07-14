"use client";

export function AdminSignOutButton() {
  return (
    <a
      href="/admin/logout"
      className="text-mip-gray-500 hover:text-mip-purple underline underline-offset-4"
    >
      Sign out
    </a>
  );
}
