export default function SubmissionsPage() {
  return (
    <div>
      <h1
        className="mip-heading text-2xl mip-double-underline inline-block pb-1"
        style={{ color: "var(--color-mip-purple)" }}
      >
        Submissions
      </h1>
      <p className="mt-6 text-sm text-mip-gray-700">
        Public event submissions will show up here for approval.
      </p>
      <p className="mt-3 text-sm text-mip-gray-500">
        Coming next: submission form + moderation queue.
      </p>
    </div>
  );
}
