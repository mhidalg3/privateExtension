import * as vscode from 'vscode';

// Webview View Provider for the sidebar
class InlyneSidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'inlyne.sidebarView';
	private _view?: vscode.WebviewView;

	constructor(private readonly _extensionUri: vscode.Uri) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
		};

		webviewView.webview.html = this.getWebviewContent();
	}

	private getWebviewContent(): string {
		return `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<title>Inlyne Sidebar</title>
				<style>
					body {
						font-family: sans-serif;
						padding: 1em;
					}
				</style>
			</head>
			<body>
				<h2>HELLO SIDEBAR</h2>
				<p>SIGMA BOY</p>
			</body>
			</html>
		`;
	}
}

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "inlyne" is now active!');

	// Hello World command
	const helloCommand = vscode.commands.registerCommand('inlyne.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Inlyne!');
	});
	context.subscriptions.push(helloCommand);

	// Register the sidebar provider
	const sidebarProvider = new InlyneSidebarProvider(context.extensionUri);
	context.subscriptions.push(
  		vscode.window.registerWebviewViewProvider(InlyneSidebarProvider.viewType, sidebarProvider)
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}

