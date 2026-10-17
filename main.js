
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

function sendStatus(text) {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            win.webContents.send("ws:status", text);
        }
    }
}

function disconnectWebSocket() {
    if (socket) {
        const oldSocket = socket;
        socket = null;
        oldSocket.removeAllListeners();
        oldSocket.terminate();
    }

    sendStatus("Disconnected");
}

function connectWebSocket() {
    if (!accessToken || tokenExpired(accessToken)) {
        disconnectWebSocket();
        return;
    }

    if (socket && (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
    )) {
        return;
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
                    win.webContents.send("ws:message", result.msg);
                }
            }
        } catch (error) {
            console.error("Invalid WebSocket message:", error.message);
        }
    });

    ws.on("error", (error) => {
        if (socket !== ws) return;
        console.error("WebSocket error:", error.message);
    });

    ws.on("close", () => {
        if (socket !== ws) return;
        socket = null;
        sendStatus("Disconnected");
    });
}

ipcMain.handle("ws:connect", () => {
    connectWebSocket();
});

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

let accessToken = null;

// File for encrypted token
function getTokenPath() {
    return path.join(app.getPath("userData"), "token.dat");
}

// Save token securely
function saveToken(token) {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Secure storage is not available");
    }

    const encrypted = safeStorage.encryptString(token);

    fs.writeFileSync(getTokenPath(), encrypted);
    accessToken = token;
}

// Load saved token
function loadToken() {
    try {
        if (!safeStorage.isEncryptionAvailable()) {
            return null;
        }

        const encrypted = fs.readFileSync(getTokenPath());
        return safeStorage.decryptString(encrypted);
    } catch {
        return null;
    }
}

// Clear saved token
function clearToken() {
    accessToken = null;

    try {
        fs.unlinkSync(getTokenPath());
    } catch {
        // No saved token
    }
}

// Check token expiration
function tokenExpired(token) {
    try {
        const payload = JSON.parse(
            Buffer.from(token.split(".")[1], "base64url").toString()
        );

        return !payload.exp || Date.now() >= payload.exp * 1000;
    } catch {
        return true;
    }
}

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

        if (!data.jwt) {
            return {
                success: false,
                message: "No token received."
            };
        }

        saveToken(data.jwt);

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
ipcMain.handle("auth:check", () => {
    accessToken = loadToken();

    if (!accessToken || tokenExpired(accessToken)) {
        clearToken();
        return false;
    }

    return true;
});

// Local logout for now
ipcMain.handle("auth:logout", () => {
    disconnectWebSocket();
    clearToken();
    return true;
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
