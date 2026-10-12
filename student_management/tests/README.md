# UI regression checks

Run `npm ci`, `npx playwright install chromium`, `npm run build`, then `npm run test:ui`.

The test serves the production build through browser request interception, so no development server is required. It checks five screens at widths 320, 390, 640, 768, 1024, 1440 and 1920 pixels, then exercises mobile navigation, search, modal focus, student creation, invoice allocation, attendance and invalid login. All API requests use fixtures; no real student or financial records are modified.

Use `CHROMIUM_PATH` to select an existing Chromium executable. Screenshots are written to `/tmp`.

`npm run test:excel-ui` checks Excel preview, explicit missing-ID selection, confirmation, export download and the database setup gate at mobile/tablet/desktop sizes. It also uses intercepted API fixtures.
