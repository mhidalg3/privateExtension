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

// Add error tracking
try {
  console.log('Editor initializing...');
  
  const vscode = window.acquireVsCodeApi(); 
  // Type may be refined, but `any` is fine here.

  const initialContent = window.__INITIAL_CONTENT__ || '';
  const initialKey     = window.__INITIAL_DOCKEY__   || '';
  
  console.log('Editor initialized with key:', initialKey, 'content length:', initialContent.length);

  // Wait for DOM to be ready
  window.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded');
    try {
      const container = document.getElementById('root');
      if (!container) {
        throw new Error('Root container not found in DOM');
      }
      console.log('Root container found, creating React root');
      const root = createRoot(container);
      
      // If there's an error container, hide it once React renders successfully
      const errorContainer = document.getElementById('error-container');
      if (errorContainer) {
        errorContainer.style.display = 'none';
      }

      console.log('About to render RichTextEditor component');
      
      try {
        root.render(
          <React.StrictMode>
            <RichTextEditor
              content={initialContent}
              docKey={initialKey}
              onChange={(html: string) => {
                console.log('Content changed, length:', html.length);
                vscode.postMessage({ type: 'contentUpdate', docKey: initialKey, content: html });
              }}
            />
          </React.StrictMode>
        );
        console.log('RichTextEditor component rendered successfully');
      } catch (error) {
        console.error('Error rendering React component:', error);
        const errorContainer = document.getElementById('error-container');
        if (errorContainer) {
          errorContainer.style.display = 'block';
          errorContainer.innerHTML = '<h3>React Render Error</h3><p>' + 
            (error instanceof Error ? error.message : String(error)) + '</p>';
        }
      }
    } catch (error) {
      console.error('DOM Error:', error);
      const errorContainer = document.getElementById('error-container');
      if (errorContainer) {
        errorContainer.style.display = 'block';
        errorContainer.innerHTML = '<h3>DOM Error</h3><p>' + 
          (error instanceof Error ? error.message : String(error)) + '</p>';
      }
    }
  });
} catch (error) {
  console.error('Global initialization error:', error);
  // We can't access the DOM yet for error container, so just log it
}
