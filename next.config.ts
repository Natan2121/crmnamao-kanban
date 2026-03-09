import type { NextConfig } from "next";

const defaultChatwootOrigin = "https://chat.crmnamao.cloud";

function toOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

const frameAncestorOrigins = (
  process.env.CHATWOOT_FRAME_ANCESTORS ??
  process.env.CHATWOOT_BASE_URL ??
  defaultChatwootOrigin
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map(toOrigin);

const frameAncestorsValue = ["'self'", ...new Set(frameAncestorOrigins)].join(" ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              "script-src 'self' 'unsafe-inline'",
              "connect-src 'self'",
              `frame-ancestors ${frameAncestorsValue}`,
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
