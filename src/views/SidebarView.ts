// This file contains the improved HTML for the Inlyne sidebar
// Import into extension.ts and use it to replace the inline HTML string

export function getSidebarHtml(webviewCspSource: string): string {
  const csp = `
    default-src 'none';
    style-src 'unsafe-inline';
    script-src 'unsafe-inline' ${webviewCspSource};
    connect-src https://api.inlyne.link;
  `;
  
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
        padding: 0;
        margin: 0;
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
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
      }
      button, input {
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 6px 12px;
        border-radius: 2px;
        cursor: pointer;
        margin: 4px 0;
      }
      button:hover {
        background-color: var(--vscode-button-hoverBackground);
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
        background-color: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        margin-bottom: 8px;
        width: 100%;
        box-sizing: border-box;
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
        border-top: 1px solid var(--vscode-panel-border);
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
        background-color: var(--vscode-editorInfo-background, rgba(0,127,255,0.1));
        border-left: 3px solid var(--vscode-infoForeground, #3794ff);
        font-size: 0.9em;
      }
      .error-container {
        background-color: var(--vscode-errorForeground, #f48771);
        color: var(--vscode-foreground);
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
        background-color: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 3px;
        padding: 10px;
        margin-bottom: 10px;
        cursor: pointer;
      }
      .document-card:hover {
        background-color: var(--vscode-list-hoverBackground);
      }
      .document-card h3 {
        margin: 0 0 5px 0;
        font-size: 1em;
      }
      .document-card .meta {
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
      }
    </style>
  </head>
  <body>
    <div id="container">
      <header>
        <h2>Inlyne Documentation</h2>
      </header>
      
      <div id="document-form">
        <input type="text" id="doc-key" placeholder="Enter document key" />
        <div style="display: flex; gap: 8px;">
          <button id="load-doc">Load Document</button>
          <button id="create-doc">Create New Document</button>
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
        
        card.innerHTML = \`
          <h3>\${doc.title || doc.key}</h3>
          <div class="meta">
            <span>Access: \${accessLabel}</span>
            \${doc.lastModified ? \`<span> • Last edited: \${new Date(doc.lastModified).toLocaleString()}</span>\` : ''}
          </div>
        \`;
        
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
              contentDiv.innerHTML += \`
                <div class="help-text" style="margin-top: 16px;">
                  Document "\${title}" is now loaded. Click the card above to open it in the editor.
                </div>
              \`;
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
            contentDiv.innerHTML += \`
              <div class="help-text" style="margin-top: 16px;">
                New document created! Click the card above to open it in the editor.
              </div>
            \`;
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
