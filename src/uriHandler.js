import * as vscode from 'vscode';
import { InlyneSidebarProvider } from './extension';
export class InlyneUriHandler {
    constructor(context) {
        this.context = context;
    }
    handleUri(uri) {
        var _a;
        // e.g. deep-link redirect: inlyne://auth?token=XYZ
        if (uri.path === '/auth') {
            const token = new URLSearchParams(uri.query).get('token');
            if (token) {
                this.context.globalState.update('inlyneToken', token);
                vscode.window.showInformationMessage('Signed in successfully!');
                // tell the sidebar about our new token
                (_a = InlyneSidebarProvider.currentView) === null || _a === void 0 ? void 0 : _a.webview.postMessage({
                    type: 'authChanged',
                    token
                });
            }
        }
    }
}
