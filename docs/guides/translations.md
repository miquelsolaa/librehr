# Internationalization and Translation Guide

OpenHR natively supports three initial languages:

- **Catalan (`ca`)** (Default locale)
- **Spanish (`es`)**
- **English (`en`)**

## Catalog Structure

Message catalogs live in `packages/i18n/messages/`:

- `ca.json`
- `es.json`
- `en.json`

## Rules for Adding Translations

1. **Symmetric Keys:** Every key added to one locale must be added to all three locales.
2. **ICU Message Syntax:** Use ICU syntax for plurals and interpolation:
   ```json
   "welcome": "Hola, {name}",
   "leaveCount": "{count, plural, =0 {Cap dia} one {1 dia} other {# dies}}"
   ```
3. **Tone of Voice:** Catalan and Spanish copy uses a polite, informal-friendly tone ("tu"). Avoid surveillance jargon.
4. **Validation:** Always run:
   ```bash
   pnpm i18n:check
   ```
   CI will fail if any key is missing or mismatched across the catalogs.
