# Experience — where to look

Thursday's rotation. Look where a visitor feels it: the public pages of WeMeditateWeb, the atlas
widget on a host site, and the admin screens people use daily in SahajCloud.

- **Performance** — the first load of the most-visited routes, image sizes and formats, data
  fetched on the server and fetched again in the client, caching headers, and bundle weight the
  embed adds to a host page.
- **Accessibility** — interactive controls without a name, focus lost in dialogs and the map,
  colour contrast in both themes, motion without a reduced-motion path. Check the rendered page,
  not only the source.
- **i18n completeness** — anything user-facing with a locale: hard-coded strings, keys missing
  from one locale's file, dates and numbers formatted without the locale, untranslated SEO
  metadata.
- **UX consistency** — the same action spelled, placed or confirmed differently across screens,
  and components duplicated instead of reused from the design system.
- **SEO and discoverability** — titles, descriptions and canonical URLs per route and locale,
  `hreflang`, the sitemap and `robots.txt` against the real routes, structured data, and status
  codes on missing content (a soft 404 is a finding).
