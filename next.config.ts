import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // hpke-js imports node:crypto but uses Web Crypto API at runtime.
      // Alias the node: protocol import to a false module for client builds.
      config.resolve.alias = {
        ...config.resolve.alias,
        'node:crypto': false,
      };
    }
    return config;
  },
};

export default nextConfig;
