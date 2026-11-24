/**
 * Tests for FloatingNotePlugin (main.ts)
 *
 * Obsidian, Electron, and @electron/remote are fully mocked so these tests
 * run in plain Node without any browser or Obsidian runtime.
 */

import { App, moment, TFile, WorkspaceLeaf } from "obsidian";
import { app as electronApp, globalShortcut, remote, mockWin, screen } from "../__mocks__/electron";

// We import the plugin class *after* jest module mocks are in place.
// ts-jest will pick up jest.config.js moduleNameMapper automatically.
import FloatingNotePlugin from "../main.ts";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Construct a TFile with a path without fighting obsidian's zero-arg type declaration. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mkTFile = (path: string, contents?: string): TFile => {
    const file = new (TFile as any)(path) as TFile & { contents?: string };
    if (contents !== undefined) {
        file.contents = contents;
    }
    return file;
};

type EditorState = {
    getValue(): string;
    cursor: { line: number; ch: number };
    scrollTarget: { from: { line: number; ch: number }; to: { line: number; ch: number } } | null;
    focused: boolean;
};

type LeafWithEditor = WorkspaceLeaf & {
    view: WorkspaceLeaf["view"] & {
        editor?: EditorState;
    };
};

/** Create a plugin instance wired to a fresh mocked App */
function makePlugin(): FloatingNotePlugin {
    const app = new App() as unknown as import("obsidian").App;
    // The Plugin constructor in obsidian's real API takes (app, manifest).
    // Our mock extends EventEmitter so we can call new directly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugin = new (FloatingNotePlugin as any)(app, { id: "test", name: "test" });
    return plugin as FloatingNotePlugin;
}

function getInternalPlugins(app: App): {
    getPluginById: jest.Mock;
} {
    return (app as unknown as { internalPlugins: { getPluginById: jest.Mock } }).internalPlugins;
}

function getWorkspace(app: App): {
    activeLeaf: WorkspaceLeaf | null;
    createdLeaves: WorkspaceLeaf[];
    openPopoutLeaf: jest.Mock;
    getLeaf: jest.Mock;
    setActiveLeaf: jest.Mock;
    on: jest.Mock;
} {
    return (app as unknown as {
        workspace: {
            activeLeaf: WorkspaceLeaf | null;
            createdLeaves: WorkspaceLeaf[];
            openPopoutLeaf: jest.Mock;
            getLeaf: jest.Mock;
            setActiveLeaf: jest.Mock;
            on: jest.Mock;
        };
    }).workspace;
}

function getCreatedLeaf(app: App, index = 0): LeafWithEditor {
    return getWorkspace(app).createdLeaves[index] as LeafWithEditor;
}

function getCreatedLeaves(app: App): LeafWithEditor[] {
    return getWorkspace(app).createdLeaves as LeafWithEditor[];
}

function getSessionLeaves(leaf: LeafWithEditor): LeafWithEditor[] {
    return (leaf as unknown as { session: { leaves: LeafWithEditor[] } }).session.leaves;
}

function getOpenedPath(leaf: LeafWithEditor): string {
    return ((leaf.openFile as jest.Mock).mock.calls[0][0] as TFile).path;
}

function makePopoutLeaf(plugin: FloatingNotePlugin) {
    return getWorkspace(plugin.app).openPopoutLeaf() as {
        popoutBrowserWindow: {
            setAlwaysOnTop: jest.Mock;
            setVisibleOnAllWorkspaces: jest.Mock;
            setOpacity: jest.Mock;
            setTitle: jest.Mock;
        };
        popoutElectronModule: {
            remote: {
                getCurrentWindow: jest.Mock;
            };
        };
        popoutRemoteModule: {
            getCurrentWindow: jest.Mock;
            default: {
                getCurrentWindow: jest.Mock;
            };
        };
    };
}

let consoleLogSpy: jest.SpyInstance;

beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    mockWin.isFocusable.mockReturnValue(true);
    mockWin.setFocusable.mockImplementation(() => undefined);
});

afterEach(() => {
    consoleLogSpy.mockRestore();
});

// ── loadSettings ───────────────────────────────────────────────────────────

describe("loadSettings", () => {
    it("applies DEFAULT_SETTINGS when no saved data exists", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();

        expect(plugin.settings.noteFolder).toBe("Quick Notes");
        expect(plugin.settings.noteTitleFormat).toBe("[Quick] - YYYY-MM-DD HH[h]mm");
        expect(plugin.settings.globalShortcut).toBe("Ctrl+`");
        expect(plugin.settings.windowWidth).toBe(480);
        expect(plugin.settings.windowHeight).toBe(600);
        expect(plugin.settings.alwaysOnTop).toBe(true);
        expect(plugin.settings.opacity).toBe(100);
        expect(plugin.settings.extraReusableNotePaths).toEqual([]);
        expect(plugin.settings.lastFocusedReusableNotePath).toBe("");
    });

    it("migrates legacy noteFolder from 'Call Notes' → 'Quick Notes'", async () => {
        const plugin = makePlugin();
        (plugin as unknown as { _setSavedData: (d: object) => void })._setSavedData({
            noteFolder: "Call Notes",
        });
        await plugin.loadSettings();
        expect(plugin.settings.noteFolder).toBe("Quick Notes");
    });

    it("migrates legacy noteTitleFormat from call format → quick format", async () => {
        const plugin = makePlugin();
        (plugin as unknown as { _setSavedData: (d: object) => void })._setSavedData({
            noteTitleFormat: "Call - YYYY-MM-DD HH[h]mm",
        });
        await plugin.loadSettings();
        expect(plugin.settings.noteTitleFormat).toBe("[Quick] - YYYY-MM-DD HH[h]mm");
    });

    it("migrates old 'Quick - ...' title format (no square brackets)", async () => {
        const plugin = makePlugin();
        (plugin as unknown as { _setSavedData: (d: object) => void })._setSavedData({
            noteTitleFormat: "Quick - YYYY-MM-DD HH[h]mm",
        });
        await plugin.loadSettings();
        expect(plugin.settings.noteTitleFormat).toBe("[Quick] - YYYY-MM-DD HH[h]mm");
    });

    it("wraps bare 'Note' title format in square brackets", async () => {
        const plugin = makePlugin();
        (plugin as unknown as { _setSavedData: (d: object) => void })._setSavedData({
            noteTitleFormat: "Note",
        });
        await plugin.loadSettings();
        expect(plugin.settings.noteTitleFormat).toBe("[Note]");
    });

    it("migrates legacy defaultNoteContent from call template → quick template", async () => {
        const plugin = makePlugin();
        (plugin as unknown as { _setSavedData: (d: object) => void })._setSavedData({
            defaultNoteContent: "# 📞 Call Notes\n\n**Date:** {{date}}\n\n---\n\n",
        });
        await plugin.loadSettings();
        expect(plugin.settings.defaultNoteContent).toBe(
            "# Quick Notes\n\n**Date:** {{date}}\n\n---\n\n"
        );
    });

    it("preserves user-customised settings without migrating them", async () => {
        const plugin = makePlugin();
        (plugin as unknown as { _setSavedData: (d: object) => void })._setSavedData({
            noteFolder: "My Custom Folder",
            noteTitleFormat: "[Meeting] YYYY-MM-DD",
            windowWidth: 800,
            opacity: 80,
            alwaysOnTop: false,
        });
        await plugin.loadSettings();
        expect(plugin.settings.noteFolder).toBe("My Custom Folder");
        expect(plugin.settings.noteTitleFormat).toBe("[Meeting] YYYY-MM-DD");
        expect(plugin.settings.windowWidth).toBe(800);
        expect(plugin.settings.opacity).toBe(80);
        expect(plugin.settings.alwaysOnTop).toBe(false);
    });

    it("normalizes reusable-note paths and remembered focus path", async () => {
        const plugin = makePlugin();
        (plugin as unknown as { _setSavedData: (d: object) => void })._setSavedData({
            extraReusableNotePaths: [" Ideas ", "", "Projects/Ideas.md", "Ideas.md"],
            lastFocusedReusableNotePath: " /Projects/Ideas ",
        });

        await plugin.loadSettings();

        expect(plugin.settings.extraReusableNotePaths).toEqual([
            "Ideas.md",
            "Projects/Ideas.md",
        ]);
        expect(plugin.settings.lastFocusedReusableNotePath).toBe("Projects/Ideas.md");
    });

    it("defaults invalid remembered focus data", async () => {
        const plugin = makePlugin();
        (plugin as unknown as { _setSavedData: (d: object) => void })._setSavedData({
            extraReusableNotePaths: "Ideas.md",
            lastFocusedReusableNotePath: 42,
        });

        await plugin.loadSettings();

        expect(plugin.settings.extraReusableNotePaths).toEqual([]);
        expect(plugin.settings.lastFocusedReusableNotePath).toBe("");
    });
});

// ── onload / global shortcut ──────────────────────────────────────────────

describe("onload", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        globalShortcut.register.mockReturnValue(true);
        remote.BrowserWindow.getAllWindows.mockReturnValue([mockWin]);
    });

    it("registers the default global shortcut", async () => {
        const plugin = makePlugin();

        await plugin.onload();

        expect(globalShortcut.unregister).toHaveBeenCalledWith("Ctrl+`");
        expect(globalShortcut.register).toHaveBeenCalledWith("Ctrl+`", expect.any(Function));
        expect(getWorkspace(plugin.app).on).toHaveBeenCalledWith(
            "window-close",
            expect.any(Function)
        );
        expect(getWorkspace(plugin.app).on).toHaveBeenCalledWith(
            "active-leaf-change",
            expect.any(Function)
        );
    });
});

describe("updateGlobalShortcut", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        globalShortcut.register.mockReturnValue(true);
        remote.BrowserWindow.getAllWindows.mockReturnValue([mockWin]);
    });

    it("re-registers the global shortcut when changed", async () => {
        const plugin = makePlugin();
        await plugin.onload();

        await plugin.updateGlobalShortcut("Ctrl+Shift+Space");

        expect(globalShortcut.unregister).toHaveBeenCalledWith("Ctrl+`");
        expect(globalShortcut.unregister).toHaveBeenCalledWith("Ctrl+Shift+Space");
        expect(globalShortcut.register).toHaveBeenLastCalledWith(
            "Ctrl+Shift+Space",
            expect.any(Function)
        );
        expect(plugin.settings.globalShortcut).toBe("Ctrl+Shift+Space");
    });

    it("reclaims the configured shortcut even when no prior registration is tracked", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();

        await plugin.updateGlobalShortcut("Ctrl+Shift+Space");

        expect(globalShortcut.unregister).toHaveBeenCalledWith("Ctrl+Shift+Space");
        expect(globalShortcut.register).toHaveBeenCalledWith(
            "Ctrl+Shift+Space",
            expect.any(Function)
        );
    });
});

// ── createNewQuickNote ─────────────────────────────────────────────────────

describe("createNewQuickNote", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("creates a note at <folder>/<formatted-title>.md", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        // Ensure folder path is set
        plugin.settings.noteFolder = "Quick Notes";

        const mockFile = mkTFile("Quick Notes/[Quick] - 2026-02-24 10h00.md");
        (plugin.app.vault.create as jest.Mock).mockResolvedValueOnce(mockFile);
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(null);

        const file = await (plugin as unknown as { createNewQuickNote(): Promise<TFile> }).createNewQuickNote();

        expect(plugin.app.vault.create).toHaveBeenCalledTimes(1);
        const [calledPath, calledContent] = (plugin.app.vault.create as jest.Mock).mock.calls[0];
        expect(calledPath).toMatch(/^Quick Notes\//);
        expect(calledPath).toMatch(/\.md$/);
        expect(calledContent).not.toContain("{{date}}");
        expect(file).toBe(mockFile);
    });

    it("creates note at vault root when noteFolder is empty", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.noteFolder = "";

        const mockFile = mkTFile("Quick - 2026-02-24 10h00.md");
        (plugin.app.vault.create as jest.Mock).mockResolvedValueOnce(mockFile);

        await (plugin as unknown as { createNewQuickNote(): Promise<TFile> }).createNewQuickNote();

        const [calledPath] = (plugin.app.vault.create as jest.Mock).mock.calls[0];
        expect(calledPath).not.toContain("/");
        expect(calledPath).toMatch(/\.md$/);
    });

    it("falls back to '(2)' suffix when the file already exists (same minute)", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.noteFolder = "Quick Notes";

        const mockFile = mkTFile("Quick Notes/note (2).md");
        // First create call rejects (collision); second resolves
        (plugin.app.vault.create as jest.Mock)
            .mockRejectedValueOnce(new Error("File already exists"))
            .mockResolvedValueOnce(mockFile);

        const file = await (plugin as unknown as { createNewQuickNote(): Promise<TFile> }).createNewQuickNote();

        expect(plugin.app.vault.create).toHaveBeenCalledTimes(2);
        const [, collisionPath] = (plugin.app.vault.create as jest.Mock).mock.calls.map((c) => c[0]);
        expect(collisionPath).toMatch(/\(2\)\.md$/);
        expect(file).toBe(mockFile);
    });
});

// ── getOrCreateReusableQuickNote ───────────────────────────────────────────

describe("getOrCreateReusableQuickNote", () => {
    beforeEach(() => jest.clearAllMocks());

    it("returns the existing TFile without creating a new one", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        const weeklyTitle = moment().format("GGGG-[W]ww");
        getInternalPlugins(plugin.app).getPluginById.mockReturnValue({
            enabled: true,
            instance: { options: { folder: "Weekly Notes", format: "GGGG-[W]ww" } },
        });

        const existing = mkTFile(`Weekly Notes/${weeklyTitle}.md`);
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(existing);

        const file = await (
            plugin as unknown as { getOrCreateReusableQuickNote(): Promise<TFile> }
        ).getOrCreateReusableQuickNote();

        expect(plugin.app.vault.create).not.toHaveBeenCalled();
        expect(file).toBe(existing);
    });

    it("creates a new file using Daily Notes folder and format when runtime settings exist", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        const weeklyTitle = moment().format("GGGG-[W]ww");
        getInternalPlugins(plugin.app).getPluginById.mockReturnValue({
            enabled: true,
            instance: { options: { folder: "Weekly Notes", format: "GGGG-[W]ww" } },
        });

        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(null);
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(null);
        const newFile = mkTFile(`Weekly Notes/${weeklyTitle}.md`);
        (plugin.app.vault.create as jest.Mock).mockResolvedValueOnce(newFile);

        const file = await (
            plugin as unknown as { getOrCreateReusableQuickNote(): Promise<TFile> }
        ).getOrCreateReusableQuickNote();

        expect(plugin.app.vault.create).toHaveBeenCalledTimes(1);
        const createdPath: string = (plugin.app.vault.create as jest.Mock).mock.calls[0][0];
        expect(createdPath).toBe(`Weekly Notes/${weeklyTitle}.md`);
        expect(file).toBe(newFile);
    });

    it("creates at vault root when Daily Notes folder is empty", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        const weeklyTitle = moment().format("GGGG-[W]ww");
        getInternalPlugins(plugin.app).getPluginById.mockReturnValue({
            enabled: true,
            instance: { options: { folder: "", format: "GGGG-[W]ww" } },
        });

        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(null);
        const newFile = mkTFile(`${weeklyTitle}.md`);
        (plugin.app.vault.create as jest.Mock).mockResolvedValueOnce(newFile);

        await (
            plugin as unknown as { getOrCreateReusableQuickNote(): Promise<TFile> }
        ).getOrCreateReusableQuickNote();

        const createdPath: string = (plugin.app.vault.create as jest.Mock).mock.calls[0][0];
        expect(createdPath).not.toContain("/");
    });

    it("falls back to .obsidian/daily-notes.json when runtime Daily Notes settings are unavailable", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        const weeklyTitle = moment().format("GGGG-[W]ww");
        const today = moment().format("YYYY-MM-DD");

        (plugin.app.vault.adapter.read as jest.Mock).mockResolvedValueOnce(
            JSON.stringify({ folder: "Weekly Notes", format: "GGGG-[W]ww" })
        );
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(null);
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(null);
        (plugin.app.vault.create as jest.Mock).mockResolvedValueOnce(mkTFile(`Weekly Notes/${weeklyTitle}.md`));

        await (
            plugin as unknown as { getOrCreateReusableQuickNote(): Promise<TFile> }
        ).getOrCreateReusableQuickNote();

        expect(plugin.app.vault.adapter.read).toHaveBeenCalledWith(".obsidian/daily-notes.json");
        expect(plugin.app.vault.create).toHaveBeenCalledWith(
            `Weekly Notes/${weeklyTitle}.md`,
            expect.stringContaining(today)
        );
    });

    it("falls back to the legacy reusable-note path when Daily Notes settings cannot be resolved", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.noteFolder = "Quick Notes";
        const today = moment().format("YYYY-MM-DD");

        (plugin.app.vault.adapter.read as jest.Mock).mockRejectedValueOnce(new Error("missing"));
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(null);
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(null);
        (plugin.app.vault.create as jest.Mock).mockResolvedValueOnce(
            mkTFile(`Quick Notes/${today} Quick Notes.md`)
        );

        await (
            plugin as unknown as { getOrCreateReusableQuickNote(): Promise<TFile> }
        ).getOrCreateReusableQuickNote();

        expect(plugin.app.vault.create).toHaveBeenCalledWith(
            `Quick Notes/${today} Quick Notes.md`,
            expect.stringContaining(today)
        );
    });
});

// ── ensureFolderExists ────────────────────────────────────────────────────

describe("ensureFolderExists", () => {
    beforeEach(() => jest.clearAllMocks());

    it("does nothing when folder is an empty string", async () => {
        const plugin = makePlugin();
        await (plugin as unknown as { ensureFolderExists(f: string): Promise<void> }).ensureFolderExists("");
        expect(plugin.app.vault.createFolder).not.toHaveBeenCalled();
    });

    it("does NOT create folder when it already exists", async () => {
        const plugin = makePlugin();
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce({ path: "Notes" });
        await (plugin as unknown as { ensureFolderExists(f: string): Promise<void> }).ensureFolderExists("Notes");
        expect(plugin.app.vault.createFolder).not.toHaveBeenCalled();
    });

    it("creates folder when it is absent", async () => {
        const plugin = makePlugin();
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(null);
        await (plugin as unknown as { ensureFolderExists(f: string): Promise<void> }).ensureFolderExists("NewFolder");
        expect(plugin.app.vault.createFolder).toHaveBeenCalledWith("NewFolder");
    });
});

// ── openFloatingNote ──────────────────────────────────────────────────────

describe("openFloatingNote", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers(); // Prevent setTimeout from firing after test teardown
        globalShortcut.register.mockReturnValue(true);
        remote.BrowserWindow.getAllWindows.mockReturnValue([mockWin]);
    });
    afterEach(() => jest.useRealTimers());

    it("aborts early (no popout) when file creation returns null", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();

        // Both getAbstractFileByPath and vault.create return null → file is null
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);
        (plugin.app.vault.create as jest.Mock).mockResolvedValue(null);

        await plugin.openFloatingNote(true);

        // Without a file, the method should bail out before opening a popout
        expect(plugin.app.workspace.openPopoutLeaf).not.toHaveBeenCalled();
    });

    it("calls openPopoutLeaf with the configured dimensions", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.windowWidth = 600;
        plugin.settings.windowHeight = 700;
        plugin.settings.noteFolder = "";

        const mockFile = mkTFile("2026-02-24 Quick Notes.md", "done");
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(null);
        (plugin.app.vault.create as jest.Mock).mockResolvedValueOnce(mockFile);

        await plugin.openFloatingNote(false);

        expect(getWorkspace(plugin.app).openPopoutLeaf).toHaveBeenCalledWith({
            x: 1860,
            y: 97,
            size: { width: 600, height: 700 },
        });
        expect(screen.getDisplayMatching).toHaveBeenCalledWith(mockWin.getBounds());
        expect(getCreatedLeaf(plugin.app).view.editor?.getValue()).toBe("done\n");

        jest.runAllTimers();
        const createdLeaf = getCreatedLeaf(plugin.app) as unknown as {
            view: { containerEl: { ownerDocument: { defaultView: { moveTo: jest.Mock } } } };
        };
        expect(createdLeaf.view.containerEl.ownerDocument.defaultView.moveTo).toHaveBeenCalledWith(
            1860,
            97
        );
    });

    it("opens additional reusable notes as tabs in settings order and focuses the primary tab", async () => {
        const plugin = makePlugin();
        await plugin.onload();
        plugin.settings.extraReusableNotePaths = ["Ideas.md", "Scratchpad.md"];
        const today = moment().format("YYYY-MM-DD");
        const primaryPath = `Quick Notes/${today} Quick Notes.md`;

        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((path: string) => {
            if (path === primaryPath) {
                return mkTFile(primaryPath, "primary");
            }
            if (path === "Ideas.md") {
                return mkTFile("Ideas.md", "deck");
            }
            if (path === "Scratchpad.md") {
                return mkTFile("Scratchpad.md", "scratch");
            }
            return null;
        });

        await plugin.openFloatingNote(false);

        expect(getWorkspace(plugin.app).openPopoutLeaf).toHaveBeenCalledWith({
            x: 1920,
            y: 147,
            size: { width: 480, height: 600 },
        });
        expect(getWorkspace(plugin.app).openPopoutLeaf).toHaveBeenCalledTimes(1);
        expect(getWorkspace(plugin.app).getLeaf).toHaveBeenCalledTimes(2);
        expect(getWorkspace(plugin.app).getLeaf).toHaveBeenCalledWith("tab");
        expect(getCreatedLeaves(plugin.app)).toHaveLength(3);
        expect(getCreatedLeaf(plugin.app, 0).openFile).toHaveBeenCalledWith(
            expect.objectContaining({ path: primaryPath }),
            { active: false }
        );
        expect(getCreatedLeaf(plugin.app, 1).openFile).toHaveBeenCalledWith(
            expect.objectContaining({ path: "Scratchpad.md" }),
            { active: false }
        );
        expect(getCreatedLeaf(plugin.app, 2).openFile).toHaveBeenCalledWith(
            expect.objectContaining({ path: "Ideas.md" }),
            { active: false }
        );
        expect(getSessionLeaves(getCreatedLeaf(plugin.app, 0)).map(getOpenedPath)).toEqual([
            primaryPath,
            "Ideas.md",
            "Scratchpad.md",
        ]);
        expect(getWorkspace(plugin.app).setActiveLeaf).toHaveBeenLastCalledWith(
            getCreatedLeaf(plugin.app, 0),
            { focus: true }
        );
        expect(
            (getCreatedLeaf(plugin.app, 0) as LeafWithEditor & { popoutWindow: unknown }).popoutWindow
        ).toBe((getCreatedLeaf(plugin.app, 2) as LeafWithEditor & { popoutWindow: unknown }).popoutWindow);
        expect(getCreatedLeaf(plugin.app, 0).view.editor?.focused).toBe(true);
        expect(getCreatedLeaf(plugin.app, 1).view.editor?.focused).toBe(false);
        expect(getCreatedLeaf(plugin.app, 2).view.editor?.focused).toBe(false);

        await jest.runAllTimersAsync();
        expect(plugin.settings.lastFocusedReusableNotePath).toBe(primaryPath);
    });

    it("appends one trailing newline and places the cursor at EOF", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();

        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(
            mkTFile("Weekly Notes/test.md", "done")
        );

        await plugin.openFloatingNote(false);

        const editor = getCreatedLeaf(plugin.app).view.editor;
        expect(editor?.getValue()).toBe("done\n");
        expect(editor?.cursor).toEqual({ line: 1, ch: 0 });
        expect(editor?.scrollTarget).toEqual({
            from: { line: 1, ch: 0 },
            to: { line: 1, ch: 0 },
        });
        expect(editor?.focused).toBe(true);
    });

    it("does not append another trailing newline when one already exists", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.noteFolder = "";

        (plugin.app.vault.create as jest.Mock).mockResolvedValueOnce(mkTFile("Quick A.md", "done\n"));

        await plugin.openFloatingNote(true);

        const editor = getCreatedLeaf(plugin.app).view.editor;
        expect(editor?.getValue()).toBe("done\n");
        expect(editor?.cursor).toEqual({ line: 1, ch: 0 });
    });

    it("uses the cursor display for global reusable-note launches", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.windowWidth = 500;
        plugin.settings.windowHeight = 400;

        screen.getDisplayNearestPoint.mockReturnValueOnce({
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            workArea: { x: 0, y: 0, width: 1920, height: 1040 },
        });
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(
            mkTFile("Weekly Notes/test.md")
        );

        await plugin.openFloatingNote(false, "global");

        expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 2000, y: 400 });
        expect(getWorkspace(plugin.app).openPopoutLeaf).toHaveBeenCalledWith({
            x: 710,
            y: 320,
            size: { width: 500, height: 400 },
        });
        expect(getWorkspace(plugin.app).openPopoutLeaf).toHaveBeenCalledTimes(1);
    });

    it("does not reactivate Obsidian when the global shortcut is closing an existing reusable session", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();

        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(
            mkTFile("Weekly Notes/test.md")
        );

        await plugin.openFloatingNote(false);
        const floatingLeaf = getCreatedLeaf(plugin.app) as LeafWithEditor & {
            popoutBrowserWindow: typeof mockWin;
        };
        remote.BrowserWindow.getAllWindows.mockReturnValue([mockWin, floatingLeaf.popoutBrowserWindow]);

        await plugin.openFloatingNote(false, "global");

        expect(electronApp.dock.show).not.toHaveBeenCalled();
        expect(electronApp.show).not.toHaveBeenCalled();
        expect(electronApp.focus).not.toHaveBeenCalled();
    });

    it("closes the floating window through the workspace container", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();

        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(
            mkTFile("Weekly Notes/test.md")
        );

        await plugin.openFloatingNote(false);
        const floatingLeaf = getCreatedLeaf(plugin.app) as LeafWithEditor & {
            container: { close: jest.Mock };
            popoutBrowserWindow: typeof mockWin;
        };
        remote.BrowserWindow.getAllWindows.mockReturnValue([mockWin, floatingLeaf.popoutBrowserWindow]);

        const closePromise = plugin.openFloatingNote(false, "global");
        await closePromise;

        expect(floatingLeaf.container.close).toHaveBeenCalledTimes(1);
        expect(floatingLeaf.popoutBrowserWindow.close).not.toHaveBeenCalled();
        expect(floatingLeaf.detach).toHaveBeenCalledTimes(1);
        expect(mockWin.setFocusable).toHaveBeenCalledWith(false);
        expect(floatingLeaf.popoutBrowserWindow.setFocusable).not.toHaveBeenCalled();
        expect(electronApp.focus).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(750);

        expect(mockWin.setFocusable).toHaveBeenLastCalledWith(true);
    });

    it("guards focus when the native floating window close button is used", async () => {
        const plugin = makePlugin();
        await plugin.onload();
        plugin.settings.noteFolder = "";

        (plugin.app.vault.create as jest.Mock).mockResolvedValueOnce(mkTFile("Quick A.md"));

        await plugin.openFloatingNote(true);
        await jest.advanceTimersByTimeAsync(200);

        const floatingLeaf = getCreatedLeaf(plugin.app) as LeafWithEditor & {
            popoutBrowserWindow: typeof mockWin & {
                dispatchEventName(eventName: string): void;
            };
            popoutWindow: unknown;
        };
        remote.BrowserWindow.getAllWindows.mockReturnValue([mockWin, floatingLeaf.popoutBrowserWindow]);

        floatingLeaf.popoutBrowserWindow.close();

        expect(mockWin.setFocusable).toHaveBeenCalledWith(false);
        expect(floatingLeaf.popoutBrowserWindow.setFocusable).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(750);

        expect(mockWin.setFocusable).toHaveBeenLastCalledWith(true);
    });

    it.each(["shortcut", "close button"])(
        "preserves the main window's minimized state when closing with the %s",
        async (closeMethod) => {
            const plugin = makePlugin();
            await plugin.onload();
            (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(
                mkTFile("Weekly Notes/test.md")
            );

            await plugin.openFloatingNote(false, "global");
            await jest.advanceTimersByTimeAsync(200);
            const floatingLeaf = getCreatedLeaf(plugin.app) as LeafWithEditor & {
                popoutBrowserWindow: typeof mockWin;
            };
            const mainWindow = {
                ...mockWin,
                isMinimized: jest.fn().mockReturnValue(true),
                minimize: jest.fn(),
                on: jest.fn<void, [string, () => void]>(),
                off: jest.fn(),
            };
            remote.BrowserWindow.getAllWindows.mockReturnValue([
                mainWindow,
                mockWin,
                floatingLeaf.popoutBrowserWindow,
            ]);

            if (closeMethod === "shortcut") {
                await plugin.openFloatingNote(false, "global");
            } else {
                floatingLeaf.popoutBrowserWindow.close();
            }

            expect(mainWindow.on).toHaveBeenCalledTimes(1);
            expect(mainWindow.on).toHaveBeenCalledWith("restore", expect.any(Function));
            expect(mainWindow.minimize).not.toHaveBeenCalled();
            expect(mockWin.on).not.toHaveBeenCalled();
            const [, onRestore] = mainWindow.on.mock.calls[0];

            // A native restore can happen even after focus has been disabled.
            mainWindow.isMinimized.mockReturnValue(false);
            onRestore();
            await jest.advanceTimersByTimeAsync(1);
            expect(mainWindow.minimize).toHaveBeenCalledTimes(1);

            await jest.advanceTimersByTimeAsync(750);
            expect(mainWindow.off).toHaveBeenCalledWith("restore", onRestore);
            expect(mainWindow.minimize).toHaveBeenCalledTimes(1);
            expect(mockWin.minimize).not.toHaveBeenCalled();
        }
    );

    it("keeps the main window from taking focus while the workspace container closes", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        let mainWindowFocusable = true;

        mockWin.isFocusable.mockImplementation(() => mainWindowFocusable);
        mockWin.setFocusable.mockImplementation((focusable: boolean) => {
            mainWindowFocusable = focusable;
        });

        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(
            mkTFile("Weekly Notes/test.md")
        );

        await plugin.openFloatingNote(false);
        const floatingLeaf = getCreatedLeaf(plugin.app) as LeafWithEditor & {
            container: { close: jest.Mock };
            popoutBrowserWindow: typeof mockWin;
        };
        const originalClose = floatingLeaf.container.close.getMockImplementation();
        floatingLeaf.container.close.mockImplementationOnce(() => {
            if (mockWin.isFocusable()) {
                mockWin.focus();
            }
            return originalClose?.();
        });
        remote.BrowserWindow.getAllWindows.mockReturnValue([mockWin, floatingLeaf.popoutBrowserWindow]);

        await plugin.openFloatingNote(false, "global");

        expect(floatingLeaf.container.close).toHaveBeenCalledTimes(1);
        expect(mockWin.setFocusable).toHaveBeenCalledWith(false);
        expect(mockWin.focus).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(750);

        expect(mainWindowFocusable).toBe(true);
    });

    it("still closes through the workspace container when focusability APIs are missing", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        const mainWindowWithoutFocusability = {
            ...mockWin,
            isFocusable: undefined,
            setFocusable: undefined,
        };

        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(
            mkTFile("Weekly Notes/test.md")
        );

        await plugin.openFloatingNote(false);
        const floatingLeaf = getCreatedLeaf(plugin.app) as LeafWithEditor & {
            container: { close: jest.Mock };
            popoutBrowserWindow: typeof mockWin;
        };
        remote.BrowserWindow.getAllWindows.mockReturnValue([
            mainWindowWithoutFocusability,
            floatingLeaf.popoutBrowserWindow,
        ]);

        await plugin.openFloatingNote(false, "global");

        expect(floatingLeaf.container.close).toHaveBeenCalledTimes(1);
        expect(floatingLeaf.detach).toHaveBeenCalledTimes(1);
    });

    it("reactivates Obsidian before opening the reusable note when no windows exist", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();

        remote.BrowserWindow.getAllWindows
            .mockReturnValueOnce([])
            .mockReturnValueOnce([])
            .mockReturnValue([mockWin]);
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(
            mkTFile("Weekly Notes/test.md")
        );

        const openPromise = plugin.openFloatingNote(false, "global");
        await jest.runAllTimersAsync();
        await openPromise;

        expect(electronApp.dock.show).toHaveBeenCalled();
        expect(electronApp.show).toHaveBeenCalled();
        expect(electronApp.focus).toHaveBeenCalledWith({ steal: true });
        expect(mockWin.show).toHaveBeenCalled();
        expect(mockWin.focus).toHaveBeenCalled();
        expect(getWorkspace(plugin.app).openPopoutLeaf).toHaveBeenCalledTimes(1);
    });

    it("does not open a popout when no window can be restored for a global launch", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();

        remote.BrowserWindow.getAllWindows.mockReturnValue([]);
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(
            mkTFile("Weekly Notes/test.md")
        );

        const openPromise = plugin.openFloatingNote(false, "global");
        await jest.runAllTimersAsync();
        await openPromise;

        expect(electronApp.focus).toHaveBeenCalledWith({ steal: true });
        expect(getWorkspace(plugin.app).openPopoutLeaf).not.toHaveBeenCalled();
    });

    it("toggles the reusable floating note closed on the second invocation", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.extraReusableNotePaths = ["Ideas.md"];
        const today = moment().format("YYYY-MM-DD");
        const primaryPath = `Quick Notes/${today} Quick Notes.md`;

        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((path: string) => {
            if (path === primaryPath) {
                return mkTFile(primaryPath);
            }
            if (path === "Ideas.md") {
                return mkTFile("Ideas.md");
            }
            return null;
        });

        await plugin.openFloatingNote(false);
        const createdLeaves = getCreatedLeaves(plugin.app) as Array<LeafWithEditor & {
            container: { close: jest.Mock };
            popoutBrowserWindow: typeof mockWin;
        }>;

        await plugin.openFloatingNote(false);

        expect(getWorkspace(plugin.app).openPopoutLeaf).toHaveBeenCalledTimes(1);
        expect(getWorkspace(plugin.app).getLeaf).toHaveBeenCalledTimes(1);
        expect(createdLeaves[0].container.close).toHaveBeenCalledTimes(1);
        expect(createdLeaves[0].popoutBrowserWindow.close).not.toHaveBeenCalled();
        createdLeaves.forEach((leaf) => {
            expect((leaf.detach as jest.Mock)).toHaveBeenCalledTimes(1);
        });
    });

    it("creates missing additional reusable notes with a normalized markdown path", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.extraReusableNotePaths = ["Projects/Ideas"];
        const today = moment().format("YYYY-MM-DD");
        const primaryPath = `Quick Notes/${today} Quick Notes.md`;

        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((path: string) => {
            if (path === primaryPath) {
                return mkTFile(primaryPath, "primary");
            }
            if (path === "Projects/Ideas.md" || path === "Projects") {
                return null;
            }
            return null;
        });
        (plugin.app.vault.create as jest.Mock).mockResolvedValueOnce(
            mkTFile("Projects/Ideas.md", "created")
        );

        await plugin.openFloatingNote(false);

        expect(plugin.app.vault.createFolder).toHaveBeenCalledWith("Projects");
        expect(plugin.app.vault.create).toHaveBeenCalledWith(
            "Projects/Ideas.md",
            expect.stringContaining(today)
        );
        expect(getWorkspace(plugin.app).openPopoutLeaf).toHaveBeenCalledTimes(1);
        expect(getWorkspace(plugin.app).getLeaf).toHaveBeenCalledTimes(1);
    });

    it("remembers the last reusable note focus and restores it on the next open", async () => {
        const plugin = makePlugin();
        await plugin.onload();
        plugin.settings.extraReusableNotePaths = ["Ideas.md"];
        const today = moment().format("YYYY-MM-DD");
        const primaryPath = `Quick Notes/${today} Quick Notes.md`;

        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((path: string) => {
            if (path === primaryPath) {
                return mkTFile(primaryPath, "primary");
            }
            if (path === "Ideas.md") {
                return mkTFile("Ideas.md", "deck");
            }
            return null;
        });

        await plugin.openFloatingNote(false);
        getWorkspace(plugin.app).setActiveLeaf(getCreatedLeaf(plugin.app, 1), { focus: true });

        await plugin.openFloatingNote(false);
        await plugin.openFloatingNote(false);

        expect(plugin.settings.lastFocusedReusableNotePath).toBe("Ideas.md");
        expect(getWorkspace(plugin.app).openPopoutLeaf).toHaveBeenCalledTimes(2);
        expect(getWorkspace(plugin.app).getLeaf).toHaveBeenCalledTimes(2);
        expect(getCreatedLeaf(plugin.app, 2).openFile).toHaveBeenCalledWith(
            expect.objectContaining({ path: primaryPath }),
            { active: false }
        );
        expect(getCreatedLeaf(plugin.app, 3).openFile).toHaveBeenCalledWith(
            expect.objectContaining({ path: "Ideas.md" }),
            { active: false }
        );
        expect(getCreatedLeaf(plugin.app, 2).view.editor?.focused).toBe(false);
        expect(getCreatedLeaf(plugin.app, 3).view.editor?.focused).toBe(true);
        expect(getWorkspace(plugin.app).setActiveLeaf).toHaveBeenLastCalledWith(
            getCreatedLeaf(plugin.app, 3),
            { focus: true }
        );
    });

    it("falls back to the primary reusable note when the remembered note is no longer in the set", async () => {
        const plugin = makePlugin();
        await plugin.onload();
        const today = moment().format("YYYY-MM-DD");
        const primaryPath = `Quick Notes/${today} Quick Notes.md`;
        plugin.settings.lastFocusedReusableNotePath = "Ideas.md";

        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((path: string) => {
            if (path === primaryPath) {
                return mkTFile(primaryPath, "primary");
            }
            return null;
        });

        await plugin.openFloatingNote(false);
        await jest.runAllTimersAsync();

        expect(getWorkspace(plugin.app).openPopoutLeaf).toHaveBeenCalledTimes(1);
        expect(getCreatedLeaf(plugin.app).openFile).toHaveBeenCalledWith(
            expect.objectContaining({ path: primaryPath }),
            { active: false }
        );
        expect(plugin.settings.lastFocusedReusableNotePath).toBe(primaryPath);
        expect(getWorkspace(plugin.app).setActiveLeaf).toHaveBeenLastCalledWith(
            getCreatedLeaf(plugin.app),
            { focus: true }
        );
    });

    it("serializes overlapping reusable toggles and skips stale post-open window work", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();

        const workspace = getWorkspace(plugin.app);
        const originalOpenPopoutLeaf = workspace.openPopoutLeaf.getMockImplementation() as () => WorkspaceLeaf;
        let resolveFirstOpen!: () => void;
        const firstOpen = new Promise<void>((resolve) => {
            resolveFirstOpen = resolve;
        });

        workspace.openPopoutLeaf.mockImplementationOnce(() => {
            const leaf = originalOpenPopoutLeaf() as LeafWithEditor;
            leaf.openFile = jest.fn().mockReturnValue(firstOpen);
            return leaf;
        });

        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(
            mkTFile("Weekly Notes/test.md")
        );

        const firstToggle = plugin.openFloatingNote(false, "global");
        const secondToggle = plugin.openFloatingNote(false, "global");

        await Promise.resolve();
        await Promise.resolve();

        resolveFirstOpen();
        await Promise.all([firstToggle, secondToggle]);

        const firstLeaf = getCreatedLeaf(plugin.app, 0) as LeafWithEditor & {
            container: { close: jest.Mock };
            detached: boolean;
            detach: jest.Mock;
            popoutBrowserWindow: typeof mockWin;
            view: {
                containerEl: {
                    ownerDocument: {
                        defaultView: {
                            moveTo: jest.Mock;
                        };
                    };
                };
            };
        };

        expect(firstLeaf.container.close).toHaveBeenCalledTimes(1);
        expect(firstLeaf.popoutBrowserWindow.close).not.toHaveBeenCalled();
        expect(firstLeaf.detach).toHaveBeenCalledTimes(1);
        expect(firstLeaf.detached).toBe(true);

        jest.runAllTimers();

        expect(firstLeaf.view.containerEl.ownerDocument.defaultView.moveTo).not.toHaveBeenCalled();
        expect(workspace.openPopoutLeaf).toHaveBeenCalledTimes(1);
    });

    it("adds 'Open new note' as a new tab in the existing floating window", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.noteFolder = "";

        (plugin.app.vault.create as jest.Mock)
            .mockResolvedValueOnce(mkTFile("Quick A.md"))
            .mockResolvedValueOnce(mkTFile("Quick B.md"));

        await plugin.openFloatingNote(true);
        await plugin.openFloatingNote(true);

        expect(getWorkspace(plugin.app).openPopoutLeaf).toHaveBeenCalledTimes(1);
        expect(getWorkspace(plugin.app).getLeaf).toHaveBeenCalledTimes(1);
        expect(getCreatedLeaves(plugin.app)).toHaveLength(2);
        expect(getCreatedLeaf(plugin.app, 1).openFile).toHaveBeenCalledWith(
            expect.objectContaining({ path: "Quick B.md" }),
            { active: false }
        );
        expect(getWorkspace(plugin.app).setActiveLeaf).toHaveBeenLastCalledWith(
            getCreatedLeaf(plugin.app, 1),
            { focus: true }
        );
    });

    it("opens successfully when the popout view has no editor", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();

        getWorkspace(plugin.app).openPopoutLeaf.mockImplementationOnce(() => {
            const leaf = new WorkspaceLeaf() as LeafWithEditor;
            delete leaf.view.editor;
            return leaf;
        });
        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValueOnce(
            mkTFile("Weekly Notes/test.md", "done")
        );

        await expect(plugin.openFloatingNote(false)).resolves.toBeUndefined();
        expect(getWorkspace(plugin.app).openPopoutLeaf).toHaveBeenCalledTimes(1);
    });

    it("clears the floating session when the popout window closes", async () => {
        const plugin = makePlugin();
        await plugin.onload();
        plugin.settings.noteFolder = "";

        (plugin.app.vault.create as jest.Mock).mockResolvedValueOnce(mkTFile("Quick A.md"));
        (plugin.app.vault.create as jest.Mock).mockResolvedValueOnce(mkTFile("Quick B.md"));

        await plugin.openFloatingNote(true);

        const windowCloseHandler = getWorkspace(plugin.app).on.mock.calls.find(
            ([eventName]: [string]) => eventName === "window-close"
        )?.[1] as ((workspaceWindow: unknown, window: unknown) => void);
        windowCloseHandler(
            {},
            (getCreatedLeaf(plugin.app, 0) as LeafWithEditor & { popoutWindow: unknown }).popoutWindow
        );

        await plugin.openFloatingNote(true);

        expect(getWorkspace(plugin.app).openPopoutLeaf).toHaveBeenCalledTimes(2);
    });
});

// ── applyWindowSettings (popout-specific window) ──────────────────────────

describe("applyWindowSettings (popout-specific window)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        remote.BrowserWindow.getFocusedWindow.mockReturnValue(mockWin);
    });

    it("sets always-on-top and workspace visibility when alwaysOnTop=true", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.alwaysOnTop = true;
        plugin.settings.opacity = 100;
        const leaf = makePopoutLeaf(plugin);

        (plugin as unknown as { applyWindowSettings(leaf: unknown): boolean }).applyWindowSettings(leaf);

        expect(leaf.popoutBrowserWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, "floating");
        expect(leaf.popoutBrowserWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
            skipTransformProcessType: true,
        });
    });

    it("does NOT call setAlwaysOnTop when alwaysOnTop=false", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.alwaysOnTop = false;
        const leaf = makePopoutLeaf(plugin);

        (plugin as unknown as { applyWindowSettings(leaf: unknown): boolean }).applyWindowSettings(leaf);

        expect(leaf.popoutBrowserWindow.setAlwaysOnTop).not.toHaveBeenCalled();
    });

    it("calls setOpacity with normalised value when opacity < 100", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.opacity = 80;
        plugin.settings.alwaysOnTop = false;
        const leaf = makePopoutLeaf(plugin);

        (plugin as unknown as { applyWindowSettings(leaf: unknown): boolean }).applyWindowSettings(leaf);

        expect(leaf.popoutBrowserWindow.setOpacity).toHaveBeenCalledWith(0.8);
    });

    it("does NOT call setOpacity when opacity is 100", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.opacity = 100;
        plugin.settings.alwaysOnTop = false;
        const leaf = makePopoutLeaf(plugin);

        (plugin as unknown as { applyWindowSettings(leaf: unknown): boolean }).applyWindowSettings(leaf);

        expect(leaf.popoutBrowserWindow.setOpacity).not.toHaveBeenCalled();
    });

    it("sets the title to 'Quick notes'", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        const leaf = makePopoutLeaf(plugin);

        (plugin as unknown as { applyWindowSettings(leaf: unknown): boolean }).applyWindowSettings(leaf);

        expect(leaf.popoutBrowserWindow.setTitle).toHaveBeenCalledWith("Quick notes");
    });

    it("falls back to @electron/remote when the popout's electron module returns null", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.alwaysOnTop = true;
        plugin.settings.opacity = 70;
        const leaf = makePopoutLeaf(plugin);

        leaf.popoutElectronModule.remote.getCurrentWindow.mockReturnValueOnce(null);

        (plugin as unknown as { applyWindowSettings(leaf: unknown): boolean }).applyWindowSettings(leaf);

        expect(mockWin.setAlwaysOnTop).not.toHaveBeenCalled();
        expect(leaf.popoutRemoteModule.getCurrentWindow).toHaveBeenCalled();
        expect(leaf.popoutBrowserWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, "floating");
        expect(leaf.popoutBrowserWindow.setOpacity).toHaveBeenCalledWith(0.7);
    });

    it("does not fall back to the focused main window when the popout window cannot be resolved", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        const leaf = makePopoutLeaf(plugin);

        leaf.popoutElectronModule.remote.getCurrentWindow.mockReturnValueOnce(null);
        leaf.popoutRemoteModule.getCurrentWindow.mockReturnValueOnce(null);
        leaf.popoutRemoteModule.default.getCurrentWindow.mockReturnValueOnce(null);

        const applied = (
            plugin as unknown as { applyWindowSettings(leaf: unknown): boolean }
        ).applyWindowSettings(leaf);

        expect(applied).toBe(false);
        expect(mockWin.setAlwaysOnTop).not.toHaveBeenCalled();
        expect(mockWin.setOpacity).not.toHaveBeenCalled();
    });
});

// ── Edge cases ────────────────────────────────────────────────────────────

describe("Edge cases", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => jest.useRealTimers());

    it("opacity boundary: value of exactly 30 is applied (minimum slider value)", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.opacity = 30;
        plugin.settings.alwaysOnTop = false;
        const leaf = makePopoutLeaf(plugin);

        (plugin as unknown as { applyWindowSettings(leaf: unknown): boolean }).applyWindowSettings(leaf);
        expect(leaf.popoutBrowserWindow.setOpacity).toHaveBeenCalledWith(0.3);
    });

    it("window dimensions: min-width 300 and min-height 200 are accepted", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.windowWidth = 300;
        plugin.settings.windowHeight = 200;
        plugin.settings.noteFolder = "";

        (plugin.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);
        const f = mkTFile("note.md");
        (plugin.app.vault.create as jest.Mock).mockResolvedValue(f);

        await plugin.openFloatingNote(false);

        expect(getWorkspace(plugin.app).openPopoutLeaf).toHaveBeenCalledWith({
            x: 2010,
            y: 347,
            size: { width: 300, height: 200 },
        });
    });

    it("{{date}} placeholder in defaultNoteContent is replaced on note creation", async () => {
        const plugin = makePlugin();
        await plugin.loadSettings();
        plugin.settings.noteFolder = "";
        plugin.settings.defaultNoteContent = "Created: {{date}}";

        (plugin.app.vault.create as jest.Mock).mockResolvedValue(mkTFile("note.md"));

        await (plugin as unknown as { createNewQuickNote(): Promise<TFile> }).createNewQuickNote();

        const calledContent: string = (plugin.app.vault.create as jest.Mock).mock.calls[0][1];
        expect(calledContent).not.toContain("{{date}}");
        // Should contain a date-like string YYYY-MM-DD
        expect(calledContent).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
});
