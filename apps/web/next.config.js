/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['react-syntax-highlighter', 'refractor', 'ui'],
  images: {
    domains: [
      'lh3.googleusercontent.com',
      'avatars.githubusercontent.com',
      'res.cloudinary.com'
    ],
  },
  webpack: (config) => {
    // This ensures CJS versions are used for syntax highlighting to prevent ESM errors
    config.resolve.alias = {
      ...config.resolve.alias,
      'react-syntax-highlighter': 'react-syntax-highlighter/dist/cjs',
    };
    return config;
  },
};

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
});

module.exports = withPWA(nextConfig);