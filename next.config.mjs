/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },

  images: {
    unoptimized: true,
  },

  transpilePackages: ['niimbot-web-bluetooth'],

  experimental: {
    turbo: {
      // Настройки Turbopack
    },
  },
}

export default nextConfig