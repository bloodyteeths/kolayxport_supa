import sharp from 'sharp';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

async function generateIcon(size, filename) {
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${Math.round(size * 0.15)}" fill="#2563eb"/>
      <text
        x="50%" y="54%"
        font-family="Arial, Helvetica, sans-serif"
        font-weight="bold"
        font-size="${Math.round(size * 0.38)}"
        fill="white"
        text-anchor="middle"
        dominant-baseline="middle"
      >KX</text>
    </svg>`;

  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(publicDir, filename));

  console.log(`Generated ${filename} (${size}x${size})`);
}

await generateIcon(192, 'icon-192x192.png');
await generateIcon(512, 'icon-512x512.png');
console.log('PWA icons generated successfully.');
