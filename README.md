# Timeline Project - Ready for GitHub Pages

Files in this folder:

- `timeline.html` — main page (loads `timeline.js`)
- `timeline.js` — JavaScript logic (parses CSV and renders timeline)
- `timeline-data.csv` — your events (this is your exported Google Sheet)
- `README.md` — this file

## How to publish on GitHub Pages

1. Create a public repository on GitHub.
2. Upload all files from this folder to the repository root.
3. In the repository settings, enable **Pages** and choose the `main` branch (root).
4. After a minute your site will be available at `https://yourusername.github.io/repo-name`.

## Notes for Android users

Some Android browsers block loading local files with `fetch()` when you open `timeline.html` directly from your phone storage. If you see a notice at the bottom, try one of these:

- Open with **Firefox for Android** (it allows local CSV load).  
- Install a simple local web server app and serve the folder, then open `http://localhost:PORT/timeline.html`.  
- Or deploy to GitHub Pages (recommended) — works on any device.

If you want me to embed the CSV directly into `timeline.js` to avoid `fetch()`, say “Embed CSV” and I will produce that variant.
