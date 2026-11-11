# ClipDock website and web app

The root contains the Android app landing page. The browser downloader lives at `/app/` and uses the ClipDock companion media API. GitHub Pages publishes the root of `main`.

For local preview, run `python3 -m http.server 8765`. For local media requests, point `app/config.js` at an HTTPS development backend that allows your exact browser origin.

The backend supports `POST /bootstrap`, `POST /inspect`, and `POST /download`. The web app obtains a short-lived session from the configured bootstrap URL. The current deployment uses a Cloudflare quick tunnel. Update the bootstrap URL if the tunnel hostname changes.

The web app sends files to the browser download manager.
