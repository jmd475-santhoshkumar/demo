/** @type {import('next').NextConfig} */
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";

const nextConfig = {
  // Produces .next/standalone: a minimal server.js + only the node_modules
  // this app actually needs at runtime, traced from its real imports --
  // needed for a lean Docker image (without this, the image would have to
  // ship the full node_modules tree). Doesn't change dev behavior at all.
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/:path*` }];
  },
  webpack: (config) => {
    // pdfjs-dist (used for the pixel-perfect SOW preview) probes for the
    // optional Node-only `canvas`/`encoding` packages even though it never
    // needs them in the browser -- webpack tries to actually resolve/bundle
    // them anyway and fails since neither is installed. Aliasing both to
    // `false` tells webpack to stub them out instead of erroring.
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;
    return config;
  },
};

module.exports = nextConfig;




