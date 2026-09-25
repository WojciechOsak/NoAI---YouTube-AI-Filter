# NoAI — YouTube AI Filter

Privacy-policy website and Chrome extension source for NoAI.

**Privacy policy:** https://wojciechosak.github.io/NoAI---YouTube-AI-Filter/

[☕ Buy me a coffee](https://buymeacoffee.com/osakwojcie1)

## Website

Static HTML and CSS, with no JavaScript, analytics, external fonts, or build dependencies. GitHub Pages publishes the root of the `main` branch.

- `index.html` — English privacy policy.
- `styles.css` — responsive layout, keyboard focus styles, and print styles.
- `favicon.svg` — site icon.
- `.nojekyll` — serves the static files without Jekyll processing.

Open `index.html` in a browser to preview. Edit the policy and its last-updated date when the extension's data practices change, then push to `main` to publish.

## Extension

`extension/` contains the Chrome extension, based on the published 0.2.1 package. Version 0.2.2 also scans the current recommendation cards beside YouTube videos. Run `node tests/collect-items.test.cjs` to check that behavior.

The source package can be loaded unpacked from `extension/`. A Chrome Web Store update requires uploading a new ZIP and approval there.

## Policy basis

The policy follows the extension behavior: local preferences and checked-video cache, YouTube disclosure checks, and no developer backend or analytics. Recheck the policy when the extension's implementation changes.
