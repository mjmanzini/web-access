/** @type {import('next').NextConfig} */
const isStaticExport = process.env.WEB_CLIENT_OUTPUT_MODE === 'export';

const nextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  ...(isStaticExport
    ? {
        output: 'export',
        trailingSlash: true,
      }
    : {}),
};
module.exports = nextConfig;
