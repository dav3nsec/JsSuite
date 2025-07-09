# JsSuite 🕵️‍♂️📜

**JsSuite** is a real-time JavaScript reverse engineering and debugging suite — think **Burp Suite, but for JavaScript**. It allows security researchers and developers to intercept, inspect, block, and modify JavaScript function calls in a live browser environment, even if the code is minified or obfuscated.

---

## ⚙️ Features

- ✅ Live JavaScript Call Interception (via Playwright + Chrome DevTools Protocol)
- 🔍 Breakpoint Injection based on custom keywords or patterns
- 🧠 Works even on minified or obfuscated code
- 🔁 Toggle interception on/off in real time
- 🧩 Add/Remove intercept keywords live through the UI or console
- 📜 Extracts and logs the enclosing function or stack trace
- 💡 Ideal for bug bounty, malware analysis, client-side security research, and dynamic analysis of JS-heavy applications

---

## 🚀 Installation

**Requirements**
- Node.js >=18
- npm or yarn
- Git

1. Clone the repository

    git clone https://github.com/yourusername/JsSuite.git
    cd JsSuite

2. Install dependencies

    npm install

3. Run JsSuite

    npm start

---

## 🖥️ How It Works

JsSuite launches a headless (or optionally visible) Chromium instance using Playwright, hooks into JavaScript execution via Chrome DevTools Protocol (CDP), and injects a listener that:

- Watches for keywords/patterns you specify (e.g., `eval`, `crypto`, `token`, etc.)
- Intercepts and logs the surrounding function or call site
- Allows you to pause, modify, resume, or block the execution dynamically
- Lets you update intercept rules at runtime

---

## 📟 Live Control Console

JsSuite comes with an interactive CLI console or browser-based UI (depending on your configuration).

You can:

- `add keywordName` → Add a keyword to watch for
- `remove keywordName` → Remove a keyword
- `toggle intercept` → Toggle all interceptions on/off
- `list keywords` → View active intercept patterns
- `clear` → Remove all intercept keywords
- `exit` → Quit JsSuite

---

## ✨ Use Cases

- Client-side JavaScript security testing
- Reverse engineering authentication flows
- Token/intermediate value extraction
- Tracing how obfuscated or minified functions work
- Instrumenting web applications dynamically

---

## 📷 Screenshot

> ![JsSuite Demo Screenshot](./docs/demo.png)

---

## 🛠️ Configuration

You can edit the config file at `config.js` (or `.env`) to customize:

- Default intercept keywords
- Headless vs headed browser
- Target URL(s) to load
- Debug logging options

---

## 📁 Folder Structure

JsSuite/
├── core/                  # Interception logic  
├── ui/                    # Optional web UI interface  
├── scripts/               # CDP & Playwright hooks  
├── config.js              # Default configuration  
├── main.js                # Entrypoint  
├── package.json

---

## 🧩 Roadmap

- [ ] Advanced call stack navigation
- [ ] In-browser keyword manager
- [ ] Regex-based intercepts
- [ ] Response tampering support
- [ ] Support for other browser engines

---

## ❗ Disclaimer

This tool is intended for educational and ethical research purposes only. Always get proper authorization before intercepting or analyzing third-party websites or code.

---

## 🧠 Credits

Built with ❤️ by [Your Name or Team].  
Inspired by the power of Burp Suite and the need for a modern JavaScript debugger for the web.

---

## 📄 License

MIT License. See [LICENSE](./LICENSE) for details.
