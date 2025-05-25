// src/extension.ts
import * as vscode from 'vscode';
import fetch from 'node-fetch';
import { InlyneUriHandler } from './uriHandler';

function normalizeKey(input: string): string {
  try {
    const url = new URL(input);
    // strip leading slash(es)
    return url.pathname.replace(/^\/+/, '');
  } catch {
    // not a valid URL, assume it's already the key
    return input;
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Inlyne is active');

  context.subscriptions.push(
    vscode.window.registerUriHandler(new InlyneUriHandler(context))
  );

  // Register the "Open Editor" command
  context.subscriptions.push(
    vscode.commands.registerCommand('inlyne.openEditorTab', async (keyArg?: string) => {
      // allow full URLs or raw keys
      const raw = keyArg || InlyneSidebarProvider.currentDocKey;
      const key = raw ? normalizeKey(raw) : undefined;
      if (!key) {
        return vscode.window.showWarningMessage('No Inlyne DocKey to open');
      }
  
      // fetch the latest content for that key
      let content = InlyneSidebarProvider.currentContent;
      try {
        const API = 'https://api.inlyne.link';
        const token = context.globalState.get<string>('inlyneToken');
        const headers: Record<string,string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(
          // GET public or auth’d fetch:
          `${API}/${key}`,
          { method: 'GET', headers }
        );

        const json = await res.json();
        // fetch either public (no content) or authed (json.doc.content)
        content = json.doc?.content ?? '';
        if (!res.ok) {
          vscode.window.showErrorMessage(`Failed to load doc (${res.status})`);
          return;
        }
        InlyneSidebarProvider.currentContent = content;
        InlyneSidebarProvider.currentDocKey = key;

        InlyneSidebarProvider.currentView?.webview.postMessage({
          type:    'docLoaded',
          key,
          content
        });
      } catch (e) {
        console.error('Could not fetch Inlyne document:', e);
      }
      
      InlyneEditorPanel.createOrShow(context.extensionUri, key, content);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('inlyne.refreshSidebarAuth', () => {
      const token = context.globalState.get<string>('inlyneToken');
      InlyneSidebarProvider.currentView?.webview.postMessage({
        type: 'authChanged',
        token
      });
    })
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      { scheme: 'file' },
      new InlyneLinkProvider()
    )
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      InlyneSidebarProvider.viewType,
      new InlyneSidebarProvider(context, context.extensionUri)
    )
  );
}

export function deactivate() {
  // Dispose of the current panel if it exists
  InlyneEditorPanel.currentPanel?.dispose();
  
  // Close any empty editor groups that might remain, not fully working
  vscode.commands.executeCommand('workbench.action.closeAllEditors').then(() => {
    vscode.commands.executeCommand('workbench.action.closeAllGroups');
  });
}

// ---------- Document Link Provider ----------
export class InlyneLinkProvider implements vscode.DocumentLinkProvider {
  // match DocKey{some_key} anywhere
  private _regex = /DocKey\{([^}]+)\}/g;

  public provideDocumentLinks(
    doc: vscode.TextDocument
  ): vscode.ProviderResult<vscode.DocumentLink[]> {
    const text = doc.getText();
    const links: vscode.DocumentLink[] = [];
    let m: RegExpExecArray | null;

    while ((m = this._regex.exec(text))) {
      const start = doc.positionAt(m.index);
      const end   = doc.positionAt(m.index + m[0].length);
      const key   = m[1];

      // build a command URI: command:inlyne.openEditorTab?["theKey"]
      const args = encodeURIComponent(JSON.stringify([key]));
      const target = vscode.Uri.parse(`command:inlyne.openEditorTab?${args}`);

      links.push(
        new vscode.DocumentLink(new vscode.Range(start, end), target)
      );
    }
    return links;
  }
}

// ---------- Sidebar Provider ----------
export class InlyneSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'inlyne.sidebarView';
  public static currentDocKey: string | null = null;
  public static currentContent: string = '';
  public static currentView?: vscode.WebviewView;


  
  private _view?: vscode.WebviewView;
  private readonly API = 'https://api.inlyne.link';


  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly extensionUri: vscode.Uri
  ) {}

  resolveWebviewView(
    view: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    InlyneSidebarProvider.currentView = view;
    this._view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.getSidebarHtml(view.webview);

    const token = this.context.globalState.get<string>('inlyneToken');
    view.webview.postMessage({ type: 'authChanged', token });

    view.webview.onDidReceiveMessage(async msg => {
      switch (msg.type) {
        case 'signIn':
          AuthPanel.createOrShow(this.context);
          break;
        case 'signOut':
          await this.context.globalState.update('inlyneToken', undefined);
          this._view?.webview.postMessage({ type: 'authChanged', token: null });
          break;
        case 'createDoc': {
          const token = this.context.globalState.get<string>('inlyneToken');
          if (!token) {
            // not authed → send user to sign in
            return AuthPanel.createOrShow(this.context);
          }
          // otherwise do the normal create
          return this.createDoc();
        }
        case 'loadDoc':
          // accept either a URL or a bare key
          const key = normalizeKey(msg.key.trim());
          await this.loadDoc(key);
          // open popout editor (needed?)
          await vscode.commands.executeCommand('inlyne.openEditorTab', key);
          break;
        case 'keyChanged':
          // update the current key in the sidebar
          InlyneSidebarProvider.currentDocKey = msg.key;
          InlyneEditorPanel.currentPanel?.postMessage({
            type: 'externalKeyChanged',
            key: msg.key
          });
          break;
      }
    });
  }

  private async createDoc() {
    const token = this.context.globalState.get<string>('inlyneToken');
    if (!token) {
      // tell the UI we’re not logged in
      this._view?.webview.postMessage({ type: 'backendError', message: 'Not authenticated' });
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
      if (!res.ok) throw new Error(data.details || data.message || 'Create failed');

      // data.url e.g. "https://inlyne.link/abcd1234"
      const url = data.url as string;
      const key = url.split('/').pop()!;

      InlyneSidebarProvider.currentDocKey     = key;
      InlyneSidebarProvider.currentContent    = '';
      this._view?.webview.postMessage({ type: 'docCreated', key });
    } catch (err: any) {
      console.error(err);
      this._view?.webview.postMessage({ type: 'backendError', message: err.message });
    }
  }

  private async loadDoc(key: string) {
    const token = this.context.globalState.get<string>('inlyneToken');
    const headers: Record<string,string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(`${this.API}/${key}`, { method: 'GET', headers });
      const data = await res.json();

      // 1) if the server says “unauthorized”:
      if (!res.ok) {
        if (data.responseType === 'unauthorized') {
          this._view?.webview.postMessage({
            type: 'backendError',
            message: '🔒 This document is private. Please sign in to access it.'
          });
        } else {
          this._view?.webview.postMessage({
            type: 'backendError',
            message: data.details ?? data.message ?? `Load failed (${res.status})`
          });
        }
        return;
      }

      // 2) on success we have an `accessLevel` field
      const access = data.accessLevel as 'public'|'reader'|'writer';
      const doc    = data.doc as { linkKey: string; content?: string; isPublic: boolean };

      // save what key we _actually_ opened
      InlyneSidebarProvider.currentDocKey  = doc.linkKey;
      InlyneSidebarProvider.currentContent = (access === 'public')
        ? ''            // public docs only return linkKey
        : (doc.content ?? '');

      // tell the webview “we loaded”
      this._view?.webview.postMessage({
        type:    'docLoaded',
        key:     doc.linkKey,
        content: InlyneSidebarProvider.currentContent
      });

    } catch (err: any) {
      console.error(err);
      this._view?.webview.postMessage({
        type: 'backendError',
        message: err.message || 'Unknown error'
      });
    }
  }

  private getSidebarHtml(webview: vscode.Webview): string {
    const csp = `
      default-src 'none';
      connect-src https://api.inlyne.link wss://api.inlyne.link;
      style-src 'unsafe-inline' https:;
      script-src 'unsafe-inline' https:;
    `;

    return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      html, body {
        height: 100vh;
        margin: 0;
        padding: 0;
      }
      body {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 0.9rem;
        color: #333;
        display: flex;
        flex-direction: column;
      }
      #toolbar {
        flex: 0 0 auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px;
        background: #fafbfc;
        border-bottom: 1px solid #e1e4e8;
      }

      .btn {
        width: 100%;
        padding: 6px 0;
        align-items: center;
        border: none;
        border-radius: 4px;
        background: #fff;
        color: #24292e;
        font-size: 0.9rem;
        cursor: pointer;
        transition: background 0.2s;
      }
      .btn:hover { background:rgb(236,109,38); }

      .load-container { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; align-items: center; }
      .load-input {
        flex: 1;
        padding: 6px 8px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 0.9rem;
      }
      .load-input:focus {
        outline: none;
        border-color: rgb(236,109,38);
        box-shadow: 0 0 0 2px rgba(184, 87, 31, 0.84);
      }

      #userInfo {
        flex: 0 0 auto;
        display: flex;
        flex-direction: column;
        padding: 6px 8px;
        font-size: 0.8rem;
        color: #586069;
        background: #f3f3f3;
      }

      #status {
        flex: 1 1 auto;
        min-height: 0px;
        color: #586069;
        background: #f3f3f3;
        padding: 4px 8px;
        font-size: 0.85em;
        overflow: auto;
      }
      
    </style>
  </head>
  <body>
    <div id="toolbar">
      <button id="btnSignIn"  class="btn">Sign In</button>
      <button id="btnSignOut" class="btn" style="display:none">Sign Out</button>
      <button id="btnNew"     class="btn">New</button>
      <div class="load-container">
        <input  id="txtKey"  class="load-input" placeholder="Document Key…">
        <button id="btnLoad" class="btn" style="width:auto; padding:6px 12px;">Load</button>
      </div>
    </div>
    <div id="userInfo">User Status: Not signed in</div>
    <div id="status">Doc Status: Ready</div>

    <script>
      const vscode = acquireVsCodeApi();
      const docKey = document.getElementById('txtKey');
      
      // user types key notift the extension
      txtKey.addEventListener('input', () => {
        vscode.postMessage({
          type: 'keyChanged',
          key: txtKey.value
        });
      });
      // reflect chhanges from popout textbox
      window.addEventListener('message', e => {
        const m = e.data;
        if (m.type === 'externalKeyChanged') {
          docKey.value = m.key;
        }
      });

      // Handle the "Sign In" and "Sign Out" buttons
      document.getElementById('btnSignIn').onclick  = () => vscode.postMessage({ type:'signIn' });
      document.getElementById('btnSignOut').onclick = () => vscode.postMessage({ type:'signOut' });
      
      document.getElementById('btnNew').onclick     = () => vscode.postMessage({ type:'createDoc' });
      document.getElementById('btnLoad').onclick    = () => {
        const key = document.getElementById('txtKey').value.trim();
        vscode.postMessage({ type:'loadDoc', key });
      };


      window.addEventListener('message', e => {
        const m = e.data;
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
        } else if (m.type === 'docLoaded') {
          document.getElementById('status').textContent = 'Doc Status: Loaded ' + m.key;
        } else if (m.type === 'backendError') {
          document.getElementById('status').textContent = 'Dos Status Error: ' + m.message;
        }
      });
    </script>
  </body>
  </html>`;
  }
}


// ---------- Pop-out Editor Panel ----------
class InlyneEditorPanel {
  public static currentPanel: InlyneEditorPanel | undefined;
  private readonly API = 'https://api.inlyne.link';

  public postMessage(message: any) {
    this._panel.webview.postMessage(message);
  }

  public update(key: string, content: string) {
    this._docKey = key;
    this._panel.webview.postMessage({
      type: 'editorDocLoaded',
      key,
      content
    });
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    key: string | null,
    initialContent?: string
  ) {
    if (!key) {
      vscode.window.showWarningMessage('No document loaded');
      return;
    }

    const column = vscode.ViewColumn.Beside;
    if (InlyneEditorPanel.currentPanel) {
     // InlyneEditorPanel.currentPanel._panel.reveal(column);
     // reveal and refresh with the new key+content
      InlyneEditorPanel.currentPanel._panel.reveal(column);
      InlyneEditorPanel.currentPanel.update(key, initialContent ?? '');
       return;
    } 
    else {
      const panel = vscode.window.createWebviewPanel(
        'inlyneEditor',
        `Inlyne: ${key}`,
        { viewColumn: column, preserveFocus: false },
        { enableScripts: true }
      );
      InlyneEditorPanel.currentPanel = new InlyneEditorPanel(
        panel,
        extensionUri,
        key,
        initialContent
      );
    }
  }

  private constructor(
    private readonly _panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri,
    private _docKey: string,
    private readonly _initialContent?: string
  ) {
    this._panel.webview.html = this._getHtml(
      this._panel.webview,
      this._docKey,
      this._initialContent
    );
    this._panel.webview.onDidReceiveMessage(async msg => {
      if (msg.type === 'loadEditorDoc' && msg.key) {
        const raw = msg.key.trim();
        const key = normalizeKey(raw);
        try {
          // fetch via your server API
          const res = await fetch(`${this.API}/${key}`);
          const data = await res.json();
          const newKey = data.doc?.linkKey || key;
          const content = data.doc?.content ?? '';
          // send the loaded content back into the same webview
          this._panel.webview.postMessage({
            type: 'editorDocLoaded',
            key: newKey,
            content
          });
          InlyneSidebarProvider.currentDocKey  = newKey;
          InlyneSidebarProvider.currentContent = content;
          InlyneSidebarProvider.currentView?.webview.postMessage({
            type:    'docLoaded',
            key:     newKey,
            content
          });
        } catch (err) {
          console.error('Error loading in popout:', err);
          this._panel.webview.postMessage({
            type: 'editorDocError',
            message: String(err)
          });
        }
      }
      if (msg.type === 'keyChanged') {
        this._docKey = msg.key;
        InlyneSidebarProvider.currentView?.webview.postMessage({
          type: "externalKeyChanged",
          key: msg.key
        });
      }
    });
    this._panel.onDidDispose(() => this.dispose());
  }

  public dispose() {
    InlyneEditorPanel.currentPanel = undefined;
    this._panel.dispose();
    
    // Actively close any editor groups that might remain
    vscode.commands.executeCommand('workbench.action.closeEditorsInGroup');
  }

  private _getHtml(webview: vscode.Webview, key: string, initialContent?: string): string {
    // reuse full sidebar HTML inside editor window
    const csp = `
      default-src 'none';
      connect-src https://api.inlyne.link wss://api.inlyne.link;
      style-src 'unsafe-inline' https:;
      script-src 'unsafe-inline' https:;
    `;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: sans-serif; }

  /* Toolbar */ 
  #toolbar { display: flex; align-items: center; gap: 8px; padding: 8px; background: #f3f3f3; border-bottom: 1px solid #ddd; }
  .btn { background: white; border: 1px solid #ccc; padding: 0.5rem 0.75rem; font-size: 0.9rem; cursor: pointer; transition: background 0.3s; }
  .btn:hover { background: orange; color: white; }
  .load-input { flex: 1; padding: 0.5rem 0.75rem; border: 1px solid #ccc; font-size: 0.9rem; transition: border-color 0.2s, box-shadow 0.2s; }
  .load-input:focus { outline: none; border-color: orange; box-shadow: 0 0 0 2px rgba(255,165,0,0.3); }

  /* Menubar (new) */
  #menubar { padding: 4px 8px; background: #fafafa; border-bottom: 1px solid #ddd; display: flex; gap: 4px; }
  #menubar button { background: white; border: 1px solid #ccc; padding: 0.4rem; cursor: pointer; transition: background 0.3s; }
  #menubar button:hover { background: orange; color: white; }

  .ProseMirror {
    white-space: pre-wrap; 
    flex: 1;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    outline: none;
  }
  /* Editor area */
  #status { padding: 4px 8px; font-size: 0.85em; color: #666; }
  #editor { 
    margin: 0 8px; 
    padding: 8px; 
    min-height: calc(100vh - 160px); 
    border: 1px solid #ccc; 
    display: flex; 
    flex-direction: column;
    position: relative;
  }
  #editor:focus-within { border-color: orange; box-shadow: 0 0 0 2px rgba(255,165,0,0.3); }
  

  /* Responsive */
  @media (max-width: 320px) {
    #toolbar, #menubar { flex-direction: column; align-items: stretch; }
    .btn, .load-input { width: 100%; margin: 0; }
  }
</style>
</head>
<body>
  <div id="toolbar">
    <button id="btnNew" class="btn btn-large">New</button>
    <input id="txtKey" class="load-input" placeholder="docKey…" value="${key}">
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

    // new stuff
    txtKey.addEventListener('input', () => {
      vscode.postMessage({ type: 'keyChanged', key: txtKey.value });
    });

    window.addEventListener('message', e => {
      const m = e.data;
      if (m.type === 'externalKeyChanged') {
        txtKey.value = m.key;
      }
    });

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

    // Ensure editor is focusable and editable
    setTimeout(() => {
      editor.setEditable(true);
      editor.commands.focus();
    }, 100);

    function connect(key) {
      if (stompClient) stompClient.deactivate();
      stompClient = new StompJs.Client({ webSocketFactory: () => new SockJS('https://api.inlyne.link/ws') });
      stompClient.onConnect = () => {
        document.getElementById('status').textContent = '🟢 Connected to ' + key;
        
        stompClient.subscribe('/topic/docs/' + key, msg => {
          const { content } = JSON.parse(msg.body);
          if (editor.getHTML() !== content) {
            suppress = true;
            editor.commands.setContent(content || '<p></p>', false);
            suppress = false;
          }
        });
      };
      
      stompClient.onStompError = frame => {
        console.error('STOMP error', frame.headers['message']);
        document.getElementById('status').textContent = '🔴 Connection error';
      };
      
      stompClient.activate();
    }

    // Toolbar actions
    document.getElementById('btnNew').onclick = () => {
      vscode.postMessage({ type: 'createDoc' });
    };

    document.getElementById('btnLoad').onclick = async () => {
      const key = document.getElementById('txtKey').value.trim();
      if (!key) return;
      // tell the extension “please load this key”
      vscode.postMessage({ type: 'loadEditorDoc', key });
    };

    // Menubar actions
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
            break;
          }
        }
      });
    });

  window.addEventListener('message', e => {
      const m = e.data;
      if (m.type === 'editorDocLoaded') {
        // overwrite TipTap content and reconnect
        docKey = m.key;
        editor.commands.setContent(m.content || '<p></p>', false);
        connect(m.key);
        document.getElementById('status').textContent = 'Loaded ' + m.key;
      }
      if (m.type === 'editorDocError') {
        document.getElementById('status').textContent = 'Error: ' + m.message;
      }
    });

    // Initial sync
    connect(docKey);
</script>
</body>
</html>`;
  }
}

class AuthPanel {
  public static currentPanel: AuthPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this._panel = panel;
    this._context = context;
    panel.webview.options = { enableScripts: true };
    panel.webview.html = AuthPanel.getHtml(panel.webview);

    panel.webview.onDidReceiveMessage(async msg => {
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
          if (!res.ok) throw new Error(data.message||JSON.stringify(data));
          // save token
          await context.globalState.update('inlyneToken', data.token);
          // notify sidebar
          vscode.window.showInformationMessage('Signed in successfully');
          vscode.commands.executeCommand('inlyne.refreshSidebarAuth');
          this._panel.dispose();
        } catch (err: any) {
          this._panel.webview.postMessage({ type: 'authError', message: err.message });
        }
      }
    });

    panel.onDidDispose(() => AuthPanel.currentPanel = undefined);
  }

  public static createOrShow(context: vscode.ExtensionContext) {
    if (AuthPanel.currentPanel) {
      AuthPanel.currentPanel._panel.reveal();
    } else {
      const panel = vscode.window.createWebviewPanel(
        'inlyneAuth',
        'Sign in to Inlyne',
        vscode.ViewColumn.Active,
        { retainContextWhenHidden: false, enableScripts: true }
      );
      AuthPanel.currentPanel = new AuthPanel(panel, context);
    }
  }

  private static getHtml(webview: vscode.Webview): string {
    return /* html */`
      <!DOCTYPE html><html><body>
      <h2>Sign in to Inlyne</h2>
      <form id="login">
        <input id="email" type="email" placeholder="Email" required /><br/>
        <input id="pwd"   type="password" placeholder="Password" required /><br/>
        <button type="submit">Sign In</button>
      </form>
      <div id="error" style="color:red;"></div>
      <script>
        const vscode = acquireVsCodeApi();
        document.getElementById('login').addEventListener('submit', e => {
          e.preventDefault();
          const email = document.getElementById('email').value;
          const password = document.getElementById('pwd').value;
          vscode.postMessage({ type:'authenticate', email, password });
        });
        window.addEventListener('message', e => {
          if (e.data.type === 'authError') {
            document.getElementById('error').textContent = e.data.message;
          }
        });
      </script>
      </body></html>`;
  }
}