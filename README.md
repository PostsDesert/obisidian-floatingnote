# Floating Quick Note

Floating Quick Note is an Obsidian plugin that lets you open a small, detached note window that stays on top of your other apps. It is great for taking notes during meetings or while you are working in other programs without having to switch back and forth to Obsidian.

## What it does

- Opens a floating window that stays visible even when you use other apps like Meet, Zoom or Teams.
- Uses a single floating window with tabs instead of opening multiple separate windows.
- You can choose between opening a new note every time or reusing a floating note set based on your Daily Notes settings.
- You can toggle the reusable note from any app with a global shortcut.
- Comes with a button in the sidebar for quick access.
- You can customize the window size, transparency, and where your notes are saved.

## How to use it

1. Click the pin icon in the sidebar to open a floating quick note.
2. Use the command palette (Cmd/Ctrl + P) and search for `Toggle reusable quick note (floating)` to open or close the reusable note set. The main note follows your Daily Notes folder and format.
3. Use the command palette and search for `Open new note` when you want a fresh file. If the floating window is already open, the new note is added as another tab in that same window.
4. Set the plugin's global shortcut if you want to toggle the reusable note while another app is focused.
5. You can also set up Obsidian keyboard shortcuts in the app settings if you use them often.

## Settings

You can find the settings for this plugin under **Settings -> Floating Quick Note**. Here you can change:

- **Notes folder**: Where new quick notes are stored.
- **Title format**: How new quick notes are named.
- **Global shortcut**: Click the current shortcut or **Record shortcut**, then press the key combination you want to use from any app. Press Escape to cancel or click **Clear** to disable it.
- **Default content**: What text should be in a new note by default.
- **Additional reusable notes**: Extra vault-relative note paths to open alongside the main reusable note.
- **Always on top**: Whether the window should stay above other apps.
- **Window size and opacity**: Adjust how big and how transparent the window is.

The reusable floating note uses your Obsidian Daily Notes settings when available, including custom formats like `GGGG-[W]ww`. Additional reusable notes are configured as one vault-relative path per line and are created automatically if missing. The reusable note set opens as tabs inside one floating window, keeps the main date-based note as the first reusable tab, and remembers which reusable tab was focused last so it can restore that tab next time; if that note is no longer part of the reusable set, it falls back to the main date-based tab. When launched from Obsidian it opens on the current Obsidian display; when launched with the global shortcut it opens on the display containing your mouse cursor.

## Installation

Requires Obsidian Desktop 1.4.0 or newer.

### From the Obsidian Community Store
1. Open Obsidian and go to **Settings**.
2. Select **Community plugins**.
3. Click **Browse** and search for "Floating Quick Note".
4. Click **Install**, then **Enable**.

### Manual installation (for testing)
1. Create a folder named `floating-quick-note` in your vault's `.obsidian/plugins/` directory.
2. Copy the `main.js` and `manifest.json` files into that folder.
3. Enable the plugin in the Obsidian settings.

## Releasing

Update `package.json`, `manifest.json`, and `versions.json` together, run
`npm ci --ignore-scripts`, `npm run lint`, `npm test -- --runInBand`, and
`npm run build`, then commit the updated source and `main.js`.

Push a tag matching the version exactly (for example, `1.0.1`, without a `v`
prefix). The release workflow builds from that tag, attests `main.js` and
`manifest.json`, and uploads those exact files to a draft GitHub release.
Review and publish the draft before asking the Obsidian reviewer to recheck it.
Do not replace those assets with a local build: the attestation covers their
exact contents. Existing `1.0.0` assets are not changed by this workflow.

Verify a downloaded release asset with:

```sh
gh attestation verify main.js --repo sabosman/obisidian-floatingnote
```
