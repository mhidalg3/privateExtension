/// <reference types="vscode" />

import * as vscode from 'vscode';
import fetch from 'node-fetch';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('inlyne.openPanel', () => {
            InlynePanel.createOrShow();
        })
    );
}

class InlynePanel {
    public static currentPanel: InlynePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private readonly API_BASE_URL = 'http://localhost:8080';

    public static createOrShow() {
        const column = vscode.ViewColumn.One;

        if (InlynePanel.currentPanel) {
            InlynePanel.currentPanel._panel.reveal(column);
        } else {
            const panel = vscode.window.createWebviewPanel(
                'inlynePanel',
                'Inlyne Tab',
                column,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true // critical for tabs
                }
            );

            InlynePanel.currentPanel = new InlynePanel(panel);
        }
    }

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;

        this._panel.webview.html = this.getWebviewContent();

        // Listen for messages from the webview
        this._panel.webview.onDidReceiveMessage(async (message) => {
            console.log('🔥 Received message from webview:', message); // log for debugging
            switch (message.type) {
                case 'createDoc':
                    await this.createDocument();
                    break;
                case 'fetchDoc':
                    if (message.key) {
                        await this.fetchDocument(message.key);
                    }
                    break;
            }
        });

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public dispose() {
        InlynePanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private getWebviewContent(): string {
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Inlyne Tab</title>
            <style>
                body { font-family: sans-serif; padding: 1rem; }
                textarea { width: 100%; height: 300px; margin-top: 1rem; }
                #url { font-weight: bold; margin-top: 0.5rem; }
                #createBtn, #loadBtn { padding: 0.5rem 1rem; margin-right: 0.5rem; }
                #docKeyInput { margin-top: 1rem; width: 100%; padding: 0.5rem; }
            </style>
        </head>
        <body>
            <button id="createBtn">Create New Document</button>
            <input type="text" id="docKeyInput" placeholder="Enter docKey to load">
            <button id="loadBtn">Load Document</button>
            <div id="url"></div>
            <textarea id="editor" placeholder="Start editing..." disabled></textarea>

            <script src="https://cdn.jsdelivr.net/npm/sockjs-client@1.6.1/dist/sockjs.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/@stomp/stompjs@7.1.1/bundles/stomp.umd.min.js"></script>

            <script>
                const vscode = acquireVsCodeApi();
                const API_BASE = 'http://localhost:8080';
                const WS_URL = API_BASE + '/ws';

                let stompClient;
                let docKey = null;

                const createBtn = document.getElementById('createBtn');
                const loadBtn = document.getElementById('loadBtn');
                const docKeyInput = document.getElementById('docKeyInput');
                const urlDiv = document.getElementById('url');
                const editor = document.getElementById('editor');

                // Create new document
                createBtn.addEventListener('click', () => {
                    vscode.postMessage({ type: 'createDoc' });
                    console.log('✅ Sent createDoc to extension');
                });

                // Load existing document
                loadBtn.addEventListener('click', () => {
                    let key = docKeyInput.value.trim();
                    if (!key) return;

                    // --- START: Extract docKey ---
                    // If full URL with ?docKey=...
                    if (key.includes('?docKey=')) {
                        const urlParams = new URLSearchParams(key.split('?')[1]);
                        key = urlParams.get('docKey');
                    } else if (key.startsWith('http')) {
                        // If full URL like /docs/abc123
                        key = key.split('/').pop();
                    }
                    // --- END: Extract docKey ---

                    if (key) {
                        vscode.postMessage({ type: 'fetchDoc', key: key });
                        console.log('✅ Sent fetchDoc to extension with key:', key);
                    } else {
                        console.error('❌ Could not extract docKey');
                    }
                });

                // Listen to editor changes and publish to websocket
                editor.addEventListener('input', () => {
                    if (stompClient?.active && docKey) {
                        stompClient.publish({
                            destination: '/app/edit/' + docKey,
                            body: JSON.stringify({ content: editor.value }),
                        });
                    }
                });

                // Listen for messages from the extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    console.log('✅ Received message from extension:', message);

                    switch (message.type) {
                        case 'docCreated':
                            handleDocCreated(message.data);
                            break;
                        case 'docFetched':
                            handleDocFetched(message.data);
                            break;
                        case 'backendError':
                            handleBackendError();
                            break;
                    }
                });

                function handleDocCreated(data) {
                    console.log('handleDocCreated received:', data);
                    const url = data?.url;
                    if (!url) {
                        console.error('❌ No URL in data or data is undefined:', data);
                        return;
                    }
                    const key = url.split('/').pop();
                    docKey = key;
                    editor.disabled = false;
                    editor.value = '';
                    urlDiv.textContent = \`Document URL: ?docKey=\${key}\`;
                    connectWebSocket(key);
                }

                function handleDocFetched(doc) {
                    console.log('handleDocFetched received:', doc);
                    docKey = doc.linkKey;
                    editor.disabled = false;
                    editor.value = doc.content || '';
                    urlDiv.textContent = 'Document URL: ?docKey=' + docKey;
                    connectWebSocket(docKey);
                }

                function handleBackendError() {
                    editor.disabled = true;
                    urlDiv.textContent = 'Backend error. Please try again.';
                }

                function connectWebSocket(key) {
                    if (stompClient) {
                        stompClient.deactivate();
                    }
                    stompClient = new StompJs.Client({
                        webSocketFactory: () => new SockJS(WS_URL),
                        reconnectDelay: 5000,
                        heartbeatIncoming: 0,
                        heartbeatOutgoing: 20000,
                    });

                    stompClient.onConnect = () => {
                        console.log('✅ Connected to WebSocket');
                        stompClient.subscribe('/topic/docs/' + key, msg => {
                            const { content } = JSON.parse(msg.body);
                            editor.value = content;
                        });
                    };

                    stompClient.onStompError = frame => {
                        console.error('❌ STOMP error:', frame.headers['message'], frame.body);
                    };

                    stompClient.activate();
                }
            </script>
        </body>
        </html>
        `;
    }

    // ---- Backend functions ----

    private async createDocument() {
        console.log('✅ createDocument called');
        try {
            const response = await fetch(`${this.API_BASE_URL}/docs`, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'create' })  // match index.html
            });
            const data = await response.json();
            console.log('✅ Document created response FULL:', JSON.stringify(data));

            // Post data back to webview
            this._panel.webview.postMessage({ type: 'docCreated', data: data });
            console.log('✅ Document created and sent to webview');
        } catch (error) {
            console.error('❌ Error creating document:', error);
            this._panel.webview.postMessage({ type: 'backendError' });
        }
    }

    private async fetchDocument(key: string) {
        console.log('✅ fetchDocument called with key:', key);
        try {
            const response = await fetch(`${this.API_BASE_URL}/docs?requestType=getDoc&key=${key}`);
            const data = await response.json();
            this._panel.webview.postMessage({ type: 'docFetched', data: data });
            console.log('✅ Document fetched and sent to webview');
        } catch (error) {
            console.error('❌ Error fetching document:', error);
            this._panel.webview.postMessage({ type: 'backendError' });
        }
    }
}
