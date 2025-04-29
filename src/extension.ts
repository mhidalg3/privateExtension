import * as vscode from 'vscode';
import fetch from 'node-fetch';

export function activate(context: vscode.ExtensionContext) {
    const provider = new InlyneSidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(InlyneSidebarProvider.viewType, provider)
    );
}

class InlyneSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'inlyne.sidebarView';
    private _view?: vscode.WebviewView;
    private readonly API_BASE_URL = 'http://localhost:8080'; 

    constructor(private readonly _extensionUri: vscode.Uri) {}

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
        };

        webviewView.webview.html = this.getWebviewContent();

        // Listen for messages from the Webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
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
    }

    private async createDocument() {
        try {
            const response = await fetch(`${this.API_BASE_URL}/docs`, { method: 'POST' });
            const data = await response.json();
            this._view?.webview.postMessage({ type: 'docCreated', data: data });
        } catch (error) {
            console.error('Error creating document:', error);
            this._view?.webview.postMessage({ type: 'backendError' });
        }
    }

    private async fetchDocument(key: string) {
        try {
            const response = await fetch(`${this.API_BASE_URL}/docs/${key}`);
            const data = await response.json();
            this._view?.webview.postMessage({ type: 'docFetched', data: data });
        } catch (error) {
            console.error('Error fetching document:', error);
            this._view?.webview.postMessage({ type: 'backendError' });
        }
    }

    private getWebviewContent(): string {
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Inlyne Sidebar</title>
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

                createBtn.addEventListener('click', () => {
                    vscode.postMessage({ type: 'createDoc' });
                });

                loadBtn.addEventListener('click', () => {
                    const key = docKeyInput.value.trim();
                    if (key) {
                        vscode.postMessage({ type: 'fetchDoc', key: key });
                    }
                });

                editor.addEventListener('input', () => {
                    if (stompClient?.active && docKey) {
                        stompClient.publish({
                            destination: '/app/edit/' + docKey,
                            body: JSON.stringify({ content: editor.value }),
                        });
                    }
                });

                window.addEventListener('message', event => {
                    const message = event.data;
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
                    const url = data.url;
                    docKey = url.split('/').pop();
                    editor.disabled = false;
                    editor.value = '';
                    urlDiv.textContent = 'Document URL: ?docKey=' + docKey;
                    connectWebSocket(docKey);
                }

                function handleDocFetched(doc) {
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
}