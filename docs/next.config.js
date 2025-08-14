const withNextra = require('nextra')({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  defaultShowCopyCode: true,
});

module.exports = withNextra({
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    esmExternals: false,
  },
  images: {
    unoptimized: true,
  },
});
