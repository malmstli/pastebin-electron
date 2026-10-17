
const loginForm = document.getElementById("login-form");
const loginSection = document.getElementById("login-section");
const pastebinSection = document.getElementById("pastebin-section");

const loginMessage = document.getElementById("login-message");
const logoutBtn = document.getElementById("logout-btn");
const sendBtn = document.getElementById("send-btn");
const copyBtn = document.getElementById("copy-btn");
const reconnectBtn = document.getElementById("reconnect-btn");

const textInput = document.getElementById("text-input");
const status = document.getElementById("status");
const message = document.getElementById("message");

function showPage(loggedIn) {
    loginSection.hidden = loggedIn;
    pastebinSection.hidden = !loggedIn;
}

function showMessage(text) {
    message.textContent = text;
}

// Connection status from Electron
window.electronAPI.onStatus((newStatus) => {
    status.textContent = newStatus;
    status.classList.toggle("connected", newStatus === "Connected");

    if (newStatus === "Connected") {
        showMessage("Connected to WebSocket!");
    } else if (newStatus === "Connecting...") {
        showMessage("Connecting to WebSocket...");
    } else if (newStatus === "Session expired") {
        showPage(false);
        loginMessage.textContent = "Session expired. Please log in again.";
        showMessage("");
    } else {
        showMessage("Disconnected from WebSocket.");
    }
});

// Incoming WebSocket text
window.electronAPI.onMessage((text) => {
    textInput.value = text;
    showMessage("Text received!");
});

// Login
loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    loginMessage.textContent = "Logging in...";

    try {
        const result = await window.electronAPI.login(username, password);

        if (result.success) {
            showPage(true);
            loginForm.reset();
            loginMessage.textContent = "";

            await window.electronAPI.connect();
        } else {
            loginMessage.textContent = result.message;
        }
    } catch {
        loginMessage.textContent = "Login failed.";
    }
});

// Send text
sendBtn.addEventListener("click", async () => {
    if (!textInput.value.trim()) {
        showMessage("Please enter some text.");
        return;
    }

    const sent = await window.electronAPI.sendText(textInput.value);

    showMessage(sent ? "Text sent!" : "Not connected to WebSocket.");
});

// Copy text
copyBtn.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(textInput.value);
        showMessage("Text copied!");
    } catch {
        showMessage("Could not copy text.");
    }
});

// Reconnect
reconnectBtn.addEventListener("click", async () => {
    await window.electronAPI.connect();
});

// Logout
logoutBtn.addEventListener("click", async () => {
    const result = await window.electronAPI.logout();

    if (!result.success) {
        showMessage(result.message);
        return;
    }

    showPage(false);
    loginForm.reset();
    textInput.value = "";
    loginMessage.textContent = "";
    showMessage("");
});

// Check saved login
async function startApp() {
    const loggedIn = await window.electronAPI.checkLogin();

    showPage(loggedIn);

    if (loggedIn) {
        await window.electronAPI.connect();
    }
}

startApp();
