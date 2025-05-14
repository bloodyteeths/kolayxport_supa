/** @type {import('next').NextConfig} */
// const path = require('path'); // Removed

const nextConfig = {
  reactStrictMode: true,
  // webpack: (config) => { // Removed section
  //   config.resolve.alias['@'] = path.resolve(__dirname);
  //   return config;
  // },
  transpilePackages: [
    '@mui/x-data-grid',
    // If you ever use Pro or Advanced, add those too:
    // '@mui/x-data-grid-pro',
    // '@mui/x-data-grid-premium',
  ],
};

module.exports = nextConfig;