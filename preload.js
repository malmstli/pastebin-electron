
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    login: (username, password) =>
        ipcRenderer.invoke("auth:login", username, password),

    checkLogin: () =>
        ipcRenderer.invoke("auth:check"),

    logout: () =>
        ipcRenderer.invoke("auth:logout"),

    connect: () =>
        ipcRenderer.invoke("ws:connect"),

    sendText: (text) =>
        ipcRenderer.invoke("ws:send", text),

    onStatus: (callback) => {
        ipcRenderer.on("ws:status", (event, status) => {
            callback(status);
        });
    },

    onMessage: (callback) => {
        ipcRenderer.on("ws:message", (event, text) => {
            callback(text);
        });
    }
});
