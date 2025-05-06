import * as vscode from 'vscode';
import fetch from 'node-fetch';

export function activate(context: vscode.ExtensionContext) {
  console.log('Inlyne is active');

  // Register the sidebar view provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      InlyneSidebarProvider.viewType,
      new InlyneSidebarProvider(context.extensionUri)
    )
  );

  // Register the "Open Editor" command
  context.subscriptions.push(
    vscode.commands.registerCommand('inlyne.openEditorTab', () => {
      InlyneEditorPanel.createOrShow(
        context.extensionUri,
        InlyneSidebarProvider.currentDocKey
      );
    })
  );
}

export function deactivate() {
  InlyneEditorPanel.currentPanel?.dispose();
}

// ---------- Sidebar Provider ----------
class InlyneSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'inlyne.sidebarView';
  public static currentDocKey: string | null = null;

  private _view?: vscode.WebviewView;
  private readonly API = 'http://localhost:8080';

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    view: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.getSidebarHtml(view.webview);

    view.webview.onDidReceiveMessage(async msg => {
      switch (msg.type) {
        case 'createDoc':
          await this.createDoc();
          break;
        case 'loadDoc':
          await this.loadDoc(msg.key);
          break;
        case 'openEditor':
          await vscode.commands.executeCommand('inlyne.openEditorTab');
          break;
      }
    });
  }

  private async createDoc() {
    try {
      const res = await fetch(`${this.API}/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'create' })
      });
      const { url } = await res.json();
      const key = new URL(url).pathname.split('/').pop()!;
      InlyneSidebarProvider.currentDocKey = key;
      this._view?.webview.postMessage({ type: 'docCreated', key });
    } catch {
      this._view?.webview.postMessage({ type: 'backendError' });
    }
  }

  private async loadDoc(key: string) {
    try {
      const res = await fetch(
        `${this.API}/docs?requestType=getDoc&key=${key}`
      );
      const doc = await res.json();
      InlyneSidebarProvider.currentDocKey = doc.linkKey;
      this._view?.webview.postMessage({
        type: 'docLoaded',
        key: doc.linkKey,
        content: doc.content
      });
    } catch {
      this._view?.webview.postMessage({ type: 'backendError' });
    }
  }

  private getSidebarHtml(webview: vscode.Webview): string {
    const csp = `
      default-src 'none';
      connect-src http://localhost:8080 ws://localhost:8080;
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
  body { font-family:sans-serif; margin:0; padding:0; }
  #toolbar { padding:8px; background:#f3f3f3; border-bottom:1px solid #ddd; }
  #toolbar input, #toolbar button { margin-right:8px; }
  #status { padding:4px 8px; font-size:0.85em; color:#666; }
  
</style>
</head>
<body>
  <div id="toolbar">
    <button id="btnNew">New</button>
    <input id="txtKey" placeholder="docKey…">
    <button id="btnLoad">Load</button>
    <button id="btnOpen">Open Editor</button>
  </div>
  <div id="status">Ready</div>
  <div id="editor"></div>

<script src="https://cdn.jsdelivr.net/npm/sockjs-client@1.6.1/dist/sockjs.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stomp/stompjs@7.1.1/bundles/stomp.umd.min.js"></script>
<script type="module">
  import { Editor } from 'https://esm.sh/@tiptap/core@2';
  import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2';
  const vscode = acquireVsCodeApi();

  let docKey = null;
  let stompClient;
  let suppress = false;

  const editorDiv = document.getElementById('editor');
  const status = document.getElementById('status');
  const editor = new Editor({
    element: editorDiv,
    extensions: [StarterKit],
    editable: false,
    content: '<p></p>',
    onUpdate({ editor }) {
      if (suppress || !docKey || !stompClient?.active) return;
      stompClient.publish({
        destination: '/app/edit/' + docKey,
        body: JSON.stringify({ content: editor.getHTML() })
      });
    }
  });

  function connect(key) {
    if (stompClient) stompClient.deactivate();
    stompClient = new StompJs.Client({
      webSocketFactory: () => new SockJS('http://localhost:8080/ws')
    });
    stompClient.onConnect = () => {
      status.textContent = 'Live ' + m.key;
      
    };
    stompClient.activate();
    stompClient.subscribe('/topic/docs/' + key, msg => {
      const { content } = JSON.parse(msg.body);
      suppress = true;
      editor.commands.setContent(content, false);
      suppress = false;
    });
  }

  document.getElementById('btnNew').onclick = () => vscode.postMessage({ type:'createDoc' });
  document.getElementById('btnLoad').onclick = () => {
    const key = document.getElementById('txtKey').value.trim();
    vscode.postMessage({ type:'loadDoc', key });
  };
  document.getElementById('btnOpen').onclick = () => vscode.postMessage({ type:'openEditor' });

  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'docCreated') {
      docKey = m.key;
      status.textContent = 'Created ' + m.key;
      editorDiv.style.display = 'block';
      editor.commands.setContent('<p></p>');
      connect(m.key);
    } else if (m.type === 'docLoaded') {
      docKey = m.key;
      status.textContent = 'Loaded ' + m.key;
      editorDiv.style.display = 'block';
      editor.commands.setContent(m.content || '<p></p>');
      connect(m.key);
    } else if (m.type === 'backendError') {
      status.textContent = 'Backend error';
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

  public static createOrShow(
    extensionUri: vscode.Uri,
    key: string | null
  ) {
    if (!key) {
      vscode.window.showWarningMessage('No document loaded');
      return;
    }

    const column = vscode.ViewColumn.Beside;
    if (InlyneEditorPanel.currentPanel) {
      InlyneEditorPanel.currentPanel._panel.reveal(column);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'inlyneEditor',
        `Inlyne: ${key}`,
        { viewColumn: column, preserveFocus: false },
        { enableScripts: true }
      );
      InlyneEditorPanel.currentPanel = new InlyneEditorPanel(
        panel,
        extensionUri,
        key
      );
    }
  }

  private constructor(
    private readonly _panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri,
    private readonly _docKey: string
  ) {
    this._panel.webview.html = this._getHtml(
      this._panel.webview,
      this._docKey
    );
    this._panel.onDidDispose(() => this.dispose());
  }

  public dispose() {
    InlyneEditorPanel.currentPanel = undefined;
    this._panel.dispose();
  }

  private _getHtml(webview: vscode.Webview, key: string): string {
    // reuse full sidebar HTML inside editor window
    const csp = `
      default-src 'none';
      connect-src http://localhost:8080 ws://localhost:8080;
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
  body { font-family:sans-serif; margin:0; padding:0; }
  #toolbar { padding:8px; background:#f3f3f3; border-bottom:1px solid #ddd; }
  #toolbar input, #toolbar button { margin-right:8px; }
  #status { padding:4px 8px; font-size:0.85em; color:#666; }
  #editor { padding:8px; min-height:calc(100vh - 100px); border:1px solid #ccc; display:block; }
</style>
</head>
<body>
  <div id="toolbar">
    <button id="btnNew">New</button>
    <input id="txtKey" placeholder="docKey…" value="${key}">
    <button id="btnLoad">Load</button>
  </div>
  <div id="status">Editor for ${key}</div>
  <div id="editor"></div>

<script src="https://cdn.jsdelivr.net/npm/sockjs-client@1.6.1/dist/sockjs.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@stomp/stompjs@7.1.1/bundles/stomp.umd.min.js"></script>
<script type="module">
  import { Editor } from 'https://esm.sh/@tiptap/core@2';
  import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2';
  const editorDiv = document.getElementById('editor');
  const status = document.getElementById('status');
  const vscode = acquireVsCodeApi();

  let docKey = '${key}';
  let stompClient;
  let suppress = false;

  const editor = new Editor({
    element: editorDiv,
    extensions: [StarterKit],
    editable: true,
    content: '<p>Loading…</p>',
    onUpdate({ editor }) {
      if (suppress || !docKey || !stompClient?.active) return;
      stompClient.publish({
        destination: '/app/edit/' + docKey,
        body: JSON.stringify({ content: editor.getHTML() })
      });
    }
  });

  function connect(key) {
    if (stompClient) stompClient.deactivate();
    stompClient = new StompJs.Client({ webSocketFactory: () => new SockJS('http://localhost:8080/ws') });
    stompClient.onConnect = () => { status.textContent = 'Live'; };
    stompClient.activate();
    stompClient.subscribe('/topic/docs/' + key, msg => {
      const { content } = JSON.parse(msg.body);
      suppress = true;
      editor.commands.setContent(content, false);
      suppress = false;
    });
  }

  document.getElementById('btnNew').onclick = async () => {
    const res = await fetch('http://localhost:8080/docs', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({type:'create'})
    });
    const { url } = await res.json();
    docKey = new URL(url).pathname.split('/').pop();
    connect(docKey);
    status.textContent = 'Created ' + docKey;
  };
  document.getElementById('btnLoad').onclick = async () => {
    const key = document.getElementById('txtKey').value.trim();
    const res = await fetch('http://localhost:8080/docs?requestType=getDoc&key=${key}');
    const doc = await res.json();
    docKey = doc.linkKey;
    editor.commands.setContent(doc.content || '<p></p>', false);
    connect(docKey);
    status.textContent = 'Loaded ' + docKey;
  };

  // Initial connect
  connect(docKey);
</script>
</body>
</html>`;
  }
}




