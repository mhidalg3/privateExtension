// src/extension.ts
import * as vscode from 'vscode';
import fetch from 'node-fetch';
import { InlyneUriHandler } from './uriHandler';
function normalizeKey(input) {
    try {
        const url = new URL(input);
        // strip leading slash(es)
        return url.pathname.replace(/^\/+/, '');
    }
    catch (_a) {
        // not a valid URL, assume it's already the key
        return input;
    }
}
export function activate(context) {
    console.log('Inlyne is active');
    context.subscriptions.push(vscode.window.registerUriHandler(new InlyneUriHandler(context)));
    // Register the "Open Editor" command
    context.subscriptions.push(vscode.commands.registerCommand('inlyne.openEditorTab', async (keyArg) => {
        var _a, _b, _c, _d;
        // allow full URLs or raw keys
        const raw = keyArg || InlyneSidebarProvider.currentDocKey;
        const key = raw ? normalizeKey(raw) : undefined;
        if (!key) {
            return vscode.window.showWarningMessage('No Inlyne DocKey to open');
        }
        const API = 'https://api.inlyne.link';
        const token = context.globalState.get('inlyneToken');
        const userId = context.globalState.get('inlyneUserId'); // you may need to save this on login!
        const headers = {};
        if (token)
            headers['Authorization'] = `Bearer ${token}`;
        let res, json;
        try {
            res = await fetch(`${API}/${key}`, { method: 'GET', headers });
            json = await res.json();
        }
        catch (e) {
            vscode.window.showErrorMessage('Network error');
            return;
        }
        // Unauthorized/private doc: prompt sign-in
        if (!res.ok || (json === null || json === void 0 ? void 0 : json.responseType) === "unauthorized") {
            const go = await vscode.window.showErrorMessage('🔒 This document is private. Please sign in to access it.', 'Sign In');
            if (go === 'Sign In')
                AuthPanel.createOrShow(context);
            return;
        }
        // If doc is private, check permission if user is signed in
        if ((json === null || json === void 0 ? void 0 : json.doc) && !json.doc.isPublic && userId && token) {
            const permRes = await fetch(`${API}/docs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    type: 'getUserPermissionsOnDoc',
                    docId: key,
                    userId
                })
            });
            const permJson = await permRes.json();
            const permission = (_a = permJson === null || permJson === void 0 ? void 0 : permJson.permission) !== null && _a !== void 0 ? _a : 'none';
            if (!['owner', 'admin', 'writer', 'reader'].includes(permission)) {
                vscode.window.showErrorMessage('🚫 You do not have permission to open this private document.');
                return;
            }
        }
        // If passed all checks, load doc content as usual
        const content = (_c = (_b = json.doc) === null || _b === void 0 ? void 0 : _b.content) !== null && _c !== void 0 ? _c : '';
        InlyneSidebarProvider.currentContent = content;
        InlyneSidebarProvider.currentDocKey = key;
        (_d = InlyneSidebarProvider.currentView) === null || _d === void 0 ? void 0 : _d.webview.postMessage({
            type: 'docLoaded',
            key,
            content
        });
        InlyneEditorPanel.createOrShow(context.extensionUri, key, content);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('inlyne.refreshSidebarAuth', () => {
        var _a, _b;
        const token = context.globalState.get('inlyneToken');
        const username = (_a = context.globalState.get('inlyneUsername')) !== null && _a !== void 0 ? _a : 'Unknown User';
        (_b = InlyneSidebarProvider.currentView) === null || _b === void 0 ? void 0 : _b.webview.postMessage({
            type: 'authChanged',
            token,
            username
        });
    }));
    context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ scheme: 'file' }, new InlyneLinkProvider()));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(InlyneSidebarProvider.viewType, new InlyneSidebarProvider(context, context.extensionUri)));
}
export function deactivate() {
    var _a;
    // Dispose of the current panel if it exists
    (_a = InlyneEditorPanel.currentPanel) === null || _a === void 0 ? void 0 : _a.dispose();
    // Close any empty editor groups that might remain, not fully working
    vscode.commands.executeCommand('workbench.action.closeAllEditors').then(() => {
        vscode.commands.executeCommand('workbench.action.closeAllGroups');
    });
}
// ---------- Document Link Provider ----------
export class InlyneLinkProvider {
    constructor() {
        // match DocKey{some_key} anywhere
        this._regex = /DocKey\{([^}]+)\}/g;
    }
    provideDocumentLinks(doc) {
        const text = doc.getText();
        const links = [];
        let m;
        while ((m = this._regex.exec(text))) {
            const start = doc.positionAt(m.index);
            const end = doc.positionAt(m.index + m[0].length);
            const key = m[1];
            // build a command URI: command:inlyne.openEditorTab?["theKey"]
            const args = encodeURIComponent(JSON.stringify([key]));
            const target = vscode.Uri.parse(`command:inlyne.openEditorTab?${args}`);
            links.push(new vscode.DocumentLink(new vscode.Range(start, end), target));
        }
        return links;
    }
}
// ---------- Sidebar Provider ----------
export class InlyneSidebarProvider {
    constructor(context, extensionUri) {
        this.context = context;
        this.extensionUri = extensionUri;
        this.API = 'https://api.inlyne.link';
    }
    async resolveWebviewView(view, _context, _token) {
        var _a;
        InlyneSidebarProvider.currentView = view;
        this._view = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = this.getSidebarHtml(view.webview);
        const token = this.context.globalState.get('inlyneToken');
        const username = (_a = this.context.globalState.get('inlyneUsername')) !== null && _a !== void 0 ? _a : 'Unknown User';
        view.webview.postMessage({
            type: 'authChanged',
            token,
            username
        });
        view.webview.onDidReceiveMessage(async (msg) => {
            var _a, _b;
            switch (msg.type) {
                case 'signIn':
                    AuthPanel.createOrShow(this.context);
                    break;
                case 'signOut':
                    await this.context.globalState.update('inlyneToken', undefined);
                    (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({ type: 'authChanged', token: null });
                    break;
                case 'createDoc': {
                    const token = this.context.globalState.get('inlyneToken');
                    if (!token) {
                        // not authed → send user to sign in
                        return AuthPanel.createOrShow(this.context);
                    }
                    // otherwise do the normal create
                    return this.createDoc();
                }
                case 'loadDoc':
                    // load the document with the given key
                    const key = normalizeKey(msg.key.trim());
                    await this.loadDoc(key);
                    // open popout editor (needed?)
                    await vscode.commands.executeCommand('inlyne.openEditorTab', key);
                    break;
                case 'keyChanged':
                    // update the current key in the sidebar
                    InlyneSidebarProvider.currentDocKey = msg.key;
                    (_b = InlyneEditorPanel.currentPanel) === null || _b === void 0 ? void 0 : _b.postMessage({
                        type: 'externalKeyChanged',
                        key: msg.key
                    });
                    break;
            }
        });
    }
    async createDoc() {
        var _a, _b, _c;
        const token = this.context.globalState.get('inlyneToken');
        if (!token) {
            // tell the UI we’re not logged in
            (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({ type: 'backendError', message: 'Not authenticated' });
            return;
        }
        try {
            const res = await fetch(`${this.API}/docs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ type: 'create' })
            });
            const data = await res.json();
            if (!res.ok)
                throw new Error(data.details || data.message || 'Create failed');
            // data.url e.g. "https://inlyne.link/abcd1234"
            const url = data.url;
            const key = url.split('/').pop();
            InlyneSidebarProvider.currentDocKey = key;
            InlyneSidebarProvider.currentContent = '';
            (_b = this._view) === null || _b === void 0 ? void 0 : _b.webview.postMessage({ type: 'docCreated', key });
        }
        catch (err) {
            console.error(err);
            (_c = this._view) === null || _c === void 0 ? void 0 : _c.webview.postMessage({ type: 'backendError', message: err.message });
        }
    }
    async loadDoc(key) {
        var _a, _b, _c, _d, _e, _f;
        const token = this.context.globalState.get('inlyneToken');
        const userId = this.context.globalState.get('inlyneUserId'); // <- get this!
        const headers = {};
        if (token)
            headers['Authorization'] = `Bearer ${token}`;
        try {
            const res = await fetch(`${this.API}/${key}`, { method: 'GET', headers });
            const data = await res.json();
            // Unauthorized
            if (!res.ok || data.responseType === 'unauthorized') {
                (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({
                    type: 'backendError',
                    message: '🔒 This document is private. Please sign in to access it.'
                });
                return;
            }
            // Check permission if private and signed in
            if ((data === null || data === void 0 ? void 0 : data.doc) && !data.doc.isPublic && userId && token) {
                const permRes = await fetch(`${this.API}/docs`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        type: 'getUserPermissionsOnDoc',
                        docId: key,
                        userId
                    })
                });
                const permJson = await permRes.json();
                const permission = (_b = permJson === null || permJson === void 0 ? void 0 : permJson.permission) !== null && _b !== void 0 ? _b : 'none';
                if (!['owner', 'admin', 'writer', 'reader'].includes(permission)) {
                    (_c = this._view) === null || _c === void 0 ? void 0 : _c.webview.postMessage({
                        type: 'backendError',
                        message: '🚫 You do not have permission to open this private document.'
                    });
                    return;
                }
            }
            // Success: set key/content as before
            const access = data.accessLevel;
            const doc = data.doc;
            InlyneSidebarProvider.currentDocKey = doc.linkKey;
            InlyneSidebarProvider.currentContent = (access === 'public')
                ? ''
                : ((_d = doc.content) !== null && _d !== void 0 ? _d : '');
            (_e = this._view) === null || _e === void 0 ? void 0 : _e.webview.postMessage({
                type: 'docLoaded',
                key: doc.linkKey,
                content: InlyneSidebarProvider.currentContent
            });
        }
        catch (err) {
            console.error(err);
            (_f = this._view) === null || _f === void 0 ? void 0 : _f.webview.postMessage({
                type: 'backendError',
                message: err.message || 'Unknown error'
            });
        }
    }
    getSidebarHtml(webview) {
        const csp = `
      default-src 'none';
      style-src 'unsafe-inline';
      script-src 'unsafe-inline';
    `;
        return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        :root {
          --brand-ivory: #f5efe6;
          --brand-cream: #fcf8f1;
          --brand-olive: #708238;
          --brand-orange: #eb7f00;
          --brand-black: #1f1f1f;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0; padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: var(--brand-ivory);
        }
        .container {
          padding: 12px;
        }
        
        .card {
          background: var(--brand-cream);
          border-radius: 16px;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          width: 100%;
          max-width: 360px;
          max-height: calc(100% - 24px);
          overflow-y: auto;

          /* ← add this */
          box-shadow: 0 -4px 6px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.1);
        }

        .card button {
          width: 100%;
          padding: 10px;
          background: var(--brand-orange);
          color: var(--brand-ivory);
          border: none;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
        }
        .card button:hover {
          opacity: 0.9;
        }
        .form-group {
          display: flex;
          gap: 8px;
        }
        .form-group input {
          flex: 1;
          padding: 8px;
          border: 2px solid var(--brand-olive);
          border-radius: 8px;
          background: var(--brand-ivory);
          color: var(--brand-black);
        }
        .status {
          font-size: 13px;
          color: var(--brand-black);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <!-- Sign In / Out -->
          <button id="btnSignIn" style="display:none">Sign In</button>
          <button id="btnSignOut">Sign Out</button>

          <!-- New Document -->
          <button id="btnNew">New Document</button>

          <!-- Load Existing -->
          <div class="form-group">
            <input id="txtKey" placeholder="Doc Key or URL…" />
          </div>

          <button id="btnLoad">Load</button>

          <!-- Status Lines -->
          <div id="userInfo" class="status">User Status: Not signed in</div>
          <div id="status" class="status">Doc Status: Ready</div>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();

        // Wire up buttons
        document.getElementById('btnSignIn').onclick = () => vscode.postMessage({ type:'signIn' });
        document.getElementById('btnSignOut').onclick = () => vscode.postMessage({ type:'signOut' });
        document.getElementById('btnNew').onclick = () => vscode.postMessage({ type:'createDoc' });
        document.getElementById('btnLoad').onclick = () => {
          const key = document.getElementById('txtKey').value.trim();
          vscode.postMessage({ type:'loadDoc', key });
        };

        // Reflect external key changes
        document.getElementById('txtKey').addEventListener('input', () => {
          vscode.postMessage({ type:'keyChanged', key: document.getElementById('txtKey').value });
        });

        // Handle messages from extension
        window.addEventListener('message', e => {
          const m = e.data;
          if (m.type === 'externalKeyChanged') {
            // when pop-out changes reflect in sidebar
            document.getElementById('txtKey').value = m.key;
          }
          if (m.type === 'authChanged') {
            const signedIn = Boolean(m.token);
            document.getElementById('btnSignIn').style.display  = signedIn ? 'none' : 'block';
            document.getElementById('btnSignOut').style.display = signedIn ? 'block' : 'none';
            document.getElementById('userInfo').textContent =
              signedIn
                ? 'User Status: Signed in as: ' + (m.username || 'Unknown User')
                : 'User Status: Not signed in';
          }
          if (m.type === 'docCreated') {
            document.getElementById('status').textContent = 'Doc Status: Created ' + m.key;
            document.getElementById('txtKey').value = m.key;
          } else if (m.type === 'docLoaded') {
            document.getElementById('status').textContent = 'Doc Status: Loaded ' + m.key;
            document.getElementById('txtKey').value = m.key;
          } else if (m.type === 'backendError') {
            document.getElementById('status').textContent = 'Error: ' + m.message;
          }
        });
      </script>
    </body>
    </html>
    `;
    }
}
InlyneSidebarProvider.viewType = 'inlyne.sidebarView';
InlyneSidebarProvider.currentDocKey = null;
InlyneSidebarProvider.currentContent = '';
// ---------- Pop-out Editor Panel ----------
class InlyneEditorPanel {
    postMessage(message) {
        this._panel.webview.postMessage(message);
    }
    update(key, content) {
        this._docKey = key;
        this._panel.webview.postMessage({
            type: 'editorDocLoaded',
            key,
            content
        });
    }
    static createOrShow(extensionUri, key, initialContent) {
        if (!key) {
            vscode.window.showWarningMessage('No document loaded');
            return;
        }
        const column = vscode.ViewColumn.Beside;
        if (InlyneEditorPanel.currentPanel) {
            // InlyneEditorPanel.currentPanel._panel.reveal(column);
            // reveal and refresh with the new key+content
            InlyneEditorPanel.currentPanel._panel.reveal(column);
            InlyneEditorPanel.currentPanel.update(key, initialContent !== null && initialContent !== void 0 ? initialContent : '');
            return;
        }
        else {
            const panel = vscode.window.createWebviewPanel('inlyneEditor', `Inlyne: ${key}`, { viewColumn: column, preserveFocus: false }, { enableScripts: true });
            InlyneEditorPanel.currentPanel = new InlyneEditorPanel(panel, extensionUri, key, initialContent);
        }
    }
    constructor(_panel, _extensionUri, _docKey, _initialContent) {
        this._panel = _panel;
        this._extensionUri = _extensionUri;
        this._docKey = _docKey;
        this._initialContent = _initialContent;
        this.API = 'https://api.inlyne.link';
        this._panel.webview.html = this._getHtml(this._panel.webview, this._docKey, this._initialContent);
        this._panel.webview.onDidReceiveMessage(async (msg) => {
            var _a, _b, _c, _d, _e, _f, _g;
            if (msg.type === 'loadEditorDoc' && msg.key) {
                const raw = msg.key.trim();
                const key = normalizeKey(raw);
                try {
                    // fetch via your server API
                    const res = await fetch(`${this.API}/${key}`);
                    const data = await res.json();
                    const newKey = ((_a = data.doc) === null || _a === void 0 ? void 0 : _a.linkKey) || key;
                    const content = (_c = (_b = data.doc) === null || _b === void 0 ? void 0 : _b.content) !== null && _c !== void 0 ? _c : '';
                    // send the loaded content back into the same webview
                    this._panel.webview.postMessage({
                        type: 'editorDocLoaded',
                        key: newKey,
                        content,
                        accessLevel: data.accessLevel || (((_d = data.doc) === null || _d === void 0 ? void 0 : _d.isPublic) ? 'public' : 'private')
                    });
                    InlyneSidebarProvider.currentDocKey = newKey;
                    InlyneSidebarProvider.currentContent = content;
                    (_e = InlyneSidebarProvider.currentView) === null || _e === void 0 ? void 0 : _e.webview.postMessage({
                        type: 'docLoaded',
                        key,
                        content,
                        accessLevel: data.accessLevel || (((_f = data.doc) === null || _f === void 0 ? void 0 : _f.isPublic) ? 'public' : 'private')
                    });
                }
                catch (err) {
                    console.error('Error loading in popout:', err);
                    this._panel.webview.postMessage({
                        type: 'editorDocError',
                        message: String(err)
                    });
                }
            }
            if (msg.type === 'keyChanged') {
                this._docKey = msg.key;
                (_g = InlyneSidebarProvider.currentView) === null || _g === void 0 ? void 0 : _g.webview.postMessage({
                    type: "externalKeyChanged",
                    key: msg.key
                });
            }
        });
        this._panel.onDidDispose(() => this.dispose());
    }
    dispose() {
        InlyneEditorPanel.currentPanel = undefined;
        this._panel.dispose();
        // Actively close any editor groups that might remain
        vscode.commands.executeCommand('workbench.action.closeEditorsInGroup');
    }
    _getHtml(webview, key, initialContent) {
        const csp = `
      default-src 'none';
      connect-src https://api.inlyne.link wss://api.inlyne.link https://cdn.jsdelivr.net https://esm.sh;
      style-src 'unsafe-inline';
      script-src 'unsafe-inline' https://cdn.jsdelivr.net https://esm.sh;
    `;
        return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"/>
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <style>
        :root {
          --brand-ivory: #f5efe6;
          --brand-cream: #fcf8f1;
          --brand-olive: #708238;
          --brand-orange: #eb7f00;
          --brand-black: #1f1f1f;
        }
        * { box-sizing: border-box; margin:0; padding:0; }
        body {
          background: var(--brand-ivory);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          height: 100vh; display: flex;
        }
        .container {
          flex: 1; padding: 16px; display: flex; flex-direction: column;
        }
        .card {
          background: var(--brand-cream);
          border-radius: 16px;
          box-shadow: 0 -4px 6px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.1);
          flex: 1; display: flex; flex-direction: column; gap: 12px; overflow: hidden;
        }
        #toolbar {
          display: flex; align-items: center; gap: 8px; padding: 12px;
        }
        .btn {
          background: var(--brand-orange);
          color: var(--brand-ivory);
          border: none; border-radius: 8px;
          padding: 8px 12px; cursor: pointer; font-size: 14px;
        }
        .btn:hover { opacity: 0.9; }
        .load-input {
          flex: 1; padding: 8px 12px;
          border: 2px solid var(--brand-olive);
          border-radius: 8px;
          background: var(--brand-ivory);
          color: black;
          font-size: 14px;
        }
        #menubar {
          display: flex; gap: 4px; padding: 0 12px 12px;
          border-bottom: 1px solid #ddd;
        }
        #menubar button {
          background: var(--brand-ivory);
          border: 1px solid #ccc; border-radius: 4px; padding: 6px;
          cursor: pointer;
        }
        #menubar button:hover {
          background: var(--brand-orange);
          color: var(--brand-ivory);
        }
        #status {
          padding: 0 12px; font-size: 13px; color: var(--brand-black);
        }
        #editor {
          flex: 1; margin: 0 12px 12px; padding: 12px;
          border: 1px solid #ccc; border-radius: 8px;
          overflow: auto; background: white;
          color: var(--brand-black);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <div id="toolbar">
            <button id="btnNew" class="btn">New</button>
            <input id="txtKey" class="load-input" placeholder="docKey…" value="${key}"/>
            <button id="btnLoad" class="btn">Load</button>
          </div>
          <div id="menubar">
            <button data-action="bold"><b>B</b></button>
            <button data-action="italic"><i>I</i></button>
            <button data-action="heading">H1</button>
            <button data-action="align-left">L</button>
            <button data-action="align-center">C</button>
            <button data-action="align-right">R</button>
            <button data-action="highlight">🔆</button>
            <button data-action="image">🖼️</button>
          </div>
          <div id="status">Editor for ${key}</div>
          <div id="editor"></div>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/sockjs-client@1.6.1/dist/sockjs.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/@stomp/stompjs@7.1.1/bundles/stomp.umd.min.js"></script>
      <script type="module">
        import { Editor } from 'https://esm.sh/@tiptap/core@2';
        import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2';
        import TextAlign from 'https://esm.sh/@tiptap/extension-text-align@2';
        import Highlight from 'https://esm.sh/@tiptap/extension-highlight@2';
        import Image from 'https://esm.sh/@tiptap/extension-image@2';
        import Placeholder from 'https://esm.sh/@tiptap/extension-placeholder@2';

        const vscode = acquireVsCodeApi();
        let docKey = '${key}';
        let stompClient;
        let suppress = false;
        let currentAccessType = '';

        function setStatus(main, access) {
          document.getElementById('status').textContent = main + (access ? ' ' + access : '');
        }

        // Sync key changes
        document.getElementById('txtKey').addEventListener('input', () =>
          vscode.postMessage({ type: 'keyChanged', key: document.getElementById('txtKey').value })
        );
        window.addEventListener('message', e => {
          if (e.data.type === 'externalKeyChanged')
            document.getElementById('txtKey').value = e.data.key;
        });

        // Initialize TipTap editor
        const editor = new Editor({
          element: document.getElementById('editor'),
          editable: true,
          extensions: [
            StarterKit,
            TextAlign.configure({ types: ['heading', 'paragraph'] }),
            Highlight,
            Image,
            Placeholder.configure({ placeholder: 'Type your docs here…' }),
          ],
          content: ${initialContent ? JSON.stringify(initialContent) : "'<p>Edit Here!</p>'"},
          autofocus: true,
          onUpdate: ({ editor }) => {
            if (suppress) return;
            const html = editor.getHTML();
            vscode.postMessage({ type: 'contentUpdate', html });
            if (stompClient?.active) {
              stompClient.publish({
                destination: '/app/edit/' + docKey,
                body: JSON.stringify({ content: html })
              });
            }
          }
        });
        setTimeout(() => { editor.setEditable(true); editor.commands.focus(); }, 100);

        function connect(key) {
          if (stompClient) stompClient.deactivate();
          stompClient = new StompJs.Client({ webSocketFactory: () => new SockJS('https://api.inlyne.link/ws') });
          stompClient.onConnect = () => {
            setStatus('🟢 Connected to ' + docKey, currentAccessType);
            stompClient.subscribe('/topic/docs/' + docKey, msg => {
              const { content } = JSON.parse(msg.body);
              if (editor.getHTML() !== content) {
                suppress = true;
                editor.commands.setContent(content || '<p></p>', false);
                suppress = false;
              }
            });
          };
          stompClient.onStompError = frame =>
            setStatus('🔴 Connection error', '');
          stompClient.activate();
        }


        // Wire up toolbar/load/new
        document.getElementById('btnNew').onclick  = () => vscode.postMessage({ type: 'createDoc' });
        document.getElementById('btnLoad').onclick = () => vscode.postMessage({ type: 'loadEditorDoc', key: document.getElementById('txtKey').value.trim() });
        document.querySelectorAll('#menubar button').forEach(btn => {
          btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-action');
            switch (action) {
              case 'bold': editor.chain().focus().toggleBold().run(); break;
              case 'italic': editor.chain().focus().toggleItalic().run(); break;
              case 'heading': editor.chain().focus().toggleHeading({ level: 1 }).run(); break;
              case 'align-left': editor.chain().focus().setTextAlign('left').run(); break;
              case 'align-center': editor.chain().focus().setTextAlign('center').run(); break;
              case 'align-right': editor.chain().focus().setTextAlign('right').run(); break;
              case 'highlight': editor.chain().focus().toggleHighlight().run(); break;
              case 'image': {
                const url = prompt('Image URL');
                if (url) editor.chain().focus().setImage({ src: url }).run();
              }
            }
          });
        });

        // Handle incoming messages
        window.addEventListener('message', e => {
          const m = e.data;
          if (m.type === 'editorDocLoaded') {
            docKey = m.key;
            editor.commands.setContent(m.content || '<p></p>', false);
            connect(m.key);
            let accessString = '';
            if (m.accessLevel === 'public') accessString = '🌐 Public';
            else if (m.accessLevel === 'private') accessString = '🔒 Private';
            setStatus('Loaded ' + m.key, accessString);
            currentAccessType = accessString;
          }
          if (m.type === 'editorDocError') {
            document.getElementById('status').textContent = 'Error: ' + m.message;
          }
        });

        // Kick it off!
        connect(docKey);
      </script>
    </body>
    </html>`;
    }
}
class AuthPanel {
    constructor(panel, context) {
        this._panel = panel;
        this._context = context;
        panel.webview.options = { enableScripts: true };
        panel.webview.html = AuthPanel.getHtml(panel.webview);
        panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === 'authenticate') {
                try {
                    const res = await fetch('https://api.inlyne.link/user', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 'userLogin',
                            email: msg.email,
                            password: msg.password
                        })
                    });
                    const data = await res.json();
                    if (!res.ok)
                        throw new Error(data.message || JSON.stringify(data));
                    // save token
                    await context.globalState.update('inlyneToken', data.token);
                    await context.globalState.update('inlyneUsername', data.email);
                    await context.globalState.update('inlyneUserId', data.userId);
                    // notify sidebar
                    vscode.window.showInformationMessage('Signed in successfully');
                    vscode.commands.executeCommand('inlyne.refreshSidebarAuth');
                    this._panel.dispose();
                }
                catch (err) {
                    this._panel.webview.postMessage({ type: 'authError', message: err.message });
                }
            }
        });
        panel.onDidDispose(() => AuthPanel.currentPanel = undefined);
    }
    static createOrShow(context) {
        if (AuthPanel.currentPanel) {
            AuthPanel.currentPanel._panel.reveal();
        }
        else {
            const panel = vscode.window.createWebviewPanel('inlyneAuth', 'Sign in to Inlyne', vscode.ViewColumn.Active, { retainContextWhenHidden: false, enableScripts: true });
            AuthPanel.currentPanel = new AuthPanel(panel, context);
        }
    }
    static getHtml(webview) {
        const csp = `
      default-src 'none';
      style-src 'unsafe-inline';
      script-src 'unsafe-inline';
    `;
        return /* html */ `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        :root {
          --brand-ivory: #f5efe6;
          --brand-cream: #fcf8f1;
          --brand-olive: #708238;
          --brand-orange: #eb7f00;
          --brand-black: #1f1f1f;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0; padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: var(--brand-ivory);
        }
        .container {
          min-height: 100vh;
          display: flex; justify-content: center; align-items: center;
          padding: 16px;
        }
        .card {
          width: 100%; max-width: 400px;
          background: var(--brand-cream);
          border-radius: 16px; padding: 32px;
          box-shadow: 0 -4px 6px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.1);
        }
        h2 {
          margin: 0 0 24px;
          text-align: center;
          color: var(--brand-black);
        }
        .form-group { margin-bottom: 16px; }
        label {
          display: block; margin-bottom: 4px;
          font-size: 14px; font-weight: 500;
          color: var(--brand-black);
        }
        input {
          width: 100%; padding: 8px 12px;
          font-size: 14px;
          background: var(--brand-ivory);
          color: var(--brand-black);
          border: 2px solid var(--brand-olive);
          border-radius: 8px;
        }
        input:focus {
          outline: none;
          box-shadow: 0 0 0 2px rgba(235,127,0,0.3);
        }
        /* need a proseMirror? */

        button {
          width: 100%; padding: 12px;
          background: var(--brand-orange);
          color: var(--brand-ivory);
          font-size: 16px;
          border: none; border-radius: 8px;
          cursor: pointer;
        }
        button:hover { opacity: 0.9; }
        
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <h2>Sign in to Inlyne</h2>
          <form id="login">
            <div class="form-group">
              <label for="email">Email</label>
              <input id="email" type="email" placeholder="you@example.com" required />
            </div>
            <div class="form-group">
              <label for="pwd">Password</label>
              <input id="pwd" type="password" placeholder="••••••••••••" required />
            </div>
            <button type="submit">Login</button>
          </form>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();

        // Handle form submission
        document.getElementById('login').addEventListener('submit', e => {
          e.preventDefault();
          vscode.postMessage({
            type: 'authenticate',
            email: document.getElementById('email').value,
            password: document.getElementById('pwd').value
          });
        });

        // Display auth errors
        window.addEventListener('message', e => {
          if (e.data.type === 'authError') {
            alert(e.data.message);
          }
        });
      </script>
    </body>
    </html>
    `;
    }
}
