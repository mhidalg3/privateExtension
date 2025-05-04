# InlyneExtension
# Inlyne VS Code Extension

&#x20;

---

## 📑 Table of Contents

* [Prerequisites](#-prerequisites)
* [Installation](#-installation)
* [Usage](#-usage)

  * [Commands](#commands)
  * [Login Workflow](#login-workflow)

---

## 🔧 Prerequisites

* **Node.js** v14+
* **npm**
* **Visual Studio Code**
* **Inlyne backend** running (default: `http://localhost:8080`)

---

## 🚀 Installation

1. **Clone** the repository
2. **Install** dependencies:

   ```bash
   npm install
   ```
3. **Open** in VS Code and press F5 to launch the Extension Development Host or:

    ```bash
    ctrl + shift + d
    Press play button top left. 
    ```
---

## 💡 Usage

### Commands

| Command         | Description                                                        |
| --------------- | ------------------------------------------------------------------ |
| `Inlyne: Login` | Prompt for email & password, call the backend, and store your JWT. |

### Login Workflow

1. Open the **Command Palette** (Ctrl+Shift+P).
2. Run **Inlyne**
3. Make an account.

    1. Will tell if it was successful.
4. Next login.
5. **Email** prompt → enter your email.
6. **Password** prompt → enter your password (masked).
7. On success, JWT is saved under `inlyne.authToken`.

```ts
// Example: using the stored token
const token = await context.globalState.get('inlyne.authToken');
await fetch(`${API_BASE_URL}/protected`, {
  headers: { Authorization: `Bearer ${token}` }
});
```

---
