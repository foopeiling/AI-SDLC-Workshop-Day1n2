import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.PLAYWRIGHT_E2E === 'true'
    ? process.env.NEXT_DIST_DIR ?? '.next-playwright'
    : '.next',
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;