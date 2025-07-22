# Kolayxport Etsy Order Sync Chrome Extension

Seamlessly sync your Etsy Shop Manager orders with Kolayxport for efficient shipping label generation and order management.

## 🚀 Quick Start

1. **Install the Extension**
   - Download from Chrome Web Store (coming soon)
   - Or load unpacked for development (see below)

2. **Log in to Kolayxport**
   - Visit https://app.kolayxport.com
   - Sign in to your account

3. **Visit Etsy Orders**
   - Go to https://www.etsy.com/your/orders/sold
   - Extension automatically starts syncing!

## 🛠 Development Setup

```bash
# Clone the repository
git clone [repository-url]
cd mybaby-sync-product/chrome-extension

# Generate icons (requires Node.js)
node generate-icons.js

# Convert SVG icons to PNG
# Using ImageMagick:
cd icons
for size in 16 32 48 128; do
  convert -background none icon-${size}.svg icon-${size}.png
done
cd ..
```

### Loading in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `chrome-extension` directory

## 📁 Project Structure

```
chrome-extension/
├── manifest.json         # Extension configuration
├── src/
│   ├── content.js       # Runs on Etsy pages
│   ├── background.js    # Service worker
│   ├── popup.html       # Extension popup
│   ├── popup.js         # Popup logic
│   └── popup.css        # Popup styles
├── icons/               # Extension icons
├── docs/               # Documentation
│   └── PRIVACY_POLICY.md
├── EXTENSION.md        # Detailed documentation
└── README.md          # This file
```

## ✨ Features

- **Automatic Sync**: Orders sync in real-time as you browse
- **Bulk Import**: Import all historical orders with one click
- **Duplicate Prevention**: Never sync the same order twice
- **Secure**: Uses your existing Kolayxport session
- **Privacy-First**: All processing happens in your browser

## 🔒 Security & Privacy

- No data leaves your browser except to your Kolayxport account
- No tracking or analytics
- Minimal permissions required
- Open source for transparency

See [Privacy Policy](docs/PRIVACY_POLICY.md) for details.

## 🐛 Troubleshooting

**Extension not working?**
- Ensure you're logged in to Kolayxport
- Check you're on the correct Etsy page
- Try refreshing the page
- Check the browser console for errors

**Can't see orders?**
- Make sure you're on `/your/orders/sold`
- Check if Etsy has changed their UI
- Report issues on GitHub

## 📝 License

This extension is proprietary software owned by Kolayxport. 
See LICENSE file for details.

## 🤝 Contributing

We welcome contributions! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📞 Support

- Email: support@kolayxport.com
- Documentation: https://app.kolayxport.com/help
- Issues: [GitHub Issues](repository-url/issues)

## 🚦 Status

- ✅ Core functionality complete
- ✅ Manifest V3 compliant
- ⏳ Chrome Web Store submission pending
- 🔄 Regular updates for Etsy UI changes

---

Made with ❤️ by the Kolayxport team