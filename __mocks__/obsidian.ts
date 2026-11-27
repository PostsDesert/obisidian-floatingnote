// Mock for the 'obsidian' module
// Provides minimal stubs for all APIs used by main.ts

import { EventEmitter } from "events";

// ── moment stub ────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const moment = require("moment");

let leafCounter = 0;
let sessionCounter = 0;

type EditorPosition = {
    line: number;
    ch: number;
};

type EditorRange = {
    from: EditorPosition;
    to: EditorPosition;
};

type WorkspaceEventName = "active-leaf-change" | "window-close";

type MockPopoutWindow = {
    closed: boolean;
    screenX: number;
    screenY: number;
    outerWidth: number;
    outerHeight: number;
    window: unknown;
    close: jest.Mock;
    moveTo: jest.Mock;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
    dispatchEventName(eventName: string): void;
    require: jest.Mock;
};

type MockWorkspaceSession = {
    emitWorkspaceEvent(name: WorkspaceEventName, ...args: any[]): void;
    browserWindow: {
        getBounds: jest.Mock;
        setBounds: jest.Mock;
        setAlwaysOnTop: jest.Mock;
        setVisibleOnAllWorkspaces: jest.Mock;
        setOpacity: jest.Mock;
        setTitle: jest.Mock;
        close: jest.Mock;
        show: jest.Mock;
        focus: jest.Mock;
        isFocusable: jest.Mock;
        setFocusable: jest.Mock;
        isDestroyed: jest.Mock;
        isMinimized: jest.Mock;
        minimize: jest.Mock;
        restore: jest.Mock;
        on: jest.Mock;
        off: jest.Mock;
        removeListener: jest.Mock;
        dispatchEventName(eventName: string): void;
    };
    electronModule: {
        remote: {
            getCurrentWindow: jest.Mock;
        };
    };
    remoteModule: {
        getCurrentWindow: jest.Mock;
        default: {
            getCurrentWindow: jest.Mock;
        };
    };
    tabsParent: {
        id: string;
        parent: {
            id: string;
        };
    };
    closeWorkspaceWindow: jest.Mock;
    leaves: WorkspaceLeaf[];
    window: MockPopoutWindow;
};

function createWorkspaceSession(
    emitWorkspaceEvent: MockWorkspaceSession["emitWorkspaceEvent"] = () => undefined
): MockWorkspaceSession {
    const browserWindowListeners = new Map<string, Set<() => void>>();
    const browserWindow = {
        getBounds: jest.fn().mockReturnValue({ x: 100, y: 100, width: 1200, height: 900 }),
        setBounds: jest.fn(),
        setAlwaysOnTop: jest.fn(),
        setVisibleOnAllWorkspaces: jest.fn(),
        setOpacity: jest.fn(),
        setTitle: jest.fn(),
        close: jest.fn(() => {
            browserWindow.dispatchEventName("close");
            window.closed = true;
            emitWorkspaceEvent("window-close", undefined, window as unknown as Window);
        }),
        show: jest.fn(),
        focus: jest.fn(),
        isFocusable: jest.fn().mockReturnValue(true),
        setFocusable: jest.fn(),
        isDestroyed: jest.fn().mockReturnValue(false),
        isMinimized: jest.fn().mockReturnValue(false),
        minimize: jest.fn(),
        restore: jest.fn(),
        on: jest.fn((eventName: string, listener: () => void) => {
            const eventListeners = browserWindowListeners.get(eventName) ?? new Set<() => void>();
            eventListeners.add(listener);
            browserWindowListeners.set(eventName, eventListeners);
        }),
        off: jest.fn((eventName: string, listener: () => void) => {
            browserWindowListeners.get(eventName)?.delete(listener);
        }),
        removeListener: jest.fn((eventName: string, listener: () => void) => {
            browserWindowListeners.get(eventName)?.delete(listener);
        }),
        dispatchEventName: (eventName: string) => {
            for (const listener of browserWindowListeners.get(eventName) ?? []) {
                listener();
            }
        },
    };
    const electronModule = {
        remote: {
            getCurrentWindow: jest.fn().mockReturnValue(browserWindow),
        },
    };
    const remoteModule = {
        getCurrentWindow: jest.fn().mockReturnValue(browserWindow),
        default: {
            getCurrentWindow: jest.fn().mockReturnValue(browserWindow),
        },
    };
    const listeners = new Map<string, Set<() => void>>();
    const window = {
        closed: false,
        screenX: 0,
        screenY: 0,
        outerWidth: 480,
        outerHeight: 600,
        window: null as unknown,
        close: jest.fn(() => {
            window.closed = true;
            emitWorkspaceEvent("window-close", undefined, window as unknown as Window);
        }),
        moveTo: jest.fn(),
        addEventListener: jest.fn((eventName: string, listener: () => void) => {
            const eventListeners = listeners.get(eventName) ?? new Set<() => void>();
            eventListeners.add(listener);
            listeners.set(eventName, eventListeners);
        }),
        removeEventListener: jest.fn((eventName: string, listener: () => void) => {
            listeners.get(eventName)?.delete(listener);
        }),
        dispatchEventName: (eventName: string) => {
            for (const listener of listeners.get(eventName) ?? []) {
                listener();
            }
        },
        require: jest.fn((moduleName: string) => {
            if (moduleName === "electron") {
                return electronModule;
            }
            if (moduleName === "@electron/remote") {
                return remoteModule;
            }
            throw new Error(`Unexpected module request: ${moduleName}`);
        }),
    };
    window.window = window;

    const closeWorkspaceWindow = jest.fn(() => {
        for (const leaf of [...session.leaves]) {
            leaf.detach();
        }
        window.close();
    });

    const session: MockWorkspaceSession = {
        emitWorkspaceEvent,
        browserWindow,
        electronModule,
        remoteModule,
        tabsParent: {
            id: `tabs-${++sessionCounter}`,
            parent: { id: `split-${sessionCounter}` },
        },
        closeWorkspaceWindow,
        leaves: [],
        window,
    };
    return session;
}

// ── TFile ─────────────────────────────────────────────────────────────────
export class TFile {
    path: string;
    name: string;
    constructor(path: string) {
        this.path = path;
        this.name = path.split("/").pop() ?? path;
    }
}

// ── Notice ────────────────────────────────────────────────────────────────
export class Notice {
    message: string;
    constructor(message: string, _timeout?: number) {
        this.message = message;
    }
}

export class MockEditor {
    private doc = "";
    cursor: EditorPosition = { line: 0, ch: 0 };
    scrollTarget: EditorRange | null = null;
    focused = false;

    setDoc(content: string) {
        this.doc = content;
    }

    getValue() {
        return this.doc;
    }

    getLine(line: number) {
        const lines = this.doc.split("\n");
        return lines[line] ?? "";
    }

    lineCount() {
        return this.doc.split("\n").length;
    }

    lastLine() {
        return this.lineCount() - 1;
    }

    replaceRange(replacement: string, from: EditorPosition, to: EditorPosition = from) {
        const startOffset = this.posToOffset(from);
        const endOffset = this.posToOffset(to);
        this.doc = this.doc.slice(0, startOffset) + replacement + this.doc.slice(endOffset);
    }

    setCursor(pos: EditorPosition) {
        this.cursor = { ...pos };
    }

    scrollIntoView(range: EditorRange) {
        this.scrollTarget = {
            from: { ...range.from },
            to: { ...range.to },
        };
    }

    focus() {
        this.focused = true;
    }

    private posToOffset(pos: EditorPosition) {
        const lines = this.doc.split("\n");
        let offset = 0;
        for (let index = 0; index < pos.line; index++) {
            offset += (lines[index] ?? "").length + 1;
        }
        return offset + pos.ch;
    }
}

// ── WorkspaceLeaf stub ────────────────────────────────────────────────────
export class WorkspaceLeaf {
    id = `leaf-${++leafCounter}`;
    detached = false;
    editor = new MockEditor();
    session: MockWorkspaceSession;
    parent: MockWorkspaceSession["tabsParent"];
    popoutBrowserWindow: MockWorkspaceSession["browserWindow"];
    popoutRemoteModule: MockWorkspaceSession["remoteModule"];
    popoutElectronModule: MockWorkspaceSession["electronModule"];
    popoutWindow: MockPopoutWindow;
    container: { win: MockPopoutWindow; close: jest.Mock };
    view: {
        editor: MockEditor;
        containerEl: {
            ownerDocument: {
                defaultView: MockPopoutWindow;
                hasFocus: jest.Mock;
                documentElement: {
                    setCssProps: jest.Mock;
                    style: { setProperty: jest.Mock };
                };
            };
        };
    };
    openFile: jest.Mock;
    getContainer: jest.Mock;
    detach: jest.Mock;

    constructor(session = createWorkspaceSession()) {
        this.session = session;
        this.parent = session.tabsParent;
        this.popoutBrowserWindow = session.browserWindow;
        this.popoutRemoteModule = session.remoteModule;
        this.popoutElectronModule = session.electronModule;
        this.popoutWindow = session.window;
        this.container = { win: this.popoutWindow, close: session.closeWorkspaceWindow };
        this.view = {
            editor: this.editor,
            containerEl: {
                ownerDocument: {
                    defaultView: this.popoutWindow,
                    hasFocus: jest.fn().mockReturnValue(false),
                    documentElement: {
                        setCssProps: jest.fn(),
                        style: { setProperty: jest.fn() },
                    },
                },
            },
        };
        this.openFile = jest.fn().mockImplementation(async (file: TFile & { contents?: string }) => {
            this.editor.setDoc(file.contents ?? "");
        });
        this.getContainer = jest.fn(() => this.container);
        this.detach = jest.fn(() => {
            this.detached = true;
            this.session.leaves = this.session.leaves.filter((leaf) => leaf !== this);
            if (this.session.leaves.length === 0) {
                this.popoutWindow.closed = true;
            }
        });
    }
}

// ── App stub ──────────────────────────────────────────────────────────────
export class App {
    private leafById = new Map<string, WorkspaceLeaf>();
    private workspaceHandlers = new Map<WorkspaceEventName, Set<(...args: any[]) => void>>();
    workspace: {
        activeLeaf: WorkspaceLeaf | null;
        openPopoutLeaf: jest.Mock;
        getLeaf: jest.Mock;
        setActiveLeaf: jest.Mock;
        getLeafById: jest.Mock;
        on: jest.Mock;
        createdLeaves: WorkspaceLeaf[];
    };
    vault = {
        configDir: ".obsidian",
        adapter: {
            read: jest.fn(),
        },
        getAbstractFileByPath: jest.fn().mockReturnValue(null),
        create: jest.fn(),
        createFolder: jest.fn().mockResolvedValue(undefined),
    };
    internalPlugins = {
        getPluginById: jest.fn().mockReturnValue(null),
        plugins: {} as Record<string, unknown>,
    };

    constructor() {
        this.workspaceHandlers.set("active-leaf-change", new Set());
        this.workspaceHandlers.set("window-close", new Set());

        const createdLeaves: WorkspaceLeaf[] = [];
        this.workspace = {
            activeLeaf: null,
            createdLeaves,
            openPopoutLeaf: jest.fn().mockImplementation(() => {
                const session = createWorkspaceSession(this.emitWorkspaceEvent.bind(this));
                const leaf = new WorkspaceLeaf(session);
                session.leaves.push(leaf);
                createdLeaves.push(leaf);
                this.leafById.set(leaf.id, leaf);
                return leaf;
            }),
            getLeaf: jest.fn().mockImplementation((newLeaf?: string | boolean) => {
                const activeLeaf = this.workspace.activeLeaf;
                const session =
                    newLeaf === "tab" || newLeaf === true
                        ? activeLeaf?.session ?? createWorkspaceSession(this.emitWorkspaceEvent.bind(this))
                        : createWorkspaceSession(this.emitWorkspaceEvent.bind(this));
                const leaf = new WorkspaceLeaf(session);
                const activeLeafIndex = activeLeaf ? session.leaves.indexOf(activeLeaf) : -1;
                if ((newLeaf === "tab" || newLeaf === true) && activeLeafIndex >= 0) {
                    session.leaves.splice(activeLeafIndex + 1, 0, leaf);
                } else {
                    session.leaves.push(leaf);
                }
                createdLeaves.push(leaf);
                this.leafById.set(leaf.id, leaf);
                return leaf;
            }),
            setActiveLeaf: jest.fn().mockImplementation((leaf: WorkspaceLeaf) => {
                this.workspace.activeLeaf = leaf;
                this.emitWorkspaceEvent("active-leaf-change", leaf);
            }),
            getLeafById: jest.fn((id: string) => this.leafById.get(id) ?? null),
            on: jest.fn().mockImplementation((name: WorkspaceEventName, callback: (...args: any[]) => void) => {
                this.workspaceHandlers.get(name)?.add(callback);
                return {};
            }),
        };
    }

    emitWorkspaceEvent(name: WorkspaceEventName, ...args: any[]) {
        for (const callback of this.workspaceHandlers.get(name) ?? []) {
            callback(...args);
        }
    }
}

// ── Plugin base class ─────────────────────────────────────────────────────
export class Plugin extends EventEmitter {
    app: App;
    manifest: Record<string, unknown>;
    private _data: Record<string, unknown> = {};

    constructor(app: App, manifest: Record<string, unknown> = {}) {
        super();
        this.app = app;
        this.manifest = manifest;
    }

    async loadData(): Promise<Record<string, unknown>> {
        return this._data;
    }

    async saveData(data: Record<string, unknown>): Promise<void> {
        this._data = { ...data };
    }

    _setSavedData(data: Record<string, unknown>) {
        this._data = { ...data };
    }

    addCommand = jest.fn();
    addRibbonIcon = jest.fn();
    addSettingTab = jest.fn();
    register = jest.fn();
    registerEvent = jest.fn();
}

// ── PluginSettingTab stub ─────────────────────────────────────────────────
export class PluginSettingTab {
    app: App;
    plugin: Plugin;
    containerEl = {
        empty: jest.fn(),
        createEl: jest.fn().mockReturnValue({}),
    };
    constructor(app: App, plugin: Plugin) {
        this.app = app;
        this.plugin = plugin;
    }
    display() {
        return;
    }
}

// ── Setting stub ──────────────────────────────────────────────────────────
export class Setting {
    setName = jest.fn().mockReturnThis();
    setHeading = jest.fn().mockReturnThis();
    setDesc = jest.fn().mockReturnThis();
    addButton = jest.fn().mockReturnThis();
    addText = jest.fn().mockReturnThis();
    addTextArea = jest.fn().mockReturnThis();
    addToggle = jest.fn().mockReturnThis();
    addSlider = jest.fn().mockReturnThis();
    constructor(_containerEl: unknown) {
        void _containerEl;
    }
}
