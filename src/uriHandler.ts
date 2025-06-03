import * as vscode from 'vscode';
import { InlyneSidebarProvider } from './extension.js';

export class InlyneUriHandler implements vscode.UriHandler {
  constructor(private readonly context: vscode.ExtensionContext) {}

  handleUri(uri: vscode.Uri): void {
    // e.g. deep-link redirect: inlyne://auth?token=XYZ
    if (uri.path === '/auth') {
      const token = new URLSearchParams(uri.query).get('token');
      if (token) {
        this.context.globalState.update('inlyneToken', token);
        vscode.window.showInformationMessage('Signed in successfully!');
        // tell the sidebar about our new token
        InlyneSidebarProvider.currentView?.webview.postMessage({
          type: 'authChanged',
          token
        });
      }
    }
  }
}
