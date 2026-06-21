/** @type {import('next').NextConfig} */
const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development', // Disable PWA in dev to avoid caching issues
  register: true,
  skipWaiting: true,
});

module.exports = withPWA({
  reactStrictMode: true,
  transpilePackages: ["ui"],
});