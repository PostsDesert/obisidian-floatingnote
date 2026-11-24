import {
  App,
  moment,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  type Editor,
  type EditorPosition,
} from "obsidian";

// Extend the Obsidian App type to include popout window API
declare module "obsidian" {
  interface Workspace {
    openPopoutLeaf(options?: {
      x?: number;
      y?: number;
      size?: { width: number; height: number };
    }): WorkspaceLeaf;
  }
}

interface FloatingNoteSettings {
  noteFolder: string;
  noteTitleFormat: string;
  globalShortcut: string;
  windowWidth: number;
  windowHeight: number;
  defaultNoteContent: string;
  alwaysOnTop: boolean;
  opacity: number;
  extraReusableNotePaths: string[];
  lastFocusedReusableNotePath: string;
}

type FloatingWindowEvent = "close" | "restore";

interface FloatingWindowHandle {
  getBounds?(): RectangleLike;
  setBounds?(bounds: Partial<RectangleLike>, animate?: boolean): void;
  setAlwaysOnTop(flag: boolean, level?: string): void;
  setVisibleOnAllWorkspaces(flag: boolean, options?: { skipTransformProcessType: boolean }): void;
  setOpacity(opacity: number): void;
  setTitle?(title: string): void;
  close?(): void;
  show?(): void;
  focus?(): void;
  isFocusable?(): boolean;
  setFocusable?(focusable: boolean): void;
  isDestroyed?(): boolean;
  isMinimized?(): boolean;
  minimize?(): void;
  restore?(): void;
  on?(eventName: FloatingWindowEvent, listener: () => void): void;
  off?(eventName: FloatingWindowEvent, listener: () => void): void;
  removeListener?(eventName: FloatingWindowEvent, listener: () => void): void;
}

type FloatingDomWindow = Window & {
  close?: () => void;
  require?: NodeJS.Require;
};

type FloatingWorkspaceContainer = {
  win?: FloatingDomWindow | null;
  close?: () => void;
};

interface RectangleLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PointLike {
  x: number;
  y: number;
}

interface DisplayLike {
  bounds: RectangleLike;
  workArea: RectangleLike;
}

interface DailyNotesSettings {
  folder: string;
  format: string;
}

interface ElectronRemoteModule {
  BrowserWindow: {
    getFocusedWindow(): FloatingWindowHandle | null;
    getAllWindows?(): FloatingWindowHandle[];
  };
  getCurrentWindow?(): FloatingWindowHandle | null;
}

type ElectronModuleWithRemote = {
  remote?: ElectronRemoteModule;
  screen?: ElectronScreenModule;
  globalShortcut?: ElectronGlobalShortcutModule;
  app?: ElectronAppModule;
};

interface ElectronRemoteImport {
  BrowserWindow?: ElectronRemoteModule["BrowserWindow"];
  getCurrentWindow?(): FloatingWindowHandle | null;
  screen?: ElectronScreenModule;
  globalShortcut?: ElectronGlobalShortcutModule;
  app?: ElectronAppModule;
  default?: {
    BrowserWindow?: ElectronRemoteModule["BrowserWindow"];
    getCurrentWindow?(): FloatingWindowHandle | null;
    screen?: ElectronScreenModule;
    globalShortcut?: ElectronGlobalShortcutModule;
    app?: ElectronAppModule;
  };
}

interface ElectronGlobalShortcutModule {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  unregisterAll(): void;
}

interface ElectronScreenModule {
  getCursorScreenPoint(): PointLike;
  getDisplayMatching(rect: RectangleLike): DisplayLike;
  getDisplayNearestPoint(point: PointLike): DisplayLike;
  getPrimaryDisplay(): DisplayLike;
}

interface ElectronAppModule {
  focus(options?: { steal?: boolean }): void;
  show?(): void;
  dock?: {
    show?(): Promise<void> | void;
  };
}

type DailyNotesPluginInstance = {
  options?: {
    folder?: string;
    format?: string;
  };
};

type DailyNotesInternalPlugin = {
  enabled?: boolean;
  instance?: DailyNotesPluginInstance | null;
};

type AppWithInternalPlugins = App & {
  internalPlugins?: {
    getPluginById?(id: string): DailyNotesInternalPlugin | null;
    plugins?: Record<string, DailyNotesInternalPlugin | undefined>;
  };
};

type VaultWithConfig = App["vault"] & {
  configDir?: string;
  adapter?: {
    read(path: string): Promise<string>;
  };
};

type EditorCapableView = WorkspaceLeaf["view"] & {
  editor?: Editor;
};

interface TrackedFloatingTab {
  path: string;
  leaf: WorkspaceLeaf;
  reusable: boolean;
}

interface FloatingOpenEntry {
  path: string;
  file: TFile;
  reusable: boolean;
}

const runtimeRequire: NodeJS.Require | null =
  typeof require === "function" ? require : null;

const LEGACY_DEFAULT_SETTINGS = {
  noteFolder: "Call Notes",
  noteTitleFormat: "Call - YYYY-MM-DD HH[h]mm",
  defaultNoteContent: "# 📞 Call Notes\n\n**Date:** {{date}}\n\n---\n\n",
};

const DEFAULT_SETTINGS: FloatingNoteSettings = {
  noteFolder: "Quick Notes",
  noteTitleFormat: "[Quick] - YYYY-MM-DD HH[h]mm",
  globalShortcut: "Ctrl+`",
  windowWidth: 480,
  windowHeight: 600,
  defaultNoteContent: "# Quick Notes\n\n**Date:** {{date}}\n\n---\n\n",
  alwaysOnTop: true,
  opacity: 100,
  extraReusableNotePaths: [],
  lastFocusedReusableNotePath: "",
};

const BUILD_ID = "2026-04-24T00:20Z-single-floating-tabs";
const FOCUSABILITY_RESTORE_DELAY_MS = 750;

export default class FloatingNotePlugin extends Plugin {
  settings: FloatingNoteSettings;
  private floatingAnchorLeaf: WorkspaceLeaf | null = null;
  private floatingWindow: FloatingDomWindow | null = null;
  private floatingTabs = new Map<string, TrackedFloatingTab>();
  private registeredGlobalShortcut: string | null = null;
  private reusableToggleQueue: Promise<void> = Promise.resolve();
  private floatingCloseGuardWindow: FloatingWindowHandle | null = null;
  private floatingCloseGuardHandler: (() => void) | null = null;
  private windowsGuardedDuringClose = new Set<FloatingWindowHandle>();

  async onload() {
    this.debugLog("plugin:onload", { buildId: BUILD_ID });
    await this.loadSettings();

    // Command: Open a fresh floating quick note (new file each time)
    this.addCommand({
      id: "open-new-note",
      name: "Open new note",
      callback: () => void this.openFloatingNote(true),
    });

    // Command: Toggle the reusable quick note in a floating window
    this.addCommand({
      id: "open-todays-note",
      name: "Toggle reusable quick note (floating)",
      callback: () => void this.openFloatingNote(false),
    });

    // Ribbon icon for quick access
    this.addRibbonIcon("pin", "Open new floating quick note", () => {
      void this.openFloatingNote(true);
    });

    this.registerEvent(
      this.app.workspace.on("window-close", (_workspaceWindow, window) => {
        if (this.floatingWindow === window) {
          this.clearFloatingSession();
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        void this.handleActiveLeafChange(leaf);
      })
    );
    this.register(() => {
      this.unregisterGlobalShortcut();
      this.unregisterFloatingWindowCloseGuard();
      this.clearFloatingSession();
    });
    this.registerGlobalShortcut();

    // Settings tab
    this.addSettingTab(new FloatingNoteSettingTab(this.app, this));
  }

  async openFloatingNote(
    createNew: boolean,
    source: "command" | "global" = "command"
  ) {
    this.debugLog("openFloatingNote:start", { createNew, source });

    if (!createNew && source === "global" && this.hasReusableFloatingSession()) {
      await this.toggleReusableFloatingNote(source);
      return;
    }

    if (source === "global") {
      const workspaceReady = await this.ensureWorkspaceWindowForGlobalLaunch();
      if (!workspaceReady) {
        return;
      }
    }

    if (!createNew) {
      await this.toggleReusableFloatingNote(source);
      return;
    }

    const file = await this.createNewQuickNote();

    if (!file) {
      new Notice("Failed to create or find a quick note.");
      return;
    }

    await this.openNewFloatingNote(file, source);
  }

  private lightenPopoutHeaderBar(leaf: WorkspaceLeaf) {
    const popoutDoc = leaf.view?.containerEl?.ownerDocument;
    if (!popoutDoc) return;

    const root = popoutDoc.documentElement;
    root.setCssProps({
      "--titlebar-background": "var(--background-secondary-alt)",
      "--titlebar-background-focused": "var(--background-secondary-alt)",
    });
  }

  private applyWindowSettings(leaf: WorkspaceLeaf): boolean {
    const win = this.getLeafElectronWindow(leaf);
    if (!win) {
      this.debugLog("applyWindowSettings:missing-window", {
        leafId: this.getLeafId(leaf),
      });
      return false;
    }

    this.debugLog("applyWindowSettings:resolved-window", {
      leafId: this.getLeafId(leaf),
      alwaysOnTop: this.settings.alwaysOnTop,
      opacity: this.settings.opacity,
      bounds: win.getBounds?.(),
    });
    this.registerFloatingWindowCloseGuard(win);

    if (this.settings.alwaysOnTop) {
      // 'floating' level keeps it above most windows but below system UI
      win.setAlwaysOnTop(true, "floating");
      // Join all Spaces without cycling Obsidian's Dock activation state.
      win.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true });
    }

    if (this.settings.opacity < 100) {
      win.setOpacity(this.settings.opacity / 100);
    }

    win.setTitle?.("Quick notes");
    return true;
  }

  private async toggleReusableFloatingNote(source: "command" | "global") {
    const toggleOperation = this.reusableToggleQueue.then(() =>
      this.runReusableToggle(source)
    );
    this.reusableToggleQueue = toggleOperation.catch(() => undefined);
    await toggleOperation;
  }

  private async runReusableToggle(source: "command" | "global") {
    const existingTabs = this.getTrackedFloatingTabs();
    if (existingTabs.some((tab) => tab.reusable)) {
      this.debugLog("toggleReusableFloatingNote:close-existing", {
        source,
        paths: existingTabs.map((tab) => ({
          path: tab.path,
          reusable: tab.reusable,
        })),
      });
      await this.closeFloatingSession();
      return;
    }

    const reusableFiles = await this.getOrCreateReusableNoteSet();
    if (!reusableFiles) {
      new Notice("Failed to create or find a quick note.");
      return;
    }

    const reusablePaths = Array.from(reusableFiles.keys());
    const primaryPath = reusablePaths[0];
    if (!primaryPath) {
      new Notice("Failed to create or find a quick note.");
      return;
    }
    const focusedPath = this.getReusableFocusTargetPath(reusablePaths, primaryPath);
    const reusableEntries = reusablePaths
      .map((path) => {
        const file = reusableFiles.get(path);
        return file ? { path, file, reusable: true } : null;
      })
      .filter((entry): entry is FloatingOpenEntry => entry !== null);

    this.debugLog("toggleReusableFloatingNote:open-new", {
      source,
      paths: reusablePaths,
      focusedPath,
    });
    await this.openFloatingTabs(reusableEntries, focusedPath, source);
  }

  private async openNewFloatingNote(
    file: TFile,
    source: "command" | "global"
  ) {
    await this.openFloatingTabs(
      [{ path: file.path, file, reusable: false }],
      file.path,
      source
    );
  }

  private async openFloatingTabs(
    entries: FloatingOpenEntry[],
    focusedPath: string,
    source: "command" | "global"
  ) {
    const existingTabs = this.getTrackedFloatingTabs();
    let anchorLeaf = this.getFloatingAnchorLeaf();
    const placement = anchorLeaf ? null : this.getPopoutPlacement(source);
    const createdSession = !anchorLeaf;

    this.debugLog("openFloatingTabs:start", {
      source,
      focusedPath,
      createdSession,
      entries: entries.map((entry) => ({
        path: entry.path,
        reusable: entry.reusable,
      })),
    });

    const creationEntries = this.getFloatingTabCreationOrder(entries, createdSession);

    for (const entry of creationEntries) {
      const existingTab = this.floatingTabs.get(entry.path);
      if (existingTab) {
        existingTab.reusable = existingTab.reusable || entry.reusable;
        continue;
      }

      const leaf = anchorLeaf
        ? this.createTabInFloatingWindow(anchorLeaf)
        : this.createFloatingAnchorLeaf(placement);
      if (!leaf) {
        return;
      }

      await leaf.openFile(entry.file, { active: false });
      this.trackFloatingTab(entry.path, leaf, entry.reusable);

      if (!anchorLeaf) {
        anchorLeaf = leaf;
      }
    }

    const focusedTab = this.floatingTabs.get(focusedPath);
    if (focusedTab) {
      this.activateFloatingTab(focusedTab.leaf, true);
    }

    if (createdSession && anchorLeaf) {
      this.scheduleFloatingWindowSetup(anchorLeaf, placement);
    } else if (focusedTab) {
      this.focusFloatingLeaf(focusedTab.leaf);
    }

    this.debugLog("openFloatingTabs:done", {
      source,
      openTabs: this.getTrackedFloatingTabs().map((tab) => ({
        path: tab.path,
        reusable: tab.reusable,
      })),
      existingTabsBefore: existingTabs.map((tab) => tab.path),
    });
  }

  private getFloatingTabCreationOrder(
    entries: FloatingOpenEntry[],
    createdSession: boolean
  ) {
    if (createdSession) {
      const [anchorEntry, ...tabEntries] = entries;
      return anchorEntry ? [anchorEntry, ...tabEntries.reverse()] : [];
    }

    return [...entries].reverse();
  }

  private prepareEditorForBottomEntry(leaf: WorkspaceLeaf) {
    const editor = (leaf.view as EditorCapableView | null | undefined)?.editor;
    if (!editor) {
      return;
    }

    const content = editor.getValue();
    if (content.length > 0 && !content.endsWith("\n")) {
      editor.replaceRange("\n", this.getEditorEndPosition(editor));
    }

    const endOfDocument = this.getEditorEndPosition(editor);
    editor.setCursor(endOfDocument);
    editor.scrollIntoView({ from: endOfDocument, to: endOfDocument }, true);
    editor.focus();
  }

  private getEditorEndPosition(editor: Editor): EditorPosition {
    const lastLine = editor.lastLine();
    return {
      line: lastLine,
      ch: editor.getLine(lastLine).length,
    };
  }

  private getPopoutWindowData(placement: PointLike | null): {
    x?: number;
    y?: number;
    size: { width: number; height: number };
  } {
    const size = {
      width: this.settings.windowWidth,
      height: this.settings.windowHeight,
    };

    if (!placement) {
      return { size };
    }

    return {
      x: placement.x,
      y: placement.y,
      size,
    };
  }

  private positionPopoutWindow(
    popoutWindow: FloatingDomWindow | null,
    placement: PointLike
  ) {
    this.debugLog("positionPopoutWindow", {
      placement,
      domWindow: this.describeDomWindow(popoutWindow),
    });
    popoutWindow?.moveTo?.(placement.x, placement.y);
  }

  private getPopoutPlacement(source: "command" | "global"): PointLike | null {
    return this.getPopoutPlacementForDisplay(this.getTargetDisplay(source));
  }

  private getPopoutPlacementForDisplay(display: DisplayLike | null): PointLike | null {
    if (!display) {
      return null;
    }

    const workArea = display.workArea ?? display.bounds;
    const width = this.settings.windowWidth;
    const height = this.settings.windowHeight;
    const centeredX = Math.round(workArea.x + (workArea.width - width) / 2);
    const centeredY = Math.round(workArea.y + (workArea.height - height) / 2);
    const maxX = workArea.x + Math.max(workArea.width - width, 0);
    const maxY = workArea.y + Math.max(workArea.height - height, 0);

    return {
      x: Math.min(Math.max(centeredX, workArea.x), maxX),
      y: Math.min(Math.max(centeredY, workArea.y), maxY),
    };
  }

  private getTargetDisplay(source: "command" | "global"): DisplayLike | null {
    const screen = this.getElectronScreen();
    if (!screen) {
      this.debugLog("getTargetDisplay:no-screen", { source });
      return null;
    }

    if (source === "command") {
      const focusedWindow = this.getFocusedElectronWindow();
      const bounds = focusedWindow?.getBounds?.();
      if (bounds) {
        const display = screen.getDisplayMatching(bounds);
        this.debugLog("getTargetDisplay:focused-window", {
          source,
          bounds,
          displayBounds: display.bounds,
          displayWorkArea: display.workArea,
        });
        return display;
      }
    }

    const cursorPosition = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPosition) ?? screen.getPrimaryDisplay();
    this.debugLog("getTargetDisplay:cursor", {
      source,
      cursorPosition,
      displayBounds: display.bounds,
      displayWorkArea: display.workArea,
    });
    return display;
  }

  private getTrackedFloatingTabs(): TrackedFloatingTab[] {
    if (this.floatingWindow?.closed) {
      this.clearFloatingSession();
      return [];
    }

    for (const [path, entry] of this.floatingTabs.entries()) {
      if (this.isLeafClosed(entry.leaf)) {
        this.floatingTabs.delete(path);
      }
    }

    if (this.floatingTabs.size === 0) {
      this.floatingAnchorLeaf = null;
      this.floatingWindow = null;
      return [];
    }

    if (!this.floatingAnchorLeaf || this.isLeafClosed(this.floatingAnchorLeaf)) {
      this.floatingAnchorLeaf = this.floatingTabs.values().next().value?.leaf ?? null;
    }
    if (!this.floatingWindow && this.floatingAnchorLeaf) {
      this.floatingWindow = this.getLeafWindow(this.floatingAnchorLeaf);
    }

    return Array.from(this.floatingTabs.values());
  }

  private getFloatingAnchorLeaf() {
    this.getTrackedFloatingTabs();
    return this.floatingAnchorLeaf;
  }

  private trackFloatingTab(path: string, leaf: WorkspaceLeaf, reusable: boolean) {
    this.floatingTabs.set(path, { path, leaf, reusable });
    if (!this.floatingAnchorLeaf) {
      this.floatingAnchorLeaf = leaf;
    }
    if (!this.floatingWindow) {
      this.floatingWindow = this.getLeafWindow(leaf);
    }
    this.debugLog("trackFloatingTab", {
      path,
      reusable,
      leafId: this.getLeafId(leaf),
      anchorLeafId: this.getLeafId(this.floatingAnchorLeaf),
      domWindow: this.describeDomWindow(this.floatingWindow),
    });
  }

  private clearFloatingSession() {
    this.debugLog("clearFloatingSession", {
      anchorLeafId: this.getLeafId(this.floatingAnchorLeaf),
      tabPaths: Array.from(this.floatingTabs.keys()),
      domWindow: this.describeDomWindow(this.floatingWindow),
    });
    this.unregisterFloatingWindowCloseGuard();
    this.floatingTabs.clear();
    this.floatingAnchorLeaf = null;
    this.floatingWindow = null;
  }

  private async closeFloatingSession() {
    const anchorLeaf = this.getFloatingAnchorLeaf();
    if (!anchorLeaf) {
      this.clearFloatingSession();
      return;
    }

    const electronWindow = this.getLeafElectronWindow(anchorLeaf);
    this.guardOtherWindowsDuringClose(electronWindow);

    const workspaceContainer = this.getLeafWorkspaceContainer(anchorLeaf);
    if (workspaceContainer?.close && workspaceContainer.win) {
      this.debugLog("closeFloatingSession:close-window", {
        strategy: "workspace-container",
        anchorLeafId: this.getLeafId(anchorLeaf),
        domWindow: this.describeDomWindow(workspaceContainer.win),
      });
      workspaceContainer.close();
      return;
    }

    if (electronWindow?.close) {
      this.debugLog("closeFloatingSession:close-window", {
        strategy: "electron",
        anchorLeafId: this.getLeafId(anchorLeaf),
        bounds: electronWindow.getBounds?.(),
      });
      electronWindow.close();
      return;
    }

    const domWindow = this.getLeafWindow(anchorLeaf);
    if (domWindow?.close) {
      this.debugLog("closeFloatingSession:close-window", {
        strategy: "dom",
        anchorLeafId: this.getLeafId(anchorLeaf),
        domWindow: this.describeDomWindow(domWindow),
      });
      domWindow.close();
      return;
    }

    this.debugLog("closeFloatingSession:close-window", {
      strategy: "detach-fallback",
      anchorLeafId: this.getLeafId(anchorLeaf),
    });
    for (const tab of this.getTrackedFloatingTabs()) {
      tab.leaf.detach();
    }
    this.clearFloatingSession();
  }

  private guardOtherWindowsDuringClose(floatingWindow: FloatingWindowHandle | null) {
    for (const window of this.getAllElectronWindows()) {
      if (
        window === floatingWindow ||
        this.windowsGuardedDuringClose.has(window) ||
        window.isDestroyed?.()
      ) {
        continue;
      }

      let restoreFocusability = false;
      let wasMinimized = false;
      let watchingRestore = false;
      const keepMinimized = () => {
        if (wasMinimized && !window.isDestroyed?.() && window.isMinimized?.() === false) {
          // AppKit can restore a minimized window even when it cannot take focus.
          wasMinimized = false;
          window.minimize?.();
        }
      };
      const onRestore = () => setTimeout(keepMinimized, 0);

      this.windowsGuardedDuringClose.add(window);
      try {
        wasMinimized = window.isMinimized?.() === true;
        if (window.setFocusable && window.isFocusable?.() !== false) {
          window.setFocusable(false);
          restoreFocusability = true;
        }
        if (wasMinimized && window.on) {
          window.on("restore", onRestore);
          watchingRestore = true;
        }
      } catch (err) {
        this.debugLog("guardOtherWindowsDuringClose:failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      setTimeout(() => {
        this.windowsGuardedDuringClose.delete(window);
        if (window.isDestroyed?.()) {
          return;
        }

        try {
          if (watchingRestore) {
            const removeListener = window.off ?? window.removeListener;
            removeListener?.call(window, "restore", onRestore);
          }
          keepMinimized();
          if (restoreFocusability) {
            window.setFocusable?.(true);
          }
        } catch (err) {
          this.debugLog("guardOtherWindowsDuringClose:cleanup-failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          wasMinimized = false;
        }
      }, FOCUSABILITY_RESTORE_DELAY_MS);
    }
  }

  private registerFloatingWindowCloseGuard(window: FloatingWindowHandle) {
    if (this.floatingCloseGuardWindow === window) {
      return;
    }

    this.unregisterFloatingWindowCloseGuard();

    if (!window.on) {
      this.debugLog("registerFloatingWindowCloseGuard:missing-on");
      return;
    }

    const closeGuard = () => {
      this.debugLog("floatingWindow:close-guard");
      this.guardOtherWindowsDuringClose(window);
    };

    try {
      window.on("close", closeGuard);
      this.floatingCloseGuardWindow = window;
      this.floatingCloseGuardHandler = closeGuard;
    } catch (err) {
      this.debugLog("registerFloatingWindowCloseGuard:failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private unregisterFloatingWindowCloseGuard() {
    const window = this.floatingCloseGuardWindow;
    const closeGuard = this.floatingCloseGuardHandler;

    this.floatingCloseGuardWindow = null;
    this.floatingCloseGuardHandler = null;

    if (!window || !closeGuard) {
      return;
    }

    try {
      if (window.off) {
        window.off("close", closeGuard);
      } else {
        window.removeListener?.("close", closeGuard);
      }
    } catch (err) {
      this.debugLog("unregisterFloatingWindowCloseGuard:failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private createFloatingAnchorLeaf(placement: PointLike | null) {
    const leaf = this.app.workspace.openPopoutLeaf(this.getPopoutWindowData(placement));
    this.floatingAnchorLeaf = leaf;
    this.floatingWindow = this.getLeafWindow(leaf);
    this.debugLog("createFloatingAnchorLeaf", {
      leafId: this.getLeafId(leaf),
      placement,
      domWindow: this.describeDomWindow(this.floatingWindow),
    });
    return leaf;
  }

  private createTabInFloatingWindow(anchorLeaf: WorkspaceLeaf) {
    this.app.workspace.setActiveLeaf(anchorLeaf, { focus: false });
    const leaf = this.app.workspace.getLeaf("tab");
    if (!this.isLeafInFloatingWindow(leaf, anchorLeaf)) {
      this.debugLog("createTabInFloatingWindow:wrong-window", {
        anchorLeafId: this.getLeafId(anchorLeaf),
        leafId: this.getLeafId(leaf),
        anchorWindow: this.describeDomWindow(this.getLeafWindow(anchorLeaf)),
        leafWindow: this.describeDomWindow(this.getLeafWindow(leaf)),
      });
      leaf.detach();
      new Notice("Could not open a tab in the floating window.", 5000);
      return null;
    }

    return leaf;
  }

  private isLeafInFloatingWindow(leaf: WorkspaceLeaf, anchorLeaf: WorkspaceLeaf) {
    return this.getLeafWindow(leaf) === this.getLeafWindow(anchorLeaf);
  }

  private activateFloatingTab(leaf: WorkspaceLeaf, focus = true) {
    this.app.workspace.setActiveLeaf(leaf, { focus });
    if (focus) {
      this.prepareEditorForBottomEntry(leaf);
    }
  }

  private focusFloatingLeaf(leaf: WorkspaceLeaf) {
    this.activateFloatingTab(leaf, true);
    this.getLeafElectronWindow(leaf)?.focus?.();
  }

  private scheduleFloatingWindowSetup(
    leaf: WorkspaceLeaf,
    placement: PointLike | null
  ) {
    setTimeout(() => {
      if (!this.shouldRunPostOpenWindowWork(leaf)) {
        this.debugLog("scheduleFloatingWindowSetup:skip", {
          leafId: this.getLeafId(leaf),
        });
        return;
      }

      const popoutWindow = this.getLeafWindow(leaf);
      this.debugLog("scheduleFloatingWindowSetup:run", {
        leafId: this.getLeafId(leaf),
        placement,
        domWindow: this.describeDomWindow(popoutWindow),
      });
      if (placement) {
        this.positionPopoutWindow(popoutWindow, placement);
      }
      this.lightenPopoutHeaderBar(leaf);
      this.applyWindowSettingsWithRetry(leaf);
      const activeLeaf = this.app.workspace.activeLeaf;
      if (activeLeaf && this.floatingTabsHasLeaf(activeLeaf)) {
        this.focusFloatingLeaf(activeLeaf);
      }
    }, 200);
  }

  private shouldRunPostOpenWindowWork(leaf: WorkspaceLeaf) {
    return !this.isLeafClosed(leaf) && this.floatingTabsHasLeaf(leaf);
  }

  private floatingTabsHasLeaf(leaf: WorkspaceLeaf) {
    return this.getTrackedFloatingTabs().some((entry) => entry.leaf === leaf);
  }

  private isLeafClosed(leaf: WorkspaceLeaf) {
    return (leaf as WorkspaceLeaf & { detached?: boolean }).detached === true;
  }

  private hasReusableFloatingSession() {
    return this.getTrackedFloatingTabs().some((entry) => entry.reusable);
  }

  private async handleActiveLeafChange(leaf: WorkspaceLeaf | null) {
    if (!leaf) {
      return;
    }

    const activeTab = this.getTrackedFloatingTabs().find((entry) => entry.leaf === leaf);
    if (!activeTab?.reusable) {
      return;
    }

    await this.rememberLastFocusedReusableNote(activeTab.path);
  }

  private getElectronModule(): ElectronModuleWithRemote | null {
    return (runtimeRequire?.("electron") as ElectronModuleWithRemote | undefined) ?? null;
  }

  private getLeafWorkspaceContainer(leaf: WorkspaceLeaf): FloatingWorkspaceContainer | null {
    return (
      (
        leaf as WorkspaceLeaf & {
          getContainer?: () => FloatingWorkspaceContainer | null;
        }
      ).getContainer?.() ?? null
    );
  }

  private getLeafWindow(leaf: WorkspaceLeaf): FloatingDomWindow | null {
    const containerWindow = this.getLeafWorkspaceContainer(leaf)?.win ?? null;

    if (containerWindow) {
      this.debugLog("getLeafWindow:container", {
        leafId: this.getLeafId(leaf),
        domWindow: this.describeDomWindow(containerWindow),
      });
      return containerWindow;
    }

    const documentWindow =
      (leaf.view?.containerEl?.ownerDocument?.defaultView as FloatingDomWindow | null | undefined) ??
      null;
    this.debugLog("getLeafWindow:document", {
      leafId: this.getLeafId(leaf),
      domWindow: this.describeDomWindow(documentWindow),
    });
    return documentWindow;
  }

  private getLeafElectronWindow(leaf: WorkspaceLeaf): FloatingWindowHandle | null {
    const popoutWindow = this.getLeafWindow(leaf);
    if (!popoutWindow) {
      this.debugLog("getLeafElectronWindow:no-dom-window", {
        leafId: this.getLeafId(leaf),
      });
      return null;
    }

    const popoutRequire = popoutWindow.require ?? runtimeRequire;
    if (!popoutRequire) {
      return null;
    }

    try {
      const electronModule = popoutRequire("electron") as ElectronModuleWithRemote | undefined;
      const currentWindow = electronModule?.remote?.getCurrentWindow?.() ?? null;
      if (currentWindow) {
        this.debugLog("getLeafElectronWindow:electron", {
          leafId: this.getLeafId(leaf),
          bounds: currentWindow.getBounds?.(),
        });
        return currentWindow;
      }
      this.debugLog("getLeafElectronWindow:electron-null", {
        leafId: this.getLeafId(leaf),
      });
    } catch {
      this.debugLog("getLeafElectronWindow:electron-error", {
        leafId: this.getLeafId(leaf),
      });
      // Try @electron/remote next.
    }

    try {
      const electronRemote = popoutRequire("@electron/remote") as ElectronRemoteImport;
      const currentWindow =
        electronRemote.getCurrentWindow?.() ?? electronRemote.default?.getCurrentWindow?.() ?? null;
      this.debugLog("getLeafElectronWindow:remote", {
        leafId: this.getLeafId(leaf),
        resolved: Boolean(currentWindow),
        bounds: currentWindow?.getBounds?.(),
      });
      return currentWindow;
    } catch {
      this.debugLog("getLeafElectronWindow:remote-error", {
        leafId: this.getLeafId(leaf),
      });
      return null;
    }
  }

  private applyWindowSettingsWithRetry(leaf: WorkspaceLeaf, retriesRemaining = 10) {
    if (this.applyWindowSettings(leaf)) {
      this.debugLog("applyWindowSettingsWithRetry:applied", {
        leafId: this.getLeafId(leaf),
        retriesRemaining,
      });
      return;
    }

    const popoutWindow = this.getLeafWindow(leaf);
    if (!popoutWindow || popoutWindow.closed || retriesRemaining <= 1) {
      this.debugLog("applyWindowSettingsWithRetry:stop", {
        leafId: this.getLeafId(leaf),
        retriesRemaining,
        domWindow: this.describeDomWindow(popoutWindow),
      });
      return;
    }

    this.debugLog("applyWindowSettingsWithRetry:retry", {
      leafId: this.getLeafId(leaf),
      retriesRemaining,
    });
    setTimeout(() => this.applyWindowSettingsWithRetry(leaf, retriesRemaining - 1), 50);
  }

  private getRemoteElectronModule(): ElectronRemoteImport | null {
    try {
      if (!runtimeRequire) {
        return null;
      }

      return runtimeRequire("@electron/remote") as ElectronRemoteImport;
    } catch {
      return null;
    }
  }

  private getElectronScreen(): ElectronScreenModule | null {
    const electronModule = this.getElectronModule();
    if (electronModule?.screen) {
      return electronModule.screen;
    }

    const remoteModule = this.getRemoteElectronModule();
    return remoteModule?.screen ?? remoteModule?.default?.screen ?? null;
  }

  private getGlobalShortcutModule(): ElectronGlobalShortcutModule | null {
    const electronModule = this.getElectronModule();
    if (electronModule?.globalShortcut) {
      return electronModule.globalShortcut;
    }

    const remoteModule = this.getRemoteElectronModule();
    return remoteModule?.globalShortcut ?? remoteModule?.default?.globalShortcut ?? null;
  }

  private getElectronAppModule(): ElectronAppModule | null {
    const electronModule = this.getElectronModule();
    if (electronModule?.app) {
      return electronModule.app;
    }

    const remoteModule = this.getRemoteElectronModule();
    return remoteModule?.app ?? remoteModule?.default?.app ?? null;
  }

  private getBrowserWindowModule() {
    const electronModule = this.getElectronModule();
    const browserWindow = electronModule?.remote?.BrowserWindow;
    if (browserWindow) {
      return browserWindow;
    }

    const remoteModule = this.getRemoteElectronModule();
    return remoteModule?.BrowserWindow ?? remoteModule?.default?.BrowserWindow ?? null;
  }

  private getAllElectronWindows(): FloatingWindowHandle[] {
    return this.getBrowserWindowModule()?.getAllWindows?.() ?? [];
  }

  private getFocusedElectronWindow(): FloatingWindowHandle | null {
    try {
      return this.getBrowserWindowModule()?.getFocusedWindow() ?? null;
    } catch {
      return this.getFocusedElectronWindowFromRemoteFallback();
    }
  }

  private getFocusedElectronWindowFromRemoteFallback(): FloatingWindowHandle | null {
    const electronRemote = this.getRemoteElectronModule();
    const browserWindow =
      electronRemote?.BrowserWindow ?? electronRemote?.default?.BrowserWindow ?? null;
    return browserWindow?.getFocusedWindow() ?? null;
  }

  private async ensureWorkspaceWindowForGlobalLaunch() {
    const existingWindows = this.getAllElectronWindows();
    if (existingWindows.length > 0) {
      return true;
    }

    this.debugLog("ensureWorkspaceWindowForGlobalLaunch:no-windows");
    const electronApp = this.getElectronAppModule();
    if (!electronApp) {
      new Notice("Could not reactivate Obsidian with no windows open.", 5000);
      return false;
    }

    try {
      await electronApp.dock?.show?.();
    } catch {
      this.debugLog("ensureWorkspaceWindowForGlobalLaunch:dock-show-failed");
    }

    try {
      electronApp.show?.();
      electronApp.focus({ steal: true });
    } catch {
      this.debugLog("ensureWorkspaceWindowForGlobalLaunch:app-focus-failed");
    }

    const restoredWindow = await this.waitForElectronWindow();
    if (!restoredWindow) {
      new Notice("Could not reopen an Obsidian window for the quick note shortcut.", 5000);
      return false;
    }

    restoredWindow.show?.();
    restoredWindow.focus?.();
    await this.sleep(150);
    this.debugLog("ensureWorkspaceWindowForGlobalLaunch:restored-window", {
      bounds: restoredWindow.getBounds?.(),
    });
    return true;
  }

  private async waitForElectronWindow(timeoutMs = 2000, intervalMs = 50) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const window = this.getAllElectronWindows()[0] ?? null;
      if (window) {
        return window;
      }

      await this.sleep(intervalMs);
    }

    return null;
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private registerGlobalShortcut() {
    const globalShortcut = this.getGlobalShortcutModule();
    const accelerator = this.settings.globalShortcut.trim();

    if (!globalShortcut) {
      this.registeredGlobalShortcut = null;
      return;
    }

    const previousAccelerator = this.registeredGlobalShortcut;
    if (previousAccelerator) {
      globalShortcut.unregister(previousAccelerator);
    }
    this.registeredGlobalShortcut = null;

    if (!accelerator) {
      return;
    }

    globalShortcut.unregister(accelerator);

    const wasRegistered = globalShortcut.register(accelerator, () => {
      this.debugLog("globalShortcut:triggered", { accelerator });
      void this.openFloatingNote(false, "global");
    });

    if (!wasRegistered) {
      new Notice(
        `Could not register global shortcut "${accelerator}". It may already be in use.`,
        5000
      );
      return;
    }

    this.registeredGlobalShortcut = accelerator;
  }

  private getLeafId(leaf: WorkspaceLeaf | null) {
    return (leaf as WorkspaceLeaf & { id?: string } | null)?.id ?? null;
  }

  private describeDomWindow(popoutWindow: FloatingDomWindow | null) {
    if (!popoutWindow) {
      return null;
    }

    return {
      closed: popoutWindow.closed,
      screenX: popoutWindow.screenX,
      screenY: popoutWindow.screenY,
      outerWidth: popoutWindow.outerWidth,
      outerHeight: popoutWindow.outerHeight,
      hasRequire: typeof popoutWindow.require === "function",
      isSelfWindow: popoutWindow.window === popoutWindow,
      href: popoutWindow.location?.href ?? null,
    };
  }

  private debugLog(message: string, details?: Record<string, unknown>) {
    console.log("[FloatingNote]", message, {
      at: new Date().toISOString(),
      buildId: BUILD_ID,
      ...(details ?? {}),
    });
  }

  private unregisterGlobalShortcut() {
    const globalShortcut = this.getGlobalShortcutModule();

    if (globalShortcut && this.registeredGlobalShortcut) {
      globalShortcut.unregister(this.registeredGlobalShortcut);
    }

    this.registeredGlobalShortcut = null;
  }

  async updateGlobalShortcut(value: string) {
    this.settings.globalShortcut = value.trim();
    await this.saveSettings();
    this.registerGlobalShortcut();
  }

  private async createNewQuickNote(): Promise<TFile | null> {
    const folder = this.settings.noteFolder;
    const title = moment().format(this.settings.noteTitleFormat);
    const content = this.settings.defaultNoteContent.replace(
      "{{date}}",
      moment().format("YYYY-MM-DD HH:mm")
    );

    await this.ensureFolderExists(folder);

    // Try the base path first, then (2), (3), … until a free slot is found.
    const MAX_ATTEMPTS = 100;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const suffix = attempt === 1 ? "" : ` (${attempt})`;
      const candidate = folder
        ? `${folder}/${title}${suffix}.md`
        : `${title}${suffix}.md`;
      try {
        return await this.app.vault.create(candidate, content);
      } catch {
        // File already exists – try the next suffix.
      }
    }
    new Notice("Could not create a unique note file after several attempts.");
    return null;
  }

  private async getOrCreateReusableQuickNote(): Promise<TFile | null> {
    const path = await this.getReusableQuickNotePath();
    return await this.getOrCreateReusableNoteByPath(path);
  }

  private async getOrCreateReusableNoteSet(): Promise<Map<string, TFile> | null> {
    const primaryPath = await this.getReusableQuickNotePath();
    const reusablePaths = [primaryPath, ...this.normalizeExtraReusableNotePaths(this.settings.extraReusableNotePaths)].filter(
      (path, index, paths) => paths.indexOf(path) === index
    );
    const reusableFiles = new Map<string, TFile>();

    for (const path of reusablePaths) {
      const file = await this.getOrCreateReusableNoteByPath(path);
      if (!file) {
        return null;
      }

      reusableFiles.set(path, file);
    }

    return reusableFiles;
  }

  private async getOrCreateReusableNoteByPath(path: string): Promise<TFile | null> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      return existing;
    }

    await this.ensureFolderExists(this.getFolderFromPath(path));
    return await this.app.vault.create(path, this.getReusableNoteContent());
  }

  private async getReusableQuickNotePath(): Promise<string> {
    const dailyNotesSettings = await this.getDailyNotesSettings();
    if (dailyNotesSettings) {
      const title = moment().format(dailyNotesSettings.format);
      return dailyNotesSettings.folder
        ? `${dailyNotesSettings.folder}/${title}.md`
        : `${title}.md`;
    }

    const folder = this.settings.noteFolder;
    const title = moment().format("YYYY-MM-DD") + " Quick Notes";
    return folder ? `${folder}/${title}.md` : `${title}.md`;
  }

  private getRuntimeDailyNotesSettings(): DailyNotesSettings | null {
    const internalPlugins = (this.app as AppWithInternalPlugins).internalPlugins;
    const plugin =
      internalPlugins?.getPluginById?.("daily-notes") ??
      internalPlugins?.plugins?.["daily-notes"] ??
      null;

    if (!plugin?.enabled) {
      return null;
    }

    const folder = plugin.instance?.options?.folder?.trim() ?? "";
    const format = plugin.instance?.options?.format?.trim() ?? "";

    if (!format) {
      return null;
    }

    return { folder, format };
  }

  private async readDailyNotesSettingsFile(): Promise<DailyNotesSettings | null> {
    const vault = this.app.vault as VaultWithConfig;
    const adapter = vault.adapter;
    const configDir = vault.configDir?.trim();

    if (!adapter?.read || !configDir) {
      return null;
    }

    try {
      const rawSettings = await adapter.read(`${configDir}/daily-notes.json`);
      const parsedSettings = JSON.parse(rawSettings) as {
        folder?: unknown;
        format?: unknown;
      };
      const folder =
        typeof parsedSettings.folder === "string" ? parsedSettings.folder.trim() : "";
      const format =
        typeof parsedSettings.format === "string" ? parsedSettings.format.trim() : "";

      if (!format) {
        return null;
      }

      return { folder, format };
    } catch {
      return null;
    }
  }

  private async getDailyNotesSettings(): Promise<DailyNotesSettings | null> {
    return this.getRuntimeDailyNotesSettings() ?? (await this.readDailyNotesSettingsFile());
  }

  private getReusableNoteContent() {
    return this.settings.defaultNoteContent.replace(
      "{{date}}",
      moment().format("YYYY-MM-DD")
    );
  }

  private getReusableFocusTargetPath(reusablePaths: string[], primaryPath: string) {
    const rememberedPath = this.normalizeReusableNotePath(
      this.settings.lastFocusedReusableNotePath
    );
    if (rememberedPath && reusablePaths.includes(rememberedPath)) {
      return rememberedPath;
    }

    return primaryPath;
  }

  private normalizeReusableNotePath(path: string) {
    const trimmedPath = path.trim().replace(/^\/+/, "");
    if (!trimmedPath) {
      return "";
    }

    return trimmedPath.endsWith(".md") ? trimmedPath : `${trimmedPath}.md`;
  }

  private normalizeExtraReusableNotePaths(paths: unknown) {
    if (!Array.isArray(paths)) {
      return [];
    }

    const normalizedPaths = new Set<string>();
    for (const path of paths) {
      if (typeof path !== "string") {
        continue;
      }

      const normalizedPath = this.normalizeReusableNotePath(path);
      if (!normalizedPath) {
        continue;
      }
      normalizedPaths.add(normalizedPath);
    }

    return Array.from(normalizedPaths);
  }

  private getFolderFromPath(path: string): string {
    const lastSlashIndex = path.lastIndexOf("/");
    return lastSlashIndex === -1 ? "" : path.slice(0, lastSlashIndex);
  }

  private async ensureFolderExists(folder: string) {
    if (!folder) return;
    const existing = this.app.vault.getAbstractFileByPath(folder);
    if (!existing) {
      await this.app.vault.createFolder(folder);
    }
  }

  async loadSettings() {
    const savedData = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);

    let migrated = false;
    if (this.settings.noteFolder === LEGACY_DEFAULT_SETTINGS.noteFolder) {
      this.settings.noteFolder = DEFAULT_SETTINGS.noteFolder;
      migrated = true;
    }
    if (this.settings.noteTitleFormat === LEGACY_DEFAULT_SETTINGS.noteTitleFormat) {
      this.settings.noteTitleFormat = DEFAULT_SETTINGS.noteTitleFormat;
      migrated = true;
    }
    // Earlier quick-note default used an unescaped literal and produced odd filenames.
    if (this.settings.noteTitleFormat === "Quick - YYYY-MM-DD HH[h]mm") {
      this.settings.noteTitleFormat = DEFAULT_SETTINGS.noteTitleFormat;
      migrated = true;
    }
    // Common plain-text format that Moment mutates (e.g., "Note" -> "ADot2").
    if (this.settings.noteTitleFormat === "Note") {
      this.settings.noteTitleFormat = "[Note]";
      migrated = true;
    }
    if (typeof this.settings.globalShortcut !== "string") {
      this.settings.globalShortcut = DEFAULT_SETTINGS.globalShortcut;
      migrated = true;
    }
    if (this.settings.defaultNoteContent === LEGACY_DEFAULT_SETTINGS.defaultNoteContent) {
      this.settings.defaultNoteContent = DEFAULT_SETTINGS.defaultNoteContent;
      migrated = true;
    }
    const normalizedExtraReusableNotePaths = this.normalizeExtraReusableNotePaths(
      this.settings.extraReusableNotePaths
    );
    if (
      !Array.isArray(this.settings.extraReusableNotePaths) ||
      normalizedExtraReusableNotePaths.length !== this.settings.extraReusableNotePaths.length ||
      normalizedExtraReusableNotePaths.some(
        (path, index) => path !== this.settings.extraReusableNotePaths[index]
      )
    ) {
      this.settings.extraReusableNotePaths = normalizedExtraReusableNotePaths;
      migrated = true;
    }
    if (typeof this.settings.lastFocusedReusableNotePath !== "string") {
      this.settings.lastFocusedReusableNotePath =
        DEFAULT_SETTINGS.lastFocusedReusableNotePath;
      migrated = true;
    } else {
      const normalizedLastFocusedPath = this.normalizeReusableNotePath(
        this.settings.lastFocusedReusableNotePath
      );
      if (normalizedLastFocusedPath !== this.settings.lastFocusedReusableNotePath) {
        this.settings.lastFocusedReusableNotePath = normalizedLastFocusedPath;
        migrated = true;
      }
    }

    if (migrated) {
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async updateExtraReusableNotePaths(value: string) {
    this.settings.extraReusableNotePaths = this.normalizeExtraReusableNotePaths(
      value.split("\n")
    );
    await this.saveSettings();
  }

  async rememberLastFocusedReusableNote(path: string) {
    const normalizedPath = this.normalizeReusableNotePath(path);
    if (!normalizedPath || this.settings.lastFocusedReusableNotePath === normalizedPath) {
      return;
    }

    this.settings.lastFocusedReusableNotePath = normalizedPath;
    await this.saveSettings();
  }
}

class FloatingNoteSettingTab extends PluginSettingTab {
  plugin: FloatingNotePlugin;

  constructor(app: App, plugin: FloatingNotePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Note preferences").setHeading();

    // ── Note settings ──────────────────────────────────────────────────────

    new Setting(containerEl)
      .setName("Notes folder")
      .setDesc(
        "Folder where new quick notes are saved. Leave blank for vault root. Reusable quick notes follow Daily Notes settings when available."
      )
      .addText((text) =>
        text
          .setPlaceholder("Quick notes")
          .setValue(this.plugin.settings.noteFolder)
          .onChange(async (value) => {
            this.plugin.settings.noteFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("New note title format")
      .setDesc(
        "Moment.js date format for notes opened via 'Open new note'. Wrap plain text in square brackets (e.g. [Note])."
      )
      .addText((text) =>
        text
          .setPlaceholder("[Quick] - YYYY-MM-DD HH[h]mm")
          .setValue(this.plugin.settings.noteTitleFormat)
          .onChange(async (value) => {
            this.plugin.settings.noteTitleFormat = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Global shortcut")
      .setDesc(
        'Electron accelerator that toggles the reusable quick note from any app. Use values like Ctrl+` or Cmd+Shift+Space. Leave blank to disable.'
      )
      .addText((text) =>
        text
          .setPlaceholder("Ctrl+`")
          .setValue(this.plugin.settings.globalShortcut)
          .onChange(async (value) => {
            await this.plugin.updateGlobalShortcut(value);
          })
      );

    new Setting(containerEl)
      .setName("Default note content")
      .setDesc("Template for new notes. Use {{date}} for the current date/time.")
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.defaultNoteContent)
          .onChange(async (value) => {
            this.plugin.settings.defaultNoteContent = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Additional reusable notes")
      .setDesc(
        "Vault-relative note paths to open alongside the reusable note, one per line. These only open with 'Toggle reusable quick note (floating)'."
      )
      .addTextArea((text) =>
        text
          .setPlaceholder("Ideas.md\nProjects/Ideas.md")
          .setValue(this.plugin.settings.extraReusableNotePaths.join("\n"))
          .onChange(async (value) => {
            await this.plugin.updateExtraReusableNotePaths(value);
          })
      );

    // ── Window settings ─────────────────────────────────────────────────────

    new Setting(containerEl).setName("Window").setHeading();

    new Setting(containerEl)
      .setName("Always on top")
      .setDesc("Keep the floating note window above other windows.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.alwaysOnTop)
          .onChange(async (value) => {
            this.plugin.settings.alwaysOnTop = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Window width (px)")
      .addSlider((slider) =>
        slider
          .setLimits(300, 1200, 20)
          .setValue(this.plugin.settings.windowWidth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.windowWidth = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Window height (px)")
      .addSlider((slider) =>
        slider
          .setLimits(200, 1000, 20)
          .setValue(this.plugin.settings.windowHeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.windowHeight = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Window opacity (%)")
      .setDesc("Make the window slightly transparent (100 = fully opaque).")
      .addSlider((slider) =>
        slider
          .setLimits(30, 100, 5)
          .setValue(this.plugin.settings.opacity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.opacity = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
