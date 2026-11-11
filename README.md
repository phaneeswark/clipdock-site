# ClipDock Web

Browser version of ClipDock for choosing and downloading MP4 video and MP3 audio from supported public YouTube, Instagram and X links. It uses the same companion media API as the Android app.

## Run and publish

Run `python3 -m http.server 8765` and open `http://localhost:8765/`. For media requests in local development, use a development backend that allows that exact browser origin. GitHub Pages publishes the root of `main`.

Set the public HTTPS discovery URL in `config.js`. The backend must support `POST /bootstrap`, `POST /inspect`, and `POST /download` and allow the site's browser origin via CORS, including preflights. The browser requests short-lived session credentials from the backend. The current backend uses a Cloudflare quick tunnel. If its hostname changes, update the config and redeploy.

Downloads use browser download settings. Library copies live in IndexedDB and can be played or removed locally. Clearing browser data can remove these copies. Removing a Library copy leaves the downloaded file on disk.
