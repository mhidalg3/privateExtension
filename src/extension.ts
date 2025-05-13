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
    vscode.commands.registerCommand('inlyne.openEditorTab', async (keyArg?: string) => {
      const key = keyArg || InlyneSidebarProvider.currentDocKey;
      if (!key) {
        return vscode.window.showWarningMessage('No Inlyne DocKey to open');
      }
  
      // fetch the latest content for that key
      let content = InlyneSidebarProvider.currentContent;
      try {
        const res = await fetch(`http://localhost:8080/docs?requestType=getDoc&key=${key}`);
        const doc = await res.json();
        content = doc.content || '';
        InlyneSidebarProvider.currentContent = content;
        InlyneSidebarProvider.currentDocKey = key;
      } catch (e) {
        console.error('Could not fetch Inlyne document:', e);
      }
  
      InlyneEditorPanel.createOrShow(context.extensionUri, key, content);
    })
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      { scheme: 'file' },
      new InlyneLinkProvider()
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
class InlyneLinkProvider implements vscode.DocumentLinkProvider {
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
class InlyneSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'inlyne.sidebarView';
  public static currentDocKey: string | null = null;
  public static currentContent: string = '';

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
      InlyneSidebarProvider.currentContent = ''; // reset content
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
      InlyneSidebarProvider.currentContent = doc.content || ''; // stores content
      this._view?.webview.postMessage({
        type: 'docLoaded',
        key: doc.linkKey,
        content: doc.content
      });
    } catch {
      this._view?.webview.postMessage({ type: 'backendError' });
    }
  }

  private getSidebarHtml(webview: vscode.Webview): string { // just sidebar HTML
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
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: sans-serif; margin: 0; padding: 0; }
  #toolbar {
    display: flex;
    flex-direction: column;
    padding: 8px;
    gap: 8px;
    background: #f3f3f3;
    border-bottom: 1px solid #ddd;
  }
  .btn {
    flex: 1;
    background: white;
    border: 1px solid #ccc;
    padding: 0.75rem 1rem;
    font-size: 1rem;
    cursor: pointer;
    transition: background 0.3s;
  }
  .btn:hover {
    background: orange;
    color: white;
  }
  .btn-large {
    width: 100%;
  }
  .load-container {
    display: flex;
    gap: 8px;
    width: 100%;
    align-items: center;
    flex-wrap: wrap;
  }
  .load-input {
    flex: 1;
    padding: 0.75rem 1rem;
    border: 1px solid #ccc;
    font-size: 0.9rem;
  }
  #status { padding: 4px 8px; font-size: 0.85em; color: #666; }
  #editor { padding: 8px; min-height: 200px; border: 1px solid #ccc; }
  @media (max-width: 320px) {
    .load-container {
      flex-direction: column;
      align-items: stretch;
    }
    .load-input,
    .load-container .btn {
      width: 100%;
  }
</style>
</head>
<body>
  <div id="toolbar">
    <button id="btnNew" class="btn btn-large">New</button>
    <div class="load-container">
      <input id="txtKey" class="load-input" placeholder="docKey…">
      <button id="btnLoad" class="btn">Load</button>
    </div>
    <button id="btnOpen" class="btn btn-large">Open Editor</button>
  </div>
  <div id="status">Ready</div>


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
    key: string | null,
    initialContent?: string
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
        key,
        initialContent
      );
    }
  }

  private constructor(
    private readonly _panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri,
    private readonly _docKey: string,
    private readonly _initialContent?: string
  ) {
    this._panel.webview.html = this._getHtml(
      this._panel.webview,
      this._docKey,
      this._initialContent
    );
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
  }
  /* Editor area */
  #status { padding: 4px 8px; font-size: 0.85em; color: #666; }
  #editor { margin: 0 8px; padding: 8px; min-height: calc(100vh - 160px); border: 1px solid #ccc; }

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
      stompClient = new StompJs.Client({ webSocketFactory: () => new SockJS('http://localhost:8080/ws') });
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
    document.getElementById('btnNew').onclick = async () => {
      try {
        const res = await fetch('http://localhost:8080/docs', {
          method: 'POST', 
          headers: {'Content-Type':'application/json'}, 
          body: JSON.stringify({type:'create'})
        });
        const { url } = await res.json();
        docKey = new URL(url).pathname.split('/').pop();
        document.getElementById('txtKey').value = docKey;
        document.getElementById('status').textContent = 'Created ' + docKey;
        connect(docKey);
        editor.commands.setContent('<p></p>');
      } catch (err) {
        document.getElementById('status').textContent = '🔴 Error creating document';
      }
    };
    
    document.getElementById('btnLoad').onclick = async () => {
      const key = document.getElementById('txtKey').value.trim();
      if (!key) return;
      
      try {
        const res = await fetch(\`http://localhost:8080/docs?requestType=getDoc&key=\${key}\`);
        const doc = await res.json();
        docKey = doc.linkKey;
        document.getElementById('status').textContent = 'Loaded ' + docKey;
        editor.commands.setContent(doc.content || '<p></p>', false);
        connect(docKey);
      } catch (err) {
        document.getElementById('status').textContent = '🔴 Error loading document';
      }
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

    // Initial sync
    connect(docKey);
</script>
</body>
</html>`;
  }
}




