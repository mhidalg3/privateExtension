/**
 * This script enhances the Inlyne editor with better error handling, status indicators,
 * and WebSocket connection monitoring.
 * 
 * It should be loaded in the webview to provide the UI enhancements.
 */

// Initialize connection status UI
function initConnectionUI() {
  // Check if we're in the editor view
  const statusBar = document.querySelector('.status-bar');
  if (!statusBar) return; // Not in editor view
  
  // Get UI elements
  const indicator = document.getElementById('connection-indicator');
  const statusText = document.getElementById('connection-status-text');
  
  // Start with disconnected state
  updateConnectionStatus('disconnected');
  
  // Add message listener to receive status updates from React component
  window.addEventListener('message', event => {
    const message = event.data;
    if (message && message.type === 'connectionStatusChanged') {
      updateConnectionStatus(message.status);
    }
    
    if (message && message.type === 'editorDocLoaded') {
      updateDocumentInfo(message.key);
      showToast('Document loaded: ' + message.key);
    }
  });
}

/**
 * Updates the connection status indicator
 * @param {string} status - 'connected', 'connecting', 'disconnected' or 'error'
 */
function updateConnectionStatus(status) {
  const indicator = document.getElementById('connection-indicator');
  const statusText = document.getElementById('connection-status-text');
  if (!indicator || !statusText) return;
  
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

/**
 * Updates the document info display
 * @param {string} docKey - Document key
 */
function updateDocumentInfo(docKey) {
  const docInfo = document.getElementById('document-info');
  if (!docInfo) return;
  
  if (docKey) {
    docInfo.textContent = 'Document: ' + docKey;
  } else {
    docInfo.textContent = 'No document loaded';
  }
}

/**
 * Shows a toast message
 * @param {string} message - Message to display
 * @param {number} duration - Duration in ms
 */
function showToast(message, duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, duration);
}

// Initialize UI when document is ready
document.addEventListener('DOMContentLoaded', () => {
  initConnectionUI();
});
