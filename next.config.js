/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Allow SharePoint (*.sharepoint.com) to embed this app in an iframe
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://*.sharepoint.com https://*.office.com",
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
