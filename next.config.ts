import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Allow up to 6 MB uploads (5 MB image + form overhead) to support
      // event image uploads on the public /submit form.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
