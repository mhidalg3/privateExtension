/// <reference types="vscode" />

import * as vscode from 'vscode';
import fetch from 'node-fetch';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('inlyne.openPanel', () => {
      InlynePanel.createOrShow(context);
    })
  );
}

class InlynePanel {
  private static currentPanel: InlynePanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly API_BASE_URL = 'http://api.inlyne.link';
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;
    this.updateWebview();
    this.panel.webview.onDidReceiveMessage(this.onMessage.bind(this));
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static createOrShow(context: vscode.ExtensionContext) {
    const column = vscode.ViewColumn.One;

    if (InlynePanel.currentPanel) {
      InlynePanel.currentPanel.panel.reveal(column);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'inlynePanel',
        'Inlyne',
        column,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      InlynePanel.currentPanel = new InlynePanel(panel, context);
    }
  }

  private dispose() {
    InlynePanel.currentPanel = undefined;
    this.panel.dispose();
    this.disposables.forEach(d => d.dispose());
  }

  private async onMessage(message: any) {
    switch (message.type) {
      case 'signup':
        await this.handleSignup(message.username, message.email, message.password);
        break;
      case 'login':
        await this.handleLogin(message.email, message.password);
        break;
      case 'logout':
        this.handleLogout();
        break;
      case 'createDoc':
        await this.createDocument();
        break;
      case 'fetchDoc':
        if (message.key) {
          await this.fetchDocument(message.key);
        }
        break;
    }
  }

  // --- Handlers ------------------------------------------------

  private async handleSignup(username: string, email: string, password: string) {
    try {
      const res = await fetch(`${this.API_BASE_URL}/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'userSignup', username, email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.message || 'Signup failed');

      vscode.window.showInformationMessage('Signup successful! Please log in.');
      this.panel.webview.postMessage({ type: 'signupSuccess' });
    } catch (err: any) {
      vscode.window.showErrorMessage('Signup failed: ' + err.message);
      this.panel.webview.postMessage({ type: 'backendError' });
    }
  }

  private async handleLogin(email: string, password: string) {
    try {
      const res = await fetch(`${this.API_BASE_URL}/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'userLogin', email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.message || 'Login failed');

      await this.context.globalState.update('inlyneToken', data.token);
      await this.context.globalState.update('inlyneUser', data.email);
      this.updateWebview();
      vscode.window.showInformationMessage(`Logged in as ${data.email}`);
    } catch (err: any) {
      vscode.window.showErrorMessage('Login failed: ' + err.message);
      this.panel.webview.postMessage({ type: 'backendError' });
    }
  }

  private handleLogout() {
    this.context.globalState.update('inlyneToken', undefined);
    this.context.globalState.update('inlyneUser', undefined);
    this.updateWebview();
  }

  // --- Doc APIs ------------------------------------------------

  private async createDocument() {
    const token = this.context.globalState.get<string>('inlyneToken');
    if (!token) {
      vscode.window.showErrorMessage('Please log in first.');
      return;
    }
    try {
      const res = await fetch(`${this.API_BASE_URL}/docs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ type: 'create' })
      });
      const data = await res.json();
      this.panel.webview.postMessage({ type: 'docCreated', data });
    } catch (err) {
      console.error(err);
      this.panel.webview.postMessage({ type: 'backendError' });
    }
  }

  private async fetchDocument(key: string) {
    try {
      const res = await fetch(
        `${this.API_BASE_URL}/docs?requestType=getDoc&key=${key}`
      );
      const data = await res.json();
      this.panel.webview.postMessage({ type: 'docFetched', data });
    } catch (err) {
      console.error(err);
      this.panel.webview.postMessage({ type: 'backendError' });
    }
  }

  // --- Render --------------------------------------------------

  private updateWebview() {
    this.panel.webview.html = this.getWebviewContent();
  }

  private getWebviewContent(): string {
    const email = this.context.globalState.get<string>('inlyneUser');
    // Not logged in: show signup/login
    if (!email) {
      return `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="UTF-8"><title>Inlyne Auth</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 2rem; }
          .form-section { border: 1px solid #ccc; padding: 1rem; margin-bottom: 2rem; }
          input { display: block; margin: .5rem 0; padding: .5rem; width: 100%; }
          button { padding: .5rem 1rem; }
        </style>
      </head>
      <body>

        <div class="form-section">
          <h2>Signup</h2>
          <input type="text" id="signupUsername" placeholder="Username">
          <input type="email" id="signupEmail" placeholder="Email">
          <input type="password" id="signupPassword" placeholder="Password">
          <button onclick="signup()">Signup</button>
        </div>

        <div class="form-section">
          <h2>Login</h2>
          <input type="email" id="loginEmail" placeholder="Email">
          <input type="password" id="loginPassword" placeholder="Password">
          <button onclick="login()">Login</button>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          function signup() {
            vscode.postMessage({ type: 'signup',
              username: document.getElementById('signupUsername').value.trim(),
              email: document.getElementById('signupEmail').value.trim(),
              password: document.getElementById('signupPassword').value.trim()
            });
          }
          function login() {
            vscode.postMessage({ type: 'login',
              email: document.getElementById('loginEmail').value.trim(),
              password: document.getElementById('loginPassword').value.trim()
            });
          }
          window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.type === 'signupSuccess') alert('Signup successful! You can now login.');
            if (msg.type === 'backendError') alert('Server error; please try again.');
          });
        </script>
      </body>
      </html>
      `;
    }

    // Logged in: show editor UI
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"><title>Inlyne Editor</title>
      <style>
        body { font-family: sans-serif; padding: 1rem; }
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
        button { padding: .5rem 1rem; }
        #url { font-weight: bold; margin: .5rem 0; }
        textarea { width: 100%; height: 300px; }
        input { width: calc(100% - 110px); padding: .5rem; margin-right: .5rem; }
      </style>
    </head>
    <body>
      <header>
        <div>Logged in as: <strong>${email}</strong></div>
        <button onclick="logout()">Logout</button>
      </header>

      <button id="createBtn">Create New Document</button>
      <input id="docKeyInput" placeholder="Enter docKey to load">
      <button id="loadBtn">Load Document</button>
      <div id="url"></div>
      <textarea id="editor" disabled></textarea>

      <script src="https://cdn.jsdelivr.net/npm/sockjs-client@1.6.1/dist/sockjs.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/@stomp/stompjs@7.1.1/bundles/stomp.umd.min.js"></script>
      <script>
        const vscode = acquireVsCodeApi();
        const createBtn = document.getElementById('createBtn');
        const loadBtn   = document.getElementById('loadBtn');
        const docKeyInput = document.getElementById('docKeyInput');
        const urlDiv    = document.getElementById('url');
        const editor    = document.getElementById('editor');
        let stompClient, docKey;

        createBtn.onclick = () => vscode.postMessage({ type: 'createDoc' });
        loadBtn.onclick   = () => {
          let key = docKeyInput.value.trim();
          if (!key) return;
          if (key.includes('?docKey=')) key = new URLSearchParams(key.split('?')[1]).get('docKey');
          else if (key.startsWith('http')) key = key.split('/').pop();
          vscode.postMessage({ type: 'fetchDoc', key });
        };

        window.addEventListener('message', event => {
          const msg = event.data;
          if (msg.type === 'docCreated') setupEditor(msg.data.url.split('/').pop());
          if (msg.type === 'docFetched') setupEditor(msg.data.linkKey, msg.data.content);
          if (msg.type === 'backendError') alert('Server error; please try again.');
        });

        function setupEditor(key, content = '') {
          docKey = key;
          editor.disabled = false;
          editor.value = content;
          urlDiv.textContent = 'URL: ?docKey=' + key;
          connectWS(key);
        }

        function connectWS(key) {
          if (stompClient) stompClient.deactivate();
          stompClient = new StompJs.Client({
            webSocketFactory: () => new SockJS('${this.API_BASE_URL}/ws'),
            reconnectDelay: 5000
          });
          stompClient.onConnect = () => {
            stompClient.subscribe('/topic/docs/' + key, msg => {
              editor.value = JSON.parse(msg.body).content;
            });
          };
          stompClient.activate();
          editor.oninput = () => {
            if (stompClient.active && docKey)
              stompClient.publish({ destination: '/app/edit/' + docKey,
                body: JSON.stringify({ content: editor.value })
              });
          };
        }

        function logout() {
          vscode.postMessage({ type: 'logout' });
        }
      </script>
    </body>
    </html>
    `;
  }
}