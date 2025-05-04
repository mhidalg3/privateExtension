import * as vscode from 'vscode';
import fetch from 'node-fetch';

export function activate(context: vscode.ExtensionContext) {
  console.log('Inlyne is now active!');

  const provider = new InlyneSidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(InlyneSidebarProvider.viewType, provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('inlyne.helloWorld', () =>
      vscode.window.showInformationMessage('Hello World from Inlyne!'),
    ),
  );
}

export function deactivate() {}

class InlyneSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'inlyne.sidebarView';
  private _view?: vscode.WebviewView;
  private readonly API_BASE_URL = 'http://localhost:8080';

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this._view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.getWebviewHtml(view.webview);

    view.webview.onDidReceiveMessage(async msg => {
      switch (msg.type) {
        case 'createDoc': await this.createDoc(); break;
        case 'fetchDoc': if (msg.key) await this.fetchDoc(msg.key); break;
      }
    });
  }

  private async createDoc() {
    try {
      const res = await fetch(`${this.API_BASE_URL}/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'create' })
      });
      const data = await res.json();
      this._view?.webview.postMessage({ type: 'docCreated', data });
    } catch (err) {
      console.error('Error creating document:', err);
      this._view?.webview.postMessage({ type: 'backendError' });
    }
  }

  private async fetchDoc(key: string) {
    try {
      const res = await fetch(`${this.API_BASE_URL}/docs?requestType=getDoc&key=${key}`);
      const data = await res.json();
      this._view?.webview.postMessage({ type: 'docFetched', data });
    } catch (err) {
      console.error(err);
      this._view?.webview.postMessage({ type: 'backendError' });
    }
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const csp = `
      default-src 'none';
      connect-src http://localhost:8080 ws://localhost:8080;
      img-src https: data:;
      style-src 'unsafe-inline' https:;
      script-src 'unsafe-inline' https:;
      font-src https:;
    `;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Inlyne Editor</title>
  <style>
    body { margin:0; font-family:sans-serif; }
    #toolbar { padding:.5rem; background:#f3f3f3; border-bottom:1px solid #ddd; }
    #toolbar input, #toolbar button { margin-right:.5rem; }
    #editor { padding:1rem; min-height:calc(100vh - 54px); box-sizing:border-box; outline:none; border:1px solid #fff; }
    #status { padding:.25rem .5rem; font-size:.8rem; color:#666; }
  </style>
</head>
<body>
  <div id="toolbar">
    <button id="createBtn">New</button>
    <input id="docKeyInput" placeholder="docKey…" style="width:150px">
    <button id="loadBtn">Load</button>
    <span id="url"></span>
  </div>
  <div id="editor"></div>
  <div id="status"></div>

  <script src="https://cdn.jsdelivr.net/npm/sockjs-client@1.6.1/dist/sockjs.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@stomp/stompjs@7.1.1/bundles/stomp.umd.min.js"></script>
  <script type="module">
    import { Editor } from 'https://esm.sh/@tiptap/core@2';
    import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2';

    const vscode = acquireVsCodeApi();
    const { Client } = window.StompJs;
    const API_BASE = 'http://localhost:8080';
    const WS_URL = API_BASE + '/ws';

    const createBtn = document.getElementById('createBtn');
    const loadBtn = document.getElementById('loadBtn');
    const docKeyInput = document.getElementById('docKeyInput');
    const urlSpan = document.getElementById('url');
    const statusLine = document.getElementById('status');

    let stompClient;
    let stompReady = false;
    let suppressLocal = false;
    let docKey = null;

    const editor = new Editor({
      element: document.getElementById('editor'),
      extensions: [StarterKit],
      editable: false,
      content: '<p>Hello, start writing…</p>',
      onUpdate({ editor }) {
        console.log('[onUpdate] fired');
        console.log('  suppressLocal:', suppressLocal);
        console.log('  stompReady:', stompReady);
        console.log('  docKey:', docKey);

        if (suppressLocal || !stompReady || !docKey) {
          console.log('[onUpdate] skipped publish');
          return;
        }

        const content = editor.getHTML();
        console.log('🔁 Publishing to server:', content);

        stompClient.publish({
          destination: '/app/edit/' + docKey,
          body: JSON.stringify({ content }),
        });
      }
    });

    function connectWS(key) {
      if (stompClient) stompClient.deactivate();
      stompReady = false;

      stompClient = new Client({
        webSocketFactory: () => new SockJS(WS_URL),
        reconnectDelay: 5000,
        heartbeatIncoming: 0,
        heartbeatOutgoing: 20000,
      });

      stompClient.onConnect = () => {
        console.log('✅ STOMP connected');
        stompReady = true;
        setStatus('🟢 Live');

        stompClient.subscribe('/topic/docs/' + key, msg => {
          const { content } = JSON.parse(msg.body);
          suppressLocal = true;
          editor.commands.setContent(content ?? '<p></p>', false);
          suppressLocal = false;
        });
      };

      stompClient.onStompError = f => {
        console.error('❌ STOMP error:', f.headers.message, f.body);
        setStatus('🔴 STOMP error');
      };

      stompClient.activate();
    }

    createBtn.addEventListener('click', () => vscode.postMessage({ type:'createDoc' }));
    loadBtn.addEventListener('click', () => {
      const key = docKeyInput.value.trim();
      if (key) vscode.postMessage({ type:'fetchDoc', key });
    });

    window.addEventListener('message', e => {
      const m = e.data;
      switch (m.type) {
        case 'docCreated': onDocCreated(m.data); break;
        case 'docFetched': onDocFetched(m.data); break;
        case 'backendError': setStatus('Backend error – is Docker up?'); break;
      }
    });

    function onDocCreated({ url }) {
      try {
        const u = new URL(url);
        docKey = u.pathname.split('/').pop();
        if (!docKey) {
          setStatus('❌ Failed to extract docKey');
          return;
        }
        editor.setEditable(true);
        editor.commands.setContent('<p></p>', false);
        urlSpan.textContent = \`?docKey=\${docKey}\`;
        setStatus('Document created');
        connectWS(docKey);
      } catch (e) {
        console.error('Invalid URL from server:', url);
        setStatus('❌ Invalid server URL');
      }
    }

    function onDocFetched(doc) {
      docKey = doc.linkKey;
      editor.setEditable(true);
      suppressLocal = true;
      editor.commands.setContent(doc.content || '<p></p>', false);
      suppressLocal = false;
      urlSpan.textContent = '?docKey=' + docKey;
      setStatus('Document loaded');
      connectWS(docKey);
    }

    function setStatus(text) {
      statusLine.textContent = text;
    }
  </script>
</body>
</html>`;
  }
}




