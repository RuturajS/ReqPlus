# ⬡ ReqPlus
**Lightweight Browser Security Toolkit for Chromium Browsers**

ReqPlus is a minimal, high-efficiency security testing extension inspired by Burp Suite. It enables you to intercept, inspect, modify, and replay HTTP/HTTPS requests directly inside your browser's DevTools panel.

## ✨ Features
- **Proxy / Intercept**: Pause requests in real-time. Forward or Drop them after modification.
- **HTTP History**: A global log of all browser traffic with advanced filtering.
- **Repeater**: Craft manual requests and analyze responses with a built-in diff engine.
- **Intruder**: Automated payload injection with Sniper, Battering Ram, and Cluster Bomb modes.
- **Monochrome UI**: A premium, high-contrast black & white interface designed for focus.
- **Privacy Native**: 100% local processing. No external dependencies or data tracking.

## 🚀 Installation

### 1. Clone or Download
Clone this repository to your local machine:
```bash
git clone https://github.com/RuturajS/ReqPlus.git
```

### 2. Load into Browser
1. Open any Chromium-based browser (Chrome, Edge, Brave, etc.).
2. Navigate to `chrome://extensions/` (or `edge://extensions/`).
3. Toggle the **Developer mode** switch in the top right corner.
4. Click the **Load unpacked** button.
5. Select the `Reqplus` folder you just downloaded/cloned.

## 🛠️ How to Use

### Opening the Toolkit
1. Press `F12` or `Right-click > Inspect` to open the browser DevTools.
2. Look for the **ReqPlus** tab in the top navigation bar of the DevTools panel.
3. If it's hidden, click the `>>` icon to find it in the overflow menu.

### Intercepting Requests
1. Navigate to the **Proxy** tab in ReqPlus.
2. Toggle the **Intercept** switch to **ON**.
3. Perform an action in your browser (e.g., submit a form).
4. The request will pause. You can now edit the headers/body in the editor and click **Forward**.

### Using the Repeater
1. Find any request in the **History** or **Proxy** list.
2. Right-click the request and select **Send to Repeater**.
3. Go to the **Repeater** tab to modify and resend the request as many times as needed.

## ⌨️ Keyboard Shortcuts
- `Ctrl + K`: Open Command Palette
- `Ctrl + Enter`: Send Request (Repeater)
- `Ctrl + R`: Refresh History
- `Ctrl + L`: Clear Logs

## ⚖️ License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.