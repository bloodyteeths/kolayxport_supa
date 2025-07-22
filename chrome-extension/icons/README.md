# Extension Icons

This directory contains the icons for the Kolayxport Etsy Sync Chrome extension.

## Icon Sizes
- 16x16: Used in the Chrome toolbar when the extension is pinned
- 32x32: Used in the Chrome extensions page
- 48x48: Used in the Chrome Web Store listing
- 128x128: Used in the Chrome Web Store detail page

## Converting SVG to PNG
To convert the SVG files to PNG format required by Chrome:

1. Using ImageMagick:
   ```bash
   for size in 16 32 48 128; do
     convert -background none icon-${size}.svg icon-${size}.png
   done
   ```

2. Using online tools:
   - https://cloudconvert.com/svg-to-png
   - https://convertio.co/svg-png/

3. Using Node.js with sharp:
   ```bash
   npm install sharp
   # Then run a conversion script
   ```

## Design Guidelines
- Use the Kolayxport brand color (#1976d2)
- Keep the design simple and recognizable at small sizes
- Include visual hint about syncing/integration functionality
