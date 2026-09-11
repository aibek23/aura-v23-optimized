/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },

  images: {
    unoptimized: true,
  },

  transpilePackages: ['niimbot-web-bluetooth'],

  async rewrites() {
    return [
      { source: '/crm/pos', destination: '/pos' },
      { source: '/crm/showcase', destination: '/showcase' },
      { source: '/crm/inventory', destination: '/inventory' },
      { source: '/crm/customers', destination: '/customers' },
      { source: '/crm/reports', destination: '/reports' },
      { source: '/crm/stores', destination: '/stores' },
      { source: '/crm/notifications', destination: '/notifications' },
      { source: '/crm/suppliers', destination: '/suppliers' },
      { source: '/crm/cabinet', destination: '/cabinet' },
    ]
  },

  async redirects() {
    return [
      { source: '/pos', destination: '/crm/pos', permanent: false },
      { source: '/showcase', destination: '/crm/showcase', permanent: false },
      { source: '/inventory', destination: '/crm/inventory', permanent: false },
      { source: '/customers', destination: '/crm/customers', permanent: false },
      { source: '/reports', destination: '/crm/reports', permanent: false },
      { source: '/stores', destination: '/crm/stores', permanent: false },
      { source: '/notifications', destination: '/crm/notifications', permanent: false },
      { source: '/suppliers', destination: '/crm/suppliers', permanent: false },
      { source: '/cabinet', destination: '/crm/cabinet', permanent: false },
    ]
  },
}

export default nextConfig