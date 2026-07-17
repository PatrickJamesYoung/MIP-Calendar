import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Allow up to 6 MB uploads (5 MB image + form overhead) to support
      // event image uploads on the public /submit form.
      bodySizeLimit: "6mb",
    },
  },
  async headers() {
    // The /embed route is designed to be iframed from
    // movementinfrastructureproject.org (and its subdomains). Explicitly
    // permit those origins in frame-ancestors, plus 'self' for local
    // preview. All other origins are blocked.
    return [
      {
        source: "/embed/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://movementinfrastructureproject.org https://*.movementinfrastructureproject.org https://www.movementinfrastructureproject.org;",
          },
        ],
      },
      {
        source: "/embed",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://movementinfrastructureproject.org https://*.movementinfrastructureproject.org https://www.movementinfrastructureproject.org;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
