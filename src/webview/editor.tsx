// src/webview/editor.tsx
// Ensure global is defined - this is important for libraries that expect Node.js environment
if (typeof window !== 'undefined' && typeof window.global === 'undefined') {
  window.global = window;
}

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import RichTextEditor from '../components/RichTextEditor'; 
// Import without extension, webpack config resolves .tsx files

declare global {
  interface Window {
    __INITIAL_CONTENT__: string;
    __INITIAL_DOCKEY__: string;
    acquireVsCodeApi: any;
    global: Window & typeof globalThis;
  }
}

// APP
function App() {
  const [content, setContent] = React.useState<string>(window.__INITIAL_CONTENT__ || '');
  const [docKey, setDocKey]     = React.useState<string>(window.__INITIAL_DOCKEY__ || '');

  React.useEffect(() => {
    // Use the VS Code API that was already acquired in the HTML template
    // instead of calling acquireVsCodeApi() again
    function onMessage(event: MessageEvent) {
      const msg = event.data;
      if (msg.type === 'editorDocLoaded') {
        console.log('Editor received editorDocLoaded message:', msg);
        if (typeof msg.key === 'string') {
          console.log('Updating docKey to:', msg.key);
          setDocKey(msg.key);
        }
        if (typeof msg.content === 'string') {
          // Ensure content is updated when a new document is loaded
          console.log('Updating content, length:', msg.content.length);
          setContent(msg.content);
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <RichTextEditor
      key={docKey}
      content={content}
      docKey={docKey}
      onChange={(html: string) => {
        // Don't call acquireVsCodeApi again, use the vscode instance
        // that was already created in the HTML template
        const vscode = (window as any).vscode;
        if (vscode) {
          vscode.postMessage({
            type: 'contentUpdate',
            docKey,
            content: html
          });
        }
      }}
    />
  );
}

// Add error tracking
try {
  console.log('Editor initializing...');
  window.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('root');
    if (!container) {
      console.error('Root container not found in DOM');
      return;
    }
    console.log('Root container found, creating React root');
    const root = createRoot(container);
    root.render(<App />);
    console.log('RichTextEditor (App) rendered successfully');
  });
} catch (error) {
  console.error('Global initialization error:', error);
}
