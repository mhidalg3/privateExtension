
// src/extension.ts
import * as vscode from 'vscode';
import fetch from 'node-fetch';

// ① Add “.js” to the relative import below:
import { InlyneUriHandler } from './uriHandler.js';

function normalizeKey(input: string): string {
  try {
    const url = new URL(input);
    return url.pathname.replace(/^\/+/, '');
  } catch {
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
      const raw = keyArg || InlyneSidebarProvider.currentDocKey;
      const key = raw ? normalizeKey(raw) : undefined;
      if (!key) {
        return vscode.window.showWarningMessage('No Inlyne DocKey to open');
      }

      const API = 'https://api.inlyne.link';
      const token = context.globalState.get<string>('inlyneToken');
      const userId = context.globalState.get<string>('inlyneUserId');
      const headers: Record<string,string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      let res, json;
      try {
        res = await fetch(`${API}/${key}`, { method: 'GET', headers });
        json = await res.json();
      } catch (e) {
        vscode.window.showErrorMessage('Network error');
        return;
      }

      if (!res.ok || json?.responseType === "unauthorized") {
        const go = await vscode.window.showErrorMessage(
          '🔒 This document is private. Please sign in to access it.',
          'Sign In'
        );
        if (go === 'Sign In') {
          AuthPanel.createOrShow(context);
        }
        return;
      }

      if (json?.doc && !json.doc.isPublic && userId && token) {
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
        const permission = permJson?.permission ?? 'none';
        if (!['owner','admin','writer','reader'].includes(permission)) {
          vscode.window.showErrorMessage('🚫 You do not have permission to open this private document.');
          return;
        }
      }

      const content = json.doc?.content ?? '';
      const accessLevel = json.accessLevel || (json.doc?.isPublic ? 'public' : 'private');
      InlyneSidebarProvider.currentContent = content;
      InlyneSidebarProvider.currentDocKey = key;
      InlyneSidebarProvider.currentView?.webview.postMessage({
        type: 'docLoaded',
        key,
        content,
        accessLevel
      });

      InlyneEditorPanel.createOrShow(context, context.extensionUri, key, content);
    })
  );


  context.subscriptions.push(
    vscode.commands.registerCommand('inlyne.refreshSidebarAuth', () => {
      const token = context.globalState.get<string>('inlyneToken');
      const username = context.globalState.get<string>('inlyneUsername') ?? 'Unknown User';

      InlyneSidebarProvider.currentView?.webview.postMessage({
        type: 'authChanged',
        token,
        username
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
  // Just dispose the current panel if it exists, but don't close all editors
  InlyneEditorPanel.currentPanel?.dispose();
}


// ---------- Document Link Provider ----------
export class InlyneLinkProvider implements vscode.DocumentLinkProvider {
  private _regex = /DocKey\{([^}]+)\}/g;

  public provideDocumentLinks(
    doc: vscode.TextDocument
  ): vscode.ProviderResult<vscode.DocumentLink[]> {
    const text = doc.getText();
    const links: vscode.DocumentLink[] = [];
    let m: RegExpExecArray | null;

    while ((m = this._regex.exec(text))) {
      const start = doc.positionAt(m.index);
      const end = doc.positionAt(m.index + m[0].length);
      const key = m[1];

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
// Sidebar view HTML is defined in the getSidebarHtml method

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

  async resolveWebviewView(
    view: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    InlyneSidebarProvider.currentView = view;
    this._view = view;
    
    // Enable scripts in the webview
    view.webview.options = { 
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    
    // Set the HTML content
    view.webview.html = this.getSidebarHtml(view.webview);
    
    // After the webview is loaded, send the auth status
    const token = this.context.globalState.get<string>('inlyneToken');
    const username = this.context.globalState.get<string>('inlyneUsername') ?? 'Unknown User';
    
    console.log('Sending auth status to sidebar: ', { token: !!token, username });
    
    // Small delay to ensure the webview has loaded
    setTimeout(() => {
      view.webview.postMessage({
        type: 'authChanged',
        token,
        username
      });
      
      // If there's an active document, send it to the sidebar
      if (InlyneSidebarProvider.currentDocKey) {
        view.webview.postMessage({
          type: 'docLoaded',
          key: InlyneSidebarProvider.currentDocKey,
          content: InlyneSidebarProvider.currentContent,
        });
      }
    }, 500);

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
            return AuthPanel.createOrShow(this.context);
          }
          return this.createDoc();
        }
        case 'loadDoc':
          const key = normalizeKey(msg.key.trim());
          await this.loadDoc(key);
          // If the editor panel exists, just update it with the new content
          if (InlyneEditorPanel.currentPanel) {
            InlyneEditorPanel.currentPanel.update(key, InlyneSidebarProvider.currentContent);
          }
          // Open the document in a new tab or update existing one
          await vscode.commands.executeCommand('inlyne.openEditorTab', key);
          break;
        case 'keyChanged':
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
      if (!res.ok) {
        throw new Error(data.details || data.message || 'Create failed');
      }

      const url = data.url as string;
      const key = url.split('/').pop()!;

      InlyneSidebarProvider.currentDocKey = key;
      InlyneSidebarProvider.currentContent = '';
      this._view?.webview.postMessage({ type: 'docCreated', key });
    } catch (err: any) {
      console.error(err);
      this._view?.webview.postMessage({ type: 'backendError', message: err.message });
    }
  }

  private async loadDoc(key: string) {
    const token = this.context.globalState.get<string>('inlyneToken');
    const userId = this.context.globalState.get<string>('inlyneUserId');
    const headers: Record<string,string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(`${this.API}/${key}`, { method: 'GET', headers });
      const data = await res.json();

      if (!res.ok || data.responseType === 'unauthorized') {
        this._view?.webview.postMessage({
          type: 'backendError',
          message: '🔒 This document is private. Please sign in to access it.'
        });
        return;
      }

      if (data?.doc && !data.doc.isPublic && userId && token) {
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
        const permission = permJson?.permission ?? 'none';
        if (!['owner','admin','writer','reader'].includes(permission)) {
          this._view?.webview.postMessage({
            type: 'backendError',
            message: '🚫 You do not have permission to open this private document.'
          });
          return;
        }
      }

      const access = data.accessLevel as 'public'|'reader'|'writer';
      const doc = data.doc as { linkKey: string; content?: string; isPublic: boolean };

      InlyneSidebarProvider.currentDocKey = doc.linkKey;
      InlyneSidebarProvider.currentContent = (access === 'public')
        ? ''
        : (doc.content ?? '');

      this._view?.webview.postMessage({
        type: 'docLoaded',
        key: doc.linkKey,
        content: InlyneSidebarProvider.currentContent,
        accessLevel: data.accessLevel || (data.doc?.isPublic ? 'public' : 'private')
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
      style-src 'unsafe-inline';
      script-src 'unsafe-inline' ${webview.cspSource};
      connect-src https://api.inlyne.link;
      img-src ${webview.cspSource} data: https:;
    `;
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        body {
          font-family: Helvetica, Arial, sans-serif;
          padding: 0;
          margin: 0;
          color: #171717;
          background-color: #f4f4f7;
          display: flex;
          flex-direction: column;
          height: 100vh;
        }
        #container {
          display: flex;
          flex-direction: column;
          height: 100%;
          padding: 10px;
        }
        header {
          margin-bottom: 16px;
        }
        h2 {
          margin: 0 0 8px 0;
          font-size: 1.2em;
          color: #EC6D26;
        }
        button, input {
          background-color: #EC6D26;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          margin: 4px 0;
          font-family: inherit;
        }
        button:hover {
          background-color: #cf5f1e;
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        #document-form {
          display: flex;
          flex-direction: column;
          margin-bottom: 16px;
        }
        #document-form input {
          background-color: white;
          color: #171717;
          margin-bottom: 8px;
          width: 100%;
          box-sizing: border-box;
          padding: 6px 10px;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        #document-form button {
          align-self: flex-start;
        }
        #content {
          flex: 1;
          overflow-y: auto;
        }
        .status {
          margin-top: auto;
          padding-top: 8px;
          border-top: 1px solid #ccc;
          font-size: 0.9em;
          display: flex;
          flex-direction: column;
        }
        .auth-button {
          margin-top: 8px;
        }
        .help-text {
          margin: 10px 0;
          padding: 8px;
          background-color: #fff7f0;
          border-left: 3px solid #EC6D26;
          font-size: 0.9em;
        }
        .error-container {
          background-color: #fdd;
          color: #a00;
          padding: 10px;
          border-radius: 3px;
          margin: 10px 0;
          display: none;
        }
        .loading-indicator {
          display: none;
          padding: 10px 0;
          text-align: center;
        }
        .document-card {
          background-color: white;
          border: 1px solid #ccc;
          border-radius: 4px;
          padding: 10px;
          margin-bottom: 10px;
          cursor: pointer;
          transition: background-color 0.2s ease;
        }
        .document-card:hover {
          background-color: #f0f0f0;
        }
        .document-card h3 {
          margin: 0 0 5px 0;
          font-size: 1em;
        }
        .document-card .meta {
          font-size: 0.85em;
          color: #555;
        }
      </style>
    </head>
    <body>
      <div id="container">
        <header>
          <img src="${webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'inlyne_logo.png'))}" style="margin-bottom: 8px;" />
        </header>
        
        <div id="document-form">
          <input type="text" id="doc-key" placeholder="Enter document key" />
          <div style="display: flex; gap: 8px;">
            <button id="load-doc">Load Document</button>
            <button id="create-doc">New Document</button>
          </div>
        </div>

        <div id="error-container" class="error-container"></div>
        <div id="loading-indicator" class="loading-indicator">Loading document...</div>
        
        <div class="help-text">
          Enter a document key above to load an existing document, or create a new one.
          Documents are synchronized in real-time with other users.
        </div>

        <div id="content"></div>
        
        <div class="status">
          <div id="status-message">Not signed in</div>
          <button id="auth-button" class="auth-button">Sign in</button>
        </div>
      </div>
      
      <script>
        const vscode = window.acquireVsCodeApi();
        let isAuthenticated = false;
        let username = '';
        let isLoading = false;
        
        // DOM Elements
        const docKeyInput = document.getElementById('doc-key');
        const loadButton = document.getElementById('load-doc');
        const createButton = document.getElementById('create-doc');
        const statusMessage = document.getElementById('status-message');
        const authButton = document.getElementById('auth-button');
        const contentDiv = document.getElementById('content');
        const errorContainer = document.getElementById('error-container');
        const loadingIndicator = document.getElementById('loading-indicator');
        
        function setLoading(loading) {
          isLoading = loading;
          loadButton.disabled = loading;
          createButton.disabled = loading;
          loadingIndicator.style.display = loading ? 'block' : 'none';
        }
        
        function showError(message) {
          errorContainer.style.display = 'block';
          errorContainer.textContent = message;
          setTimeout(() => {
            errorContainer.style.display = 'none';
          }, 5000); // Hide after 5 seconds
        }
           function renderDocumentCard(doc) {
        const card = document.createElement('div');
        card.className = 'document-card';
        card.onclick = () => {
          docKeyInput.value = doc.key;
          loadButton.click();
        };
        
        let accessLabel = doc.isPublic ? 'Public' : 'Private';
        if (doc.accessLevel) {
          accessLabel = doc.accessLevel;
        }
        
        // Create title element
        const title = document.createElement('h3');
        title.textContent = doc.title || doc.key;
        card.appendChild(title);
        
        // Create metadata container
        const meta = document.createElement('div');
        meta.className = 'meta';
        
        // Add access info
        const access = document.createElement('span');
        access.textContent = 'Access: ' + accessLabel;
        meta.appendChild(access);
        
        // Add last modified date if available
        if (doc.lastModified) {
          const edited = document.createElement('span');
          edited.textContent = ' • Last edited: ' + new Date(doc.lastModified).toLocaleString();
          meta.appendChild(edited);
        }
        
        card.appendChild(meta);
        return card;
      }
        
        // Event Listeners
        loadButton.addEventListener('click', () => {
          const key = docKeyInput.value.trim();
          if (key) {
            setLoading(true);
            errorContainer.style.display = 'none';
            vscode.postMessage({ type: 'loadDoc', key });
          } else {
            showError('Please enter a document key');
          }
        });
        
        createButton.addEventListener('click', () => {
          setLoading(true);
          errorContainer.style.display = 'none';
          vscode.postMessage({ type: 'createDoc' });
        });
        
        authButton.addEventListener('click', () => {
          if (isAuthenticated) {
            vscode.postMessage({ type: 'signOut' });
          } else {
            vscode.postMessage({ type: 'signIn' });
          }
        });
        
        // Handle keyboard events for doc key input
        docKeyInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            loadButton.click();
          }
        });
        
        // Message Handler
        window.addEventListener('message', (event) => {
          const message = event.data;
          
          switch (message.type) {
            case 'authChanged':
              isAuthenticated = Boolean(message.token);
              username = message.username || 'Unknown User';
              
              if (isAuthenticated) {
                statusMessage.textContent = 'Signed in as: ' + username;
                authButton.textContent = 'Sign Out';
              } else {
                statusMessage.textContent = 'Not signed in';
                authButton.textContent = 'Sign In';
              }
              break;
              
            case 'docLoaded':
              setLoading(false);
              docKeyInput.value = message.key || '';
              if (message.content) {
                const title = message.title || message.key;
                contentDiv.innerHTML = '';
                contentDiv.appendChild(renderDocumentCard({
                  key: message.key,
                  title: title,
                  isPublic: message.accessLevel === 'public',
                  accessLevel: message.accessLevel,
                  lastModified: message.lastModified
                }));
                
                // Add help text
                const helpDiv = document.createElement('div');
                helpDiv.className = 'help-text';
                helpDiv.style.marginTop = '16px';
                helpDiv.textContent = 'Document "' + title + '" is now loaded. Click the card above to open it in the editor.';
                contentDiv.appendChild(helpDiv);
              }
              break;
              
            case 'docCreated':
              setLoading(false);
              docKeyInput.value = message.key || '';
              contentDiv.innerHTML = '';
              contentDiv.appendChild(renderDocumentCard({
                key: message.key,
                title: 'New Document',
                isPublic: false,
                accessLevel: 'owner'
              }));
              
              // Add help text
              const newDocHelpDiv = document.createElement('div');
              newDocHelpDiv.className = 'help-text';
              newDocHelpDiv.style.marginTop = '16px';
              newDocHelpDiv.textContent = 'New document created! Click the card above to open it in the editor.';
              contentDiv.appendChild(newDocHelpDiv);
              break;
              
            case 'backendError':
              setLoading(false);
              showError(message.message || 'An error occurred');
              break;
              
            case 'externalKeyChanged':
              docKeyInput.value = message.key || '';
              break;
          }
        });
      </script>
    </body>
    </html>`;
  }
}


// ---------- Pop-out Editor Panel ----------
import { Client as StompClient, Frame, IMessage } from '@stomp/stompjs';

class InlyneEditorPanel {
  public static currentPanel: InlyneEditorPanel | undefined;
  private readonly API = 'https://api.inlyne.link';

  // ② Add this line so that `this.stompClient` exists:
  private stompClient?: StompClient;

  public postMessage(message: any) {
    this._panel.webview.postMessage(message);
  }

  public update(key: string, content: string) {
    this._docKey = key;
    const data = { doc: { isPublic: true }, accessLevel: 'public' }; 

    // Update the panel title to reflect the new document
    this._panel.title = `Inlyne: ${key}`;
    
    this._panel.webview.postMessage({
      type: 'externalKeyChanged',
      key
    });

    // First notify the webview about the document change
    this._panel.webview.postMessage({
      type: 'editorDocLoaded',
      key,
      content,
      accessLevel: data.accessLevel || (data.doc?.isPublic ? 'public' : 'private')
    });
    
    console.log(`Updated editor panel with key: ${key}, content length: ${content.length}`);
  }

  public static createOrShow(
    context: vscode.ExtensionContext,
    extensionUri: vscode.Uri,
    key: string | null,
    initialContent?: string
  ) {
    if (!key) {
      vscode.window.showWarningMessage('No document loaded');
      return;
    }

    console.log('Creating editor panel with key:', key, 'content length:', initialContent?.length ?? 0);

    const column = vscode.ViewColumn.Beside;
    if (InlyneEditorPanel.currentPanel) {
      console.log('Reusing existing editor panel');
      InlyneEditorPanel.currentPanel._panel.reveal(column);
      
      // Always update the panel with the latest content and title
      InlyneEditorPanel.currentPanel.update(key, initialContent ?? '');
      
      // No need to force refresh the HTML here as the update method should handle 
      // sending the correct messages to the webview to update content
      
      return;
    } else {
      console.log('Creating new editor panel');
      try {
        const panel = vscode.window.createWebviewPanel(
          'inlyneEditor',
          `Inlyne: ${key}`,
          { viewColumn: column, preserveFocus: false },
          { 
            enableScripts: true,
            localResourceRoots: [extensionUri]
          }
        );
        
        InlyneEditorPanel.currentPanel = new InlyneEditorPanel(
          panel,
          extensionUri,
          key,
          initialContent,
          context
        );
      } catch (error) {
        console.error('Error creating editor panel:', error);
        vscode.window.showErrorMessage(`Error creating editor: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private constructor(
    private readonly _panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri,
    private _docKey: string,
    private readonly _initialContent: string = ' ',
    private readonly _context: vscode.ExtensionContext
  ) {
    console.log('Initializing editor panel with docKey:', _docKey);
    
    // Set the options for localResourceRoots to include the extension directory
    this._panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };
    
    this._panel.webview.html = this._getHtml(
      this._panel.webview,
      this._docKey,
      this._initialContent
    );
    
    console.log('HTML set for editor panel');

    // ③ Replace the old `if (msg.type === ...)` chain with a `switch(msg.type)`:
    this._panel.webview.onDidReceiveMessage(async (msg: any) => {
      switch (msg.type) {
        case 'connectionStatusChanged':
          console.log('Editor connection status changed:', msg.status);
          // You could show a notification to the user here if needed
          if (msg.status === 'error') {
            vscode.window.showErrorMessage('Connection error in Inlyne editor. Check your network connection.');
          }
          break;
          
        case 'loadEditorDoc':
          if (msg.key) {
            const raw = msg.key.trim();
            const key = normalizeKey(raw);
            try {
              const token = this._context.globalState.get<string>('inlyneToken');
              const headers: Record<string, string> = {};
              if (token) {
                headers['Authorization'] = `Bearer ${token}`;
              }

              const res = await fetch(`${this.API}/${key}`, { headers });
              const data = await res.json();
              const newKey = data.doc?.linkKey || key;
              const content = data.doc?.content ?? '';
              this._panel.webview.postMessage({
                type: 'editorDocLoaded',
                key: newKey,
                content,
                accessLevel: data.accessLevel || (data.doc?.isPublic ? 'public' : 'private')
              });
              InlyneSidebarProvider.currentDocKey  = newKey;
              InlyneSidebarProvider.currentContent = content;
              InlyneSidebarProvider.currentView?.webview.postMessage({
                type: 'docLoaded',
                key: newKey,
                content,
                accessLevel: data.accessLevel || (data.doc?.isPublic ? 'public' : 'private')
              });
            } catch (err) {
              console.error('Error loading in popout:', err);
              this._panel.webview.postMessage({
                type: 'editorDocError',
                message: String(err)
              });
            }
          }
          break;

        case 'keyChanged':
          this._docKey = msg.key;
          InlyneSidebarProvider.currentView?.webview.postMessage({
            type: 'externalKeyChanged',
            key: msg.key
          });
          break;

        case 'contentUpdate':
          {
            const updatedKey = msg.docKey as string;
            const newHtml    = msg.content as string;

            // Use STOMP if available:
            if (this.stompClient?.active) {
              this.stompClient.publish({
                destination: '/app/edit/' + updatedKey,
                body: JSON.stringify({ content: newHtml })
              });
            }
            // Or, fallback to a REST call:
            // try {
            //   await fetch(`https://api.inlyne.link/docs/${updatedKey}`, {
            //     method: 'PUT',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify({ content: newHtml })
            //   });
            // } catch (e) {
            //   console.error('Failed to save content:', e);
            // }

            break;
          }

        default:
          console.warn('Unrecognized message from editor webview:', msg.type);
          break;
      }
    });

    this._panel.onDidDispose(() => this.dispose());
  }

  public dispose() {
    InlyneEditorPanel.currentPanel = undefined;
    this._panel.dispose();
    // Don't close all editors in the group, let VS Code handle the panel lifecycle
  }

  private _getHtml(webview: vscode.Webview, key: string, initialContent?: string): string {
    // Create URIs to the script files
    const editorScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'editor.js')
    );
    // Add the shim script to provide Node.js globals in browser environment
    const shimScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'shim.js')
    );
    console.log('Editor script URI:', editorScriptUri.toString());
    console.log('Shim script URI:', shimScriptUri.toString());
    
    const initContent = JSON.stringify(initialContent ?? '');
    const initKey     = JSON.stringify(key);

    // More permissive CSP for debugging
    const csp = `
      default-src 'none';
      script-src 'unsafe-inline' 'unsafe-eval' ${webview.cspSource};
      style-src ${webview.cspSource} 'unsafe-inline';
      connect-src https://api.inlyne.link wss://api.inlyne.link https: http:;
      img-src ${webview.cspSource} data: https:;
      font-src ${webview.cspSource};
    `;

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"/>
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <title>Inlyne Editor</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100vh;
          display: flex;
          flex-direction: column;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          background-color: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
        }
        #error-container {
          display: none;
          background-color: #fee;
          color: #c00;
          padding: 15px;
          margin: 10px;
          border-radius: 5px;
          border: 1px solid #f88;
        }
        #loading {
          padding: 20px;
          text-align: center;
          color: #666;
        }
        #root {
          flex: 1;
          width: calc(100% - 30px); /* Account for horizontal margins (15px on each side) */
          height: calc(100vh - 95px); /* Adjusted to leave space for status bar and toolbar */
          overflow: auto;
          position: relative;
          padding: 10px; /* Uniform padding to prevent horizontal overflow */
          box-sizing: border-box;
          border: 1px solid #EC6D26;
          margin: 0 15px 15px 15px;
          border-radius: 5px;
          background-color: rgb(248, 248, 249); /* Light background matching design specs */
          color: var(--vscode-editor-foreground, #333333);
        }
        
        /* Theme-specific root styles */
        .vscode-dark #root {
          background-color: var(--vscode-editor-background, #1e1e1e);
          color: var(--vscode-editor-foreground, #e0e0e0);
        }
        #debug {
          font-family: monospace;
          font-size: 12px;
          padding: 10px;
          background-color: #f8f8f8;
          border-top: 1px solid #ddd;
          display: none;
        }
        .status-bar {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          height: 22px;
          padding: 5px 15px;
          background-color: var(--vscode-statusBar-background, #007acc);
          color: var(--vscode-statusBar-foreground, white);
          font-size: 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 1000;
          box-shadow: 0 -1px 3px rgba(0,0,0,0.1);
        }
        .connection-status {
          display: flex;
          align-items: center;
        }
        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
        }
        .status-connected {
          background-color: #3fb950;
        }
        .status-connecting {
          background-color: #f0b429;
        }
        .status-disconnected {
          background-color: #f48771;
        }
        .toast {
          position: fixed;
          top: 10px;
          right: 10px;
          padding: 10px 15px;
          background-color: rgba(0, 0, 0, 0.7);
          color: white;
          border-radius: 4px;
          font-size: 13px;
          z-index: 1010;
          animation: fadeIn 0.3s, fadeOut 0.5s 2.5s forwards;
          max-width: 80%;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        #toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px;
          width: calc(100% - 30px); /* Match root width */
          margin: 0 15px;
          box-sizing: border-box;
        }
        #toolbar .btn {
          border: none; border-radius: 8px;
          padding: 8px 12px; cursor: pointer; font-size: 14px;
        }
        .btn:hover { opacity: 0.9; }
        .load-input {
          flex: 1; padding: 8px 12px;
          width: 200px; border: 1px solid #ccc;
          border-radius: 8px;
          font-size: 14px;
        }
        
        /* Color handling for rich text editor */
        /* Preserve explicitly set colors */
        #root [style*="color:"] {
          color: inherit !important;
        }
        
        /* Handle black text specially in dark mode */
        .vscode-dark #root [style*="color: rgb(0, 0, 0)"],
        .vscode-dark #root [style*="color:rgb(0,0,0)"],
        .vscode-dark #root [style*="color: black"],
        .vscode-dark #root [style*="color:black"] {
          color: var(--vscode-editor-foreground, #e0e0e0) !important;
        }
        
        /* Handle white text specially in light mode */
        .vscode-light #root [style*="color: rgb(255, 255, 255)"],
        .vscode-light #root [style*="color:rgb(255,255,255)"],
        .vscode-light #root [style*="color: white"],
        .vscode-light #root [style*="color:white"] {
          color: var(--vscode-editor-foreground, #333333) !important;
        }
        
        /* Always preserve bright, specific colors */
        #root [style*="color: rgb(255, 0, 0)"], 
        #root [style*="color:rgb(255,0,0)"], 
        #root [style*="color: red"], 
        #root [style*="color:red"] {
          color: red !important;
        }
        
        #root [style*="color: rgb(0, 128, 0)"], 
        #root [style*="color:rgb(0,128,0)"], 
        #root [style*="color: green"], 
        #root [style*="color:green"] {
          color: green !important;
        }
        
        #root [style*="color: rgb(0, 0, 255)"], 
        #root [style*="color:rgb(0,0,255)"], 
        #root [style*="color: blue"], 
        #root [style*="color:blue"] {
          color: blue !important;
        }
      </style>
    </head>
    <body>
      <div id="error-container"></div>
      <div id="loading">Loading editor...</div>
      <div id="toolbar">
        <button id="btnNew" class="btn">New</button>
        <input id="txtKey" class="load-input" placeholder="docKey…" value="${key}"/>
        <button id="btnLoad" class="btn">Load</button>
      </div>
      <div id="root"></div>
      <div class="status-bar">
        <div class="connection-status">
          <div class="status-indicator status-disconnected" id="connection-indicator"></div>
          <span id="connection-status-text">Disconnected</span>
        </div>
        <div id="document-info">Document: Loading...</div>
      </div>
      <div id="toast-container"></div>
      
      <script>
        window.__INITIAL_CONTENT__ = ${initContent};
        window.__INITIAL_DOCKEY__   = ${initKey};
        window.addEventListener('DOMContentLoaded', () => {
          // inject API - store globally to avoid calling acquireVsCodeApi() multiple times
          window.vscode = acquireVsCodeApi();
          
          // Detect VSCode theme and apply appropriate class to the body
          function detectTheme() {
            const computedStyle = getComputedStyle(document.body);
            const backgroundColor = computedStyle.getPropertyValue('--vscode-editor-background').trim();
            const foregroundColor = computedStyle.getPropertyValue('--vscode-editor-foreground').trim();
            
            // Enhanced theme detection logic
            let isDark = false;
            
            // First method: Check VS Code's theme-specific class (most reliable)
            if (document.body.classList.contains('vscode-dark') || 
                document.body.classList.contains('vs-dark')) {
                isDark = true;
            }
            // Second method: Check VS Code theme variable 'vscode-theme-kind'
            else if (computedStyle.getPropertyValue('--vscode-theme-kind').includes('dark')) {
                isDark = true;
            }
            // Third method: Check background color value for common dark themes
            else if (backgroundColor && (
                backgroundColor.includes('rgb(30, 30, 30)') || 
                backgroundColor.includes('#1e1e1e') ||
                backgroundColor.includes('rgb(32, 32, 32)') ||
                backgroundColor.includes('#202020')
            )) {
                isDark = true;
            }
            // Fourth method: Calculate contrast ratio between bg and fg
            else if (backgroundColor && foregroundColor) {
                // Parse RGB values for background
                const bgMatch = backgroundColor.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
                if (bgMatch) {
                    const [_, r, g, b] = bgMatch.map(n => parseInt(n));
                    // Calculate perceived brightness (ITU-R BT.709)
                    const brightness = (r * 0.2126 + g * 0.7152 + b * 0.0722);
                    // If brightness is low, it's likely dark mode
                    isDark = brightness < 128;
                }
            }
            
            // Apply appropriate classes to body
            document.body.classList.toggle('vscode-dark', isDark);
            document.body.classList.toggle('vscode-light', !isDark);
            console.log('Theme detected:', isDark ? 'dark' : 'light');
            
            // Store the theme in local storage for persistence
            try {
              localStorage.setItem('vscode-theme', isDark ? 'dark' : 'light');
            } catch (e) {
              console.warn('Could not save theme preference to localStorage');
            }
          }
          
          // Detect theme on load
          detectTheme();
          
          // Re-detect theme on any relevant changes with improved observer
          const observer = new MutationObserver((mutations) => {
            // Only proceed if we have class or style changes that might affect theming
            const relevantMutation = mutations.some(mutation => 
              mutation.attributeName === 'class' || 
              mutation.attributeName === 'style'
            );
            
            if (relevantMutation) {
              // Detect theme using our enhanced function
              detectTheme();
              
              // Get updated theme state
              const isDark = document.body.classList.contains('vscode-dark');
              
              // Send theme info to the editor component via custom event
              const rootElement = document.getElementById('root');
              if (rootElement) {
                console.log('Dispatching theme change event:', isDark ? 'dark' : 'light');
                const event = new CustomEvent('vscode-theme-changed', { 
                  detail: { isDarkTheme: isDark }
                });
                rootElement.dispatchEvent(event);
              }
            }
          });
          
          observer.observe(document.documentElement, { 
            attributes: true,
            attributeFilter: ['style', 'class']
          });

          // Debug helper
          function debugLog(message) {
            console.log(message);
            const debug = document.getElementById('debug');
            if (debug) {
              const time = new Date().toLocaleTimeString();
              debug.innerHTML += '<div>' + time + ' - ' + message + '</div>';
              debug.style.display = 'block';
            }
          }
          
          // Global error handling
          const errorContainer = document.getElementById('error-container');
          
          window.onerror = function(message, source, lineno, colno, error) {
            console.error('Script error:', message, source, lineno, error);
            errorContainer.style.display = 'block';
            errorContainer.innerHTML = '<h3>Error Loading Editor</h3><p>' + 
              message + '</p><p>Source: ' + source + ' Line: ' + lineno + '</p>';
            
            debugLog('Error: ' + message + ' at ' + source + ':' + lineno);
            return true;
          };

          // PROVIDE NODE.JS COMPATIBILITY LAYER - necessary for dependencies
          debugLog('Setting up Node.js compatibility shims');
          
          // Define 'global' if it's not already defined - many libraries expect this
          window.global = window;
          
          // Define Node.js process object
          window.process = window.process || {
            env: { NODE_ENV: 'production' },
            browser: true,
            version: '',
            versions: { node: '' }
          };
          
          // Toolbar Load and New buttons
          document.getElementById('btnNew').addEventListener('click', () => {
            // We reuse the same createDoc logic that lives in the sidebar
            window.vscode.postMessage({ type: 'createDoc' });
          });

          document.getElementById('btnLoad').addEventListener('click', () => {
            const key = document.getElementById('txtKey').value.trim();
            if (key) {
              window.vscode.postMessage({ type: 'loadEditorDoc', key });
            } else {
              showToast('Please enter a document key');
              // window.vscode.postMessage({ type: 'showError', message: 'Please enter a document key.' });
            }
          });

          // Listen to key changes from the sidebar
           window.addEventListener('message', (e) => {
            const m = e.data;
            if (m.type === 'externalKeyChanged') {
              document.getElementById('txtKey').value = m.key;
              document.getElementById('document-info').textContent = 'Document: ' + m.key;
            }
            if (m.type === 'editorDocLoaded') {
              // Once the editor has actually loaded a doc, update the status bar
              document.getElementById('document-info').textContent = 'Document: ' + m.key;
            }
          });

          // Status management functions
          function updateConnectionStatus(status) {
            const indicator = document.getElementById('connection-indicator');
            const statusText = document.getElementById('connection-status-text');
            const docInfo = document.getElementById('document-info');
            
            indicator.className = 'status-indicator';
            
            switch(status) {
              case 'connected':
                indicator.classList.add('status-connected');
                statusText.textContent = 'Connected';
                break;
              case 'connecting':
                indicator.classList.add('status-connecting');
                statusText.textContent = 'Connecting...';
                break;
              case 'disconnected':
                indicator.classList.add('status-disconnected');
                statusText.textContent = 'Disconnected';
                break;
              case 'error':
                indicator.classList.add('status-disconnected');
                statusText.textContent = 'Connection Error';
                break;
            }
          }
          
          function updateDocumentInfo(docKey) {
            const docInfo = document.getElementById('document-info');
            if (docKey) {
              docInfo.textContent = 'Document: ' + docKey;
            } else {
              docInfo.textContent = 'No document loaded';
            }
          }
          
          function showToast(message, duration = 3000) {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = message;
            container.appendChild(toast);
            
            setTimeout(() => {
              toast.remove();
            }, duration);
          }
          
          // Buffer is often needed by Node.js libraries
          window.Buffer = window.Buffer || {
            isBuffer: function() { return false; }
          };
          
          debugLog('Node.js compatibility layer initialized');
          
          try {
            debugLog('Setting up initial content and docKey');
            window.__INITIAL_CONTENT__ = ${initContent};
            window.__INITIAL_DOCKEY__   = ${initKey};
            debugLog('Key: ' + ${initKey} + ', Content length: ' + 
              (${initContent} ? ${initContent}.length : 0));
          } catch (e) {
            console.error('Error setting initial content', e);
            errorContainer.style.display = 'block';
            errorContainer.innerHTML = '<h3>Error Setting Initial Content</h3><p>' + e.message + '</p>';
            debugLog('Error setting initial content: ' + e.message);
          }
      });
      </script>
      
      <!-- Load the editor script with Node.js compatibility shims already in place -->
      <script>
        debugLog('About to load editor script: ' + '${editorScriptUri}');
      </script>
      
      <!-- Load connection UI enhancement script -->
      <script src="${webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'connection-ui.js'))}"></script>
      
      <!-- Load the main editor script -->
      <script src="${editorScriptUri}" 
        type="module" 
        onload="document.getElementById('loading').style.display='none'; debugLog('Editor script loaded successfully');" 
        onerror="document.getElementById('error-container').style.display='block'; document.getElementById('error-container').innerHTML='<h3>Failed to load editor script</h3><p>Could not load ' + this.src + '</p>'; debugLog('Failed to load editor script: ' + this.src);">
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
          if (!res.ok) {
            throw new Error(data.message||JSON.stringify(data));
          }
          await context.globalState.update('inlyneToken', data.token);
          await context.globalState.update('inlyneUsername', data.email);
          await context.globalState.update('inlyneUserId', data.userId);
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
    const csp = `
      default-src 'none';
      style-src 'unsafe-inline';
      script-src 'unsafe-inline';
    `;
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="${csp}">
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          padding: 20px;
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
        }
        h2 {
          margin-bottom: 20px;
        }
        .form-group {
          margin-bottom: 15px;
        }
        input {
          display: block;
          width: 100%;
          padding: 8px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 2px;
          margin-top: 5px;
          font-size: 14px;
        }
        button {
          padding: 8px 16px;
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 2px;
          cursor: pointer;
        }
        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        .error-message {
          color: #f44;
          margin: 10px 0;
          display: none;
        }
      </style>
    </head>
    <body>
      <h2>Sign in to Inlyne</h2>
      
      <form id="auth-form">
        <div class="form-group">
          <label for="email">Email</label>
          <input type="email" id="email" required placeholder="Enter your email" />
        </div>
        
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" required placeholder="Enter your password" />
        </div>
        
        <div id="error-message" class="error-message"></div>
        
        <button type="submit">Sign In</button>
      </form>
      
      <script>
        const vscode = window.acquireVsCodeApi();
        const form = document.getElementById('auth-form');
        const errorMessage = document.getElementById('error-message');
        
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          
          const email = document.getElementById('email').value;
          const password = document.getElementById('password').value;
          
          vscode.postMessage({
            type: 'authenticate',
            email,
            password
          });
        });
        
        window.addEventListener('message', (event) => {
          const message = event.data;
          
          if (message.type === 'authError') {
            errorMessage.textContent = message.message;
            errorMessage.style.display = 'block';
          }
        });
      </script>
    </body>
    </html>
    `;
  }
}

