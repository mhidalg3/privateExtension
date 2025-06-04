import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import MenuBar from './Menubar';  // Make sure this exactly matches the case of the file
import './editor-styles.css'; // Import theme-aware editor styles
import ThemeTester from './ThemeTester'; // Import the theme tester component
import { isDarkTheme as checkIsDarkTheme, getThemeTextColor } from './ThemeColorUtils'; // Import theme utilities

import SockJS from 'sockjs-client';
import { Client, IMessage, Frame } from '@stomp/stompjs';

// Since process.env isn't replaced in our bundler, hard‐code the base URL:
const API_BASE = 'https://api.inlyne.link';
const WS_URL   = `${API_BASE}/ws`;

// Simple debounce utility
const debounce = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function(this: any, ...args: Parameters<F>) {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func.apply(this, args), waitFor);
  };
};

interface RichTextEditorProps {
  content: string;
  docKey: string;
  onChange?: (html: string) => void;
}

/**
 * TiptapEditor Component with WebSocket sync
 */
const RichTextEditor: React.FC<RichTextEditorProps> = ({ 
  content, 
  docKey, 
  onChange 
}) => {
  const stompClientRef = useRef<Client | null>(null);
  const preventNextSync = useRef<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<string>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(
    document.body.classList.contains('vscode-dark')
  );
  // State for theme tester visibility (for testing color handling)
  const [showThemeTester, setShowThemeTester] = useState<boolean>(false);

  // Create debounced version of content update function
  const debouncedPublish = useCallback(
    debounce((html: string) => {
      if (stompClientRef.current?.active && docKey) {
        console.log('Publishing debounced update to WebSocket');
        stompClientRef.current.publish({
          destination: `/app/edit/${docKey}`,
          body: JSON.stringify({ content: html }),
        });
      }
    }, 750), // 750ms debounce time
    [docKey]
  );

  // Initialize TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      TextStyle.extend({
        addAttributes() {
          return {
            fontSize: {
              default: null,
              parseHTML: element => element.style.fontSize || null,
              renderHTML: attributes => {
                if (!attributes.fontSize) return {};
                return {
                  style: `font-size: ${attributes.fontSize}`,
                };
              },
            },
          };
        },
      }),
      Color,
      Highlight,
      Image,
      Placeholder.configure({
        placeholder: 'Type something...',
      }),
    ],
    content,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      
      // Prevent echo when content was just set from a WebSocket message
      if (preventNextSync.current) {
        preventNextSync.current = false;
        return;
      }

      // Send to parent (outer VSCode extension) immediately
      onChange?.(html);

      // Send to WebSocket with debounce
      debouncedPublish(html);
    },
  });
  
  // Update editor content when the content prop changes
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      console.log('Content prop changed, updating editor content');
      console.log('New content length:', content.length, 'Current editor content length:', editor.getHTML().length);
      
      // Set flag to prevent echo back to server
      preventNextSync.current = true;
      
      // Update the editor with new content
      editor.commands.setContent(content);
      
      // Ensure the cursor is at the beginning after content change
      setTimeout(() => {
        editor.commands.focus('start');
      }, 0);
    }
  }, [content, editor]);
  
  // Listen for VS Code theme changes with enhanced detection using our utility functions
  useEffect(() => {
    // Enhanced theme change handler
    const handleThemeChange = (e: any) => {
      // Get theme from event, utility function, or fallback to body class
      const isDark = e.detail?.isDarkTheme !== undefined 
        ? e.detail.isDarkTheme 
        : checkIsDarkTheme();
      
      setIsDarkTheme(isDark);
      console.log('Theme changed:', isDark ? 'dark' : 'light');
      
      // Update document body classes to match
      document.body.classList.toggle('vscode-dark', isDark);
      document.body.classList.toggle('vscode-light', !isDark);
      
      // Apply theme-specific classes to editor container
      const editorContainer = document.querySelector('.ProseMirror')?.parentElement;
      if (editorContainer) {
        editorContainer.classList.toggle('vscode-dark-editor', isDark);
        editorContainer.classList.toggle('vscode-light-editor', !isDark);
        
        // Set the theme foreground color as a CSS variable for easy reference
        (editorContainer as HTMLElement).style.setProperty(
          '--theme-foreground-color', 
          getThemeTextColor()
        );
      }
      
      // Apply theme-specific classes to the editor content
      const editorContent = document.querySelector('.ProseMirror') as HTMLElement | null;
      if (editorContent) {
        editorContent.classList.toggle('vscode-dark', isDark);
        editorContent.classList.toggle('vscode-light', !isDark);
        
        // Force re-render of text colors by temporarily modifying and restoring a property
        const originalDisplay = editorContent.style.display;
        editorContent.style.display = 'none';
        setTimeout(() => {
          editorContent.style.display = originalDisplay;
        }, 10);
      }
      
      // Notify parent window about theme change if needed
      try {
        if ((window as any).vscode) {
          (window as any).vscode.postMessage({
            type: 'themeChanged',
            isDarkTheme: isDark
          });
        }
      } catch (e) {
        console.warn('Could not notify parent window about theme change:', e);
      }
    };
    
    // Check for theme on mount - first from localStorage, then from document
    let isDark = false;
    try {
      // Try to get saved theme preference
      const savedTheme = localStorage.getItem('vscode-theme');
      if (savedTheme === 'dark' || savedTheme === 'light') {
        isDark = savedTheme === 'dark';
      } else {
        // Default to document detection
        isDark = document.body.classList.contains('vscode-dark');
      }
    } catch (e) {
      // Fallback to document detection
      isDark = document.body.classList.contains('vscode-dark');
    }
    
    // Initialize theme
    handleThemeChange({ detail: { isDarkTheme: isDark }});
    
    // Listen for custom theme change events
    const rootElement = document.getElementById('root');
    if (rootElement) {
      rootElement.addEventListener('vscode-theme-changed', handleThemeChange);
    }
    
    // Additionally listen for VS Code theme changes via class changes on body
    const bodyObserver = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        if (mutation.attributeName === 'class') {
          const isDark = document.body.classList.contains('vscode-dark');
          handleThemeChange({ detail: { isDarkTheme: isDark }});
        }
      });
    });
    
    bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
    
    // Cleanup
    return () => {
      if (rootElement) {
        rootElement.removeEventListener('vscode-theme-changed', handleThemeChange);
      }
      bodyObserver.disconnect();
    };
  }, []);

  // Notify parent VSCode for status updates
  const notifyStatusChange = useCallback((status: string) => {
    try {
      // Use the global vscode instance instead of calling acquireVsCodeApi again
      if ((window as any).vscode) {
        (window as any).vscode.postMessage({
          type: 'connectionStatusChanged',
          status
        });
      }
      
      // Also try to update UI directly if elements exist
      try {
        if (typeof document !== 'undefined') {
          const updateConnectionStatus = (window as any).updateConnectionStatus;
          if (typeof updateConnectionStatus === 'function') {
            updateConnectionStatus(status);
          }
        }
      } catch (e) {
        console.warn('Could not update status UI directly:', e);
      }
    } catch (e) {
      console.warn('Error notifying status change:', e);
    }
  }, []);

  // Connect WebSocket when component mounts or docKey changes
  useEffect(() => {
    if (!docKey || !editor) return;

    // Update document info if the function exists in the parent window
    try {
      if (typeof (window as any).updateDocumentInfo === 'function') {
        (window as any).updateDocumentInfo(docKey);
      }
    } catch (e) {
      console.warn('Could not update document info:', e);
    }

    // Cleanup previous connection
    if (stompClientRef.current) {
      stompClientRef.current.deactivate();
    }

    // Reset state
    setConnectionStatus('connecting');
    notifyStatusChange('connecting');
    setErrorMessage(null);

    // Create new STOMP client with better reconnection settings
    const client = new Client({
      webSocketFactory: () => new SockJS(WS_URL),
      reconnectDelay: 1000, // Reconnect faster
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      debug: msg => console.debug('STOMP:', msg),
      connectionTimeout: 10000
    });

    // Configure WebSocket handlers
    client.onConnect = () => {
      console.log('Connected to WebSocket');
      setConnectionStatus('connected');
      notifyStatusChange('connected');
      setErrorMessage(null);
      
      // Show a toast message if available
      try {
        if (typeof (window as any).showToast === 'function') {
          (window as any).showToast('Connected to server');
        }
      } catch (e) {
        console.warn('Could not show toast:', e);
      }
      
      // Subscribe to updates for this document
      client.subscribe(`/topic/docs/${docKey}`, (message: IMessage) => {
        try {
          const { content } = JSON.parse(message.body);
          if (content && editor.getHTML() !== content) {
            // Set flag to prevent echo
            preventNextSync.current = true;
            editor.commands.setContent(content);
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message', e);
          setErrorMessage(`Failed to parse message: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    };

    client.onStompError = (frame: Frame) => {
      console.error('STOMP error', frame.headers.message);
      setConnectionStatus('error');
      notifyStatusChange('error');
      setErrorMessage(`STOMP error: ${frame.headers.message}`);
    };

    client.onWebSocketClose = () => {
      console.warn('WebSocket connection closed');
      setConnectionStatus('disconnected');
      notifyStatusChange('disconnected');
    };

    client.onWebSocketError = (event) => {
      console.error('WebSocket error', event);
      setConnectionStatus('error');
      notifyStatusChange('error');
      setErrorMessage('WebSocket connection error. Check your network connection.');
    };

    // Start connection
    client.activate();
    stompClientRef.current = client;

    // Cleanup when component unmounts or docKey changes
    return () => {
      if (stompClientRef.current) {
        stompClientRef.current.deactivate();
      }
    };
  }, [docKey, editor]); // Re-run when docKey or editor changes

  // Handle case where editor isn't loaded yet
  if (!editor) {
    return <div>Loading editor...</div>;
  }

  return (
    <div className={`rich-text-editor ${isDarkTheme ? 'vscode-dark' : 'vscode-light'}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <MenuBar editor={editor} isDarkTheme={isDarkTheme} />
        <button 
          onClick={() => setShowThemeTester(prev => !prev)} 
          title="Test Theme Colors"
          style={{
            background: '#EC6D26',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '4px 8px',
            marginRight: '10px',
            fontSize: '12px',
            cursor: 'pointer'
          }}
        >
          {showThemeTester ? 'Hide Theme Tester' : 'Test Theme Colors'}
        </button>
      </div>
      
      {connectionStatus === 'error' && errorMessage && (
        <div className="connection-error">
          <p>{errorMessage}</p>
          <button onClick={() => {
            if (stompClientRef.current) {
              stompClientRef.current.deactivate();
              stompClientRef.current.activate();
              setConnectionStatus('connecting');
            }
          }}>
            Reconnect
          </button>
        </div>
      )}
      {connectionStatus === 'connecting' && (
        <div className="connection-status">Connecting to server...</div>
      )}
      <EditorContent editor={editor} className="editor-content" />
      
      {/* Theme Tester component for verifying color handling */}
      <ThemeTester 
        isDarkTheme={isDarkTheme} 
        onToggleTheme={() => setIsDarkTheme(prev => !prev)} 
        show={showThemeTester}
        onRequestClose={() => setShowThemeTester(false)}
      />
    </div>
  );
};

// Additional CSS for the editor
const styles = `
.rich-text-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: white;
}

.editor-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 2rem; /* Moderate horizontal padding for balanced spacing */
  border: 1px solid #EC6D26; /* Adding orange border to match the styling */
  border-radius: 4px; /* Rounded corners for a nicer look */
  margin: 0 1rem 1rem 1rem; /* Add margin around the editor content */
}

.connection-error {
  background-color: #fee;
  color: #c00;
  padding: 0.75rem;
  margin: 0.5rem;
  border-radius: 4px;
  font-size: 0.9rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.connection-error button {
  background-color: #c00;
  color: white;
  border: none;
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  cursor: pointer;
}

.connection-status {
  background-color: #fffde7;
  padding: 0.5rem;
  text-align: center;
  font-size: 0.9rem;
  color: #856404;
}

.ProseMirror {
  min-height: 100%;
  outline: none;
}

.ProseMirror p {
  margin-bottom: 1em;
}

.ProseMirror h1, .ProseMirror h2, .ProseMirror h3 {
  margin-top: 1em;
  margin-bottom: 0.5em;
}

.ProseMirror img {
  max-width: 100%;
  height: auto;
}

.ProseMirror[data-placeholder]::before {
  content: attr(data-placeholder);
  color: #aaa;
  pointer-events: none;
  position: absolute;
}

.ProseMirror mark {
  background-color: #ffe066;
}
`;

export default RichTextEditor;

