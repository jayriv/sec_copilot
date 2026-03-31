/** @type {import('next').NextConfig} */
const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig = {
  reactStrictMode: true,
  output: "export",
  images: {
    unoptimized: true
  },
  trailingSlash: true,
  ...(isGitHubPages
    ? {
        basePath: "/sec_copilot",
        assetPrefix: "/sec_copilot/"
      }
    : {})
};

module.exports = nextConfig;
