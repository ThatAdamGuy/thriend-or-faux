// settings.js
// Handles saving and loading the Anthropic API key from Chrome's local storage.

const apiKeyInput = document.getElementById("api-key");
const saveBtn = document.getElementById("save-btn");
const toggleBtn = document.getElementById("toggle-visibility");
const status = document.getElementById("status");

// Load the saved key when the settings page opens.
chrome.storage.local.get("anthropicApiKey", (result) => {
  if (result.anthropicApiKey) {
    apiKeyInput.value = result.anthropicApiKey;
  }
});

// Save the key when the user clicks Save.
saveBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();

  if (!key) {
    status.style.color = "#f08080";
    status.textContent = "Please enter an API key.";
    return;
  }

  if (!key.startsWith("sk-ant-")) {
    status.style.color = "#f08080";
    status.textContent = "That doesn't look like an Anthropic key (should start with sk-ant-).";
    return;
  }

  chrome.storage.local.set({ anthropicApiKey: key }, () => {
    status.style.color = "#6dbf6d";
    status.textContent = "Saved!";
    setTimeout(() => { status.textContent = ""; }, 2000);
  });
});

// Toggle between showing/hiding the key.
toggleBtn.addEventListener("click", () => {
  const isHidden = apiKeyInput.type === "password";
  apiKeyInput.type = isHidden ? "text" : "password";
  toggleBtn.textContent = isHidden ? "Hide" : "Show";
});

// Some Chromium variants block default paste into extension popups.
apiKeyInput.addEventListener("paste", (e) => {
  const text = (e.clipboardData || window.clipboardData)?.getData("text");
  if (!text) return;
  e.preventDefault();
  apiKeyInput.value = text.trim();
});

// Clipboard API button — works even when keyboard/context-menu paste is blocked.
document.getElementById("paste-btn").addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    apiKeyInput.value = text.trim();
  } catch (e) {
    status.style.color = "#f08080";
    status.textContent = "Clipboard access blocked in this browser — select the field and use Cmd/Ctrl+V, or type the key manually.";
  }
});
