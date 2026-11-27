// Mock for '@electron/remote' (fallback path used by tryElectronRemote)

export const mockRemoteWin = {
    getBounds: jest.fn().mockReturnValue({ x: 100, y: 100, width: 1200, height: 900 }),
    setBounds: jest.fn(),
    setAlwaysOnTop: jest.fn(),
    setVisibleOnAllWorkspaces: jest.fn(),
    setOpacity: jest.fn(),
    close: jest.fn(),
    show: jest.fn(),
    focus: jest.fn(),
    isFocusable: jest.fn().mockReturnValue(true),
    setFocusable: jest.fn(),
    isDestroyed: jest.fn().mockReturnValue(false),
    isMinimized: jest.fn().mockReturnValue(false),
    minimize: jest.fn(),
    restore: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    removeListener: jest.fn(),
};

export const BrowserWindow = {
    getFocusedWindow: jest.fn().mockReturnValue(mockRemoteWin),
    getAllWindows: jest.fn().mockReturnValue([mockRemoteWin]),
};

export const app = {
    focus: jest.fn(),
    show: jest.fn(),
    dock: {
        show: jest.fn().mockResolvedValue(undefined),
    },
};

export const screen = {
    getCursorScreenPoint: jest.fn().mockReturnValue({ x: 2000, y: 400 }),
    getDisplayMatching: jest.fn().mockReturnValue({
        bounds: { x: 1440, y: 0, width: 1440, height: 900 },
        workArea: { x: 1440, y: 23, width: 1440, height: 847 },
    }),
    getDisplayNearestPoint: jest.fn().mockReturnValue({
        bounds: { x: 1440, y: 0, width: 1440, height: 900 },
        workArea: { x: 1440, y: 23, width: 1440, height: 847 },
    }),
    getPrimaryDisplay: jest.fn().mockReturnValue({
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        workArea: { x: 0, y: 23, width: 1440, height: 847 },
    }),
};

export const globalShortcut = {
    register: jest.fn().mockReturnValue(true),
    unregister: jest.fn(),
    unregisterAll: jest.fn(),
};

module.exports = { BrowserWindow, mockRemoteWin, screen, globalShortcut, app };
