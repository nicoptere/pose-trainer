import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  // Optional: Disable image optimization since it requires a Node server
  images: {
    unoptimized: true,
  },
  // Note: Rewrites don't work with 'output: export' for production, 
  // but can work for dev. However, since we are doing static export, 
  // we rely on Flask serving /api calls in production.
  // For dev, we can manual proxy or just run Flask on 3000? No, standard is proxy.
  // But 'output: export' disables rewrites/redirects/headers.
  // We will assume valid configuration for static build.
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
