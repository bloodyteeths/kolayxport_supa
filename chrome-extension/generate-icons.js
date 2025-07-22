/**
 * Simple icon generator for Chrome extension
 * Creates basic branded icons in different sizes
 */

const fs = require('fs');
const path = require('path');

// Create icons directory if it doesn't exist
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir);
}

// SVG template for the icon
const createSvg = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="${size}" height="${size}" rx="${size * 0.15}" fill="#1976d2"/>
  
  <!-- Letter K -->
  <text x="50%" y="50%" 
        font-family="Arial, sans-serif" 
        font-size="${size * 0.5}px" 
        font-weight="bold" 
        fill="white" 
        text-anchor="middle" 
        dominant-baseline="central">K</text>
  
  <!-- Sync arrows (small) -->
  <g transform="translate(${size * 0.65}, ${size * 0.65})">
    <path d="M 0 -${size * 0.1} A ${size * 0.1} ${size * 0.1} 0 0 1 ${size * 0.1} 0" 
          fill="none" 
          stroke="white" 
          stroke-width="${size * 0.03}" 
          stroke-linecap="round"/>
    <path d="M ${size * 0.1} 0 L ${size * 0.08} -${size * 0.03} L ${size * 0.08} ${size * 0.03} Z" 
          fill="white"/>
  </g>
</svg>
`;

// Icon sizes required for Chrome extensions
const sizes = [16, 32, 48, 128];

// Generate icons
sizes.forEach(size => {
  const svg = createSvg(size);
  const filename = path.join(iconsDir, `icon-${size}.png`);
  
  // For this simple implementation, we'll save as SVG files
  // In production, you'd convert these to PNG using a library like sharp or canvas
  const svgFilename = path.join(iconsDir, `icon-${size}.svg`);
  fs.writeFileSync(svgFilename, svg);
  
  console.log(`Created ${svgFilename}`);
});

// Create a simple README for the icons
const iconsReadme = `# Extension Icons

This directory contains the icons for the Kolayxport Etsy Sync Chrome extension.

## Icon Sizes
- 16x16: Used in the Chrome toolbar when the extension is pinned
- 32x32: Used in the Chrome extensions page
- 48x48: Used in the Chrome Web Store listing
- 128x128: Used in the Chrome Web Store detail page

## Converting SVG to PNG
To convert the SVG files to PNG format required by Chrome:

1. Using ImageMagick:
   \`\`\`bash
   for size in 16 32 48 128; do
     convert -background none icon-\${size}.svg icon-\${size}.png
   done
   \`\`\`

2. Using online tools:
   - https://cloudconvert.com/svg-to-png
   - https://convertio.co/svg-png/

3. Using Node.js with sharp:
   \`\`\`bash
   npm install sharp
   # Then run a conversion script
   \`\`\`

## Design Guidelines
- Use the Kolayxport brand color (#1976d2)
- Keep the design simple and recognizable at small sizes
- Include visual hint about syncing/integration functionality
`;

fs.writeFileSync(path.join(iconsDir, 'README.md'), iconsReadme);

console.log('\nIcon generation complete!');
console.log('Note: The generated files are in SVG format.');
console.log('Please convert them to PNG format before using in the extension.');
console.log('See icons/README.md for conversion instructions.');