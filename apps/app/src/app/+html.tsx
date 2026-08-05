import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

// Root HTML document for the web build (static rendering). Runs only in Node
// at export time — no global CSS or browser APIs here. This is where the PWA
// manifest, theme colour, Apple meta, and service-worker registration live.

// ponytail: network-first SW (see public/sw.js) so this can't cache users into
// a stale build. Registration is best-effort and never blocks the app.
const swRegister = `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />

        {/* PWA — a client clone edits public/manifest.json + these values to rebrand. */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#2a7f62" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="blnk" />
        <link rel="apple-touch-icon" href="/icon-192.png" />

        {/* Disables body scrolling on web so RN ScrollViews behave like native. */}
        <ScrollViewStyleReset />
        <script dangerouslySetInnerHTML={{ __html: swRegister }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
