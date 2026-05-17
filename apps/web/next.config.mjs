/** @type {import('next').NextConfig} */
const DESKTOP = process.env.VRL_YOLO_GUI_BUILD === "desktop";

// Where to find the FastAPI backend during `next dev`. Override with
// NEXT_PUBLIC_API_BASE if your backend is bound elsewhere.
const DEV_API_TARGET =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

const nextConfig = {
  reactStrictMode: true,
  output: DESKTOP ? "export" : undefined,
  images: { unoptimized: DESKTOP },
  trailingSlash: DESKTOP,
  async rewrites() {
    if (DESKTOP) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${DEV_API_TARGET}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
