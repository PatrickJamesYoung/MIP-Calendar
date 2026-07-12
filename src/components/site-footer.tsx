export function SiteFooter() {
  return (
    <footer className="w-full bg-mip-black text-mip-white mt-16">
      <div
        className="mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4 px-6 py-8"
        style={{ maxWidth: "var(--max-width-content)" }}
      >
        <div className="mip-heading text-lg">Movement Infrastructure Project</div>
        <a
          href="mailto:Info@MovementInfrastructureProject.org"
          className="hover:underline"
        >
          Info@MovementInfrastructureProject.org
        </a>
      </div>
      <div
        className="mx-auto px-6 pb-6 text-xs opacity-60"
        style={{ maxWidth: "var(--max-width-content)" }}
      >
        Unless otherwise stated, MIP did not organize these actions and inclusion is not an endorsement.
      </div>
    </footer>
  );
}
