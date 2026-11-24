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
- **Global shortcut**: A system-wide accelerator that toggles the reusable floating note.
- **Default content**: What text should be in a new note by default.
- **Additional reusable notes**: Extra vault-relative note paths to open alongside the main reusable note.
- **Always on top**: Whether the window should stay above other apps.
- **Window size and opacity**: Adjust how big and how transparent the window is.

The reusable floating note uses your Obsidian Daily Notes settings when available, including custom formats like `GGGG-[W]ww`. Additional reusable notes are configured as one vault-relative path per line and are created automatically if missing. The reusable note set opens as tabs inside one floating window, keeps the main date-based note as the first reusable tab, and remembers which reusable tab was focused last so it can restore that tab next time; if that note is no longer part of the reusable set, it falls back to the main date-based tab. When launched from Obsidian it opens on the current Obsidian display; when launched with the global shortcut it opens on the display containing your mouse cursor.

## Installation

### From the Obsidian Community Store
1. Open Obsidian and go to **Settings**.
2. Select **Community plugins**.
3. Click **Browse** and search for "Floating Quick Note".
4. Click **Install**, then **Enable**.

### Manual installation (for testing)
1. Create a folder named `floating-quick-note` in your vault's `.obsidian/plugins/` directory.
2. Copy the `main.js` and `manifest.json` files into that folder.
3. Enable the plugin in the Obsidian settings.
