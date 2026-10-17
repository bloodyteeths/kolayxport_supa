# Customer testimonials (real ones only)

The home page shows a "Satıcılarımız ne diyor" section **only** when this folder contains at least one valid file.

1. Get the customer's **written consent**: e-mail or a signed form that covers the exact text, their name or shop name, and where it will be shown. Keep it on file; it is revocable.
2. Add one JSON file per testimonial, for example `atolye-x.json`:

```json
{
  "consent": true,
  "consentRef": "e-mail 2026-11-03, stored in Drive /Testimonials/atolye-x.pdf",
  "locale": "tr",
  "quote": "Their exact words, unedited except for typos they approved.",
  "name": "Ayşe K.",
  "shop": "Atölye X (Etsy)",
  "since": "2026-11"
}
```

Files without `"consent": true` and a `consentRef` are ignored. Never write a testimonial yourself, never combine quotes, and never attach a quote to an AI-generated photo.
