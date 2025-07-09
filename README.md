# JsSuite 🕵️‍♂️📜

**JsSuite** is a real-time JavaScript reverse engineering and debugging suite — think **Burp Suite, but for JavaScript**. It allows security researchers and developers to intercept, inspect, block, and modify JavaScript function calls in a live browser environment, even if the code is minified or obfuscated.

---

## ⚙️ Features

- ✅ Live JavaScript Call Interception (via Playwright + Chrome DevTools Protocol)
- 🔍 Breakpoint Injection based on custom keywords or patterns
- 🧠 Works even on minified or obfuscated heavy code (Tested on 45k lines code case)
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

```
git clone https://github.com/dav3nsec/JsSuite.git
cd JsSuite
npm install
npm start
```
---

## 🖥️ How It Works

JsSuite launches a Chromium instance using Playwright, hooks into JavaScript execution via Chrome DevTools Protocol (CDP), and injects a listener that:

- Watches for keywords/patterns you specify (e.g., `eval`, `crypto`, `token`, `rsa`, etc.)
- Intercepts the surrounding function or call site
- Allows you to pause, modify, resume, or block the execution dynamically
- Lets you update intercept rules at runtime

---

## 📟 Live Control Console

JsSuite comes with an interactive browser-based UI.

You can:

- Add a keyword to watch for
- Remove a keyword
- Toggle all interceptions on/off
- View active intercept patterns
- Quit JsSuite

---

## ✨ Use Cases

- Client-side JavaScript security testing
- Reverse engineering authentication flows
- Token/intermediate value extraction
- Tracing how obfuscated or minified functions work
- Instrumenting web applications dynamically

---

## 📷 Usage Video

> ![JsSuite Demo Screenshot](./docs/demo.png)

---

## 📁 Folder Structure

JsSuite/
├── public/index.html      # Web UI Interface 
├── index.js              # Default configuration  
├── package.json

---

## ❗ Disclaimer

This tool is intended for educational and ethical research purposes only. Always get proper authorization before intercepting or analyzing third-party websites or code.

---

## 🧠 Credits

Built with ❤️ by Dav3n.  
Inspired by the power of Burp Suite and the need for a modern JavaScript debugger for the web.

---

## 📄 License

MIT License. See [LICENSE](./LICENSE) for details.
