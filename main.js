
const {
    app,
    BrowserWindow,
    ipcMain,
    safeStorage
} = require("electron");

const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

const API_URL = "https://womp1loginapi.onrender.com";
const WS_URL = "wss://ws-pastebin.onrender.com/";

let socket = null;
let accessToken = null;
let refreshToken = null;
let refreshTimer = null;
let refreshPromise = null;

// Token storage
function getTokenPath() {
    return path.join(app.getPath("userData"), "tokens.dat");
}

function saveTokens(access, refresh) {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Secure storage is not available");
    }

    const tokens = JSON.stringify({
        accessToken: access,
        refreshToken: refresh
    });

    const encrypted = safeStorage.encryptString(tokens);
    fs.writeFileSync(getTokenPath(), encrypted);

    accessToken = access;
    refreshToken = refresh;
}

function loadTokens() {
    try {
        if (!safeStorage.isEncryptionAvailable()) {
            return false;
        }

        const encrypted = fs.readFileSync(getTokenPath());
        const tokens = JSON.parse(safeStorage.decryptString(encrypted));

        accessToken = tokens.accessToken;
        refreshToken = tokens.refreshToken;

        return Boolean(accessToken && refreshToken);
    } catch {
        return false;
    }
}

function clearTokens() {
    accessToken = null;
    refreshToken = null;

    clearTimeout(refreshTimer);
    refreshTimer = null;

    try {
        fs.unlinkSync(getTokenPath());
    } catch {
        // No saved tokens
    }

    // Remove old token file from previous version
    try {
        fs.unlinkSync(path.join(app.getPath("userData"), "token.dat"));
    } catch {
        // No old token
    }
}

// Check JWT expiration
function getTokenExpiry(token) {
    try {
        const payload = JSON.parse(
            Buffer.from(token.split(".")[1], "base64url").toString()
        );

        return payload.exp * 1000 || 0;
    } catch {
        return 0;
    }
}

function tokenExpired(token) {
    return !token || Date.now() >= getTokenExpiry(token);
}

// Send connection status to frontend
function sendStatus(text) {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.send("ws:status", text);
        }
    }
}

// Disconnect WebSocket
function disconnectWebSocket() {
    if (socket) {
        const oldSocket = socket;
        socket = null;

        // Keep error listeners to prevent unhandled errors
        oldSocket.terminate();
    }

    sendStatus("Disconnected");
}

// Refresh access token
async function refreshAccessToken() {
    if (refreshPromise) {
        return refreshPromise;
    }

    refreshPromise = (async () => {
        if (!refreshToken || tokenExpired(refreshToken)) {
            return false;
        }

        try {
            const response = await fetch(`${API_URL}/refresh`, {
                method: "POST",
                headers: {
                    jwtRef: `Bearer ${refreshToken}`
                }
            });

            if (!response.ok) {
                return false;
            }

            const data = await response.json();

            if (!data.jwtAccess) {
                return false;
            }

            saveTokens(data.jwtAccess, data.jwtRef || refreshToken);
            scheduleRefresh();

            return true;
        } catch (error) {
            console.error("Refresh error:", error.message);
            return false;
        }
    })();

    try {
        return await refreshPromise;
    } finally {
        refreshPromise = null;
    }
}

// Refresh automatically before expiration
function scheduleRefresh() {
    clearTimeout(refreshTimer);

    if (!accessToken) return;

    const delay = Math.max(
        0,
        getTokenExpiry(accessToken) - Date.now() - 60000
    );

    refreshTimer = setTimeout(async () => {
        const success = await refreshAccessToken();

        if (success) {
            disconnectWebSocket();
            connectWebSocket();
        } else {
            disconnectWebSocket();
            clearTokens();
            sendStatus("Session expired");
        }
    }, delay);
}

// Connect WebSocket
async function connectWebSocket() {
    if (tokenExpired(accessToken)) {
        const success = await refreshAccessToken();

        if (!success) {
            disconnectWebSocket();
            clearTokens();
            sendStatus("Session expired");
            return false;
        }
    }

    if (socket && (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
    )) {
        return true;
    }

    disconnectWebSocket();
    sendStatus("Connecting...");

    const ws = new WebSocket(
        `${WS_URL}?token=${encodeURIComponent(accessToken)}`
    );

    socket = ws;

    ws.on("open", () => {
        if (socket !== ws) return;
        sendStatus("Connected");
    });

    ws.on("message", (data) => {
        if (socket !== ws) return;

        try {
            const result = JSON.parse(data.toString());

            if (result.status === 0) {
                for (const win of BrowserWindow.getAllWindows()) {
                    if (!win.isDestroyed()) {
                        win.webContents.send("ws:message", result.msg);
                    }
                }
            }
        } catch (error) {
            console.error("Invalid WebSocket message:", error.message);
        }
    });

    ws.on("error", (error) => {
        if (socket !== ws) return;
        console.error("WebSocket error:", error.message);
        sendStatus("Connection error");
    });

    ws.on("close", () => {
        if (socket !== ws) return;

        socket = null;
        sendStatus("Disconnected");
    });

    return true;
}

// Reconnect
ipcMain.handle("ws:connect", async () => {
    if (socket && socket.readyState === WebSocket.CONNECTING) {
        return;
    }

    disconnectWebSocket();
    await connectWebSocket();
});

// Send text
ipcMain.handle("ws:send", (event, text) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
    }

    if (typeof text !== "string" || !text.trim()) {
        return false;
    }

    socket.send(text);
    return true;
});

// Login through Electron main process
ipcMain.handle("auth:login", async (event, username, password) => {
    disconnectWebSocket();

    try {
        const response = await fetch(`${API_URL}/users/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ username, password })
        });

        if (!response.ok) {
            return {
                success: false,
                message: "Invalid username or password."
            };
        }

        const data = await response.json();

        if (!data.jwtAccess || !data.jwtRef) {
            return {
                success: false,
                message: "Login tokens missing."
            };
        }

        saveTokens(data.jwtAccess, data.jwtRef);
        scheduleRefresh();

        return { success: true };

    } catch (error) {
        console.error("Login error:", error.message);

        return {
            success: false,
            message: "Could not connect to login server."
        };
    }
});

// Check saved login
ipcMain.handle("auth:check", async () => {
    if (!loadTokens()) {
        return false;
    }

    if (tokenExpired(refreshToken)) {
        clearTokens();
        return false;
    }

    if (tokenExpired(accessToken)) {
        const success = await refreshAccessToken();

        if (!success) {
            clearTokens();
            return false;
        }
    }

    scheduleRefresh();
    return true;
});

// Logout through API
ipcMain.handle("auth:logout", async () => {
    const token = refreshToken;

    try {
        if (token) {
            const response = await fetch(`${API_URL}/refresh`, {
                method: "DELETE",
                headers: {
                    jwtRef: `Bearer ${token}`
                }
            });

            if (!response.ok) {
                return {
                    success: false,
                    message: "Logout failed. Please try again."
                };
            }
        }

        disconnectWebSocket();
        clearTokens();

        return { success: true };

    } catch (error) {
        console.error("Logout error:", error.message);

        return {
            success: false,
            message: "Could not connect to logout server."
        };
    }
});

// Create Electron window
function createWindow() {
    const win = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 600,
        minHeight: 500,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    win.loadFile("renderer/index.html");
}

app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
