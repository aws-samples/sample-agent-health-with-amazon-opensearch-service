/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully static export (no server). Produces `out/` for static hosting
  // (Amplify WEB). The chat calls AgentCore directly from the browser.
  output: 'export',
  // Static export can't optimize images at runtime; serve them as-is.
  images: { unoptimized: true },
};

module.exports = nextConfig;
