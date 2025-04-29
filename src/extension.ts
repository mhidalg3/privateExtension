import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	console.log('Inlyne is now active!');

	// “Hello World” command
	const hello = vscode.commands.registerCommand('inlyne.helloWorld', () =>
		vscode.window.showInformationMessage('Hello World from Inlyne!')
	);
	context.subscriptions.push(hello);

	// Sidebar provider
	const provider = new InlyneSidebarProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			InlyneSidebarProvider.viewType,
			provider
		)
	);
}

export function deactivate() {}

class InlyneSidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'inlyne.sidebarView';
	private _view?: vscode.WebviewView;

	constructor(private readonly _extensionUri: vscode.Uri) {}

	resolveWebviewView(
		view: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = view;

		view.webview.options = {
			enableScripts: true,
		};

		view.webview.html = this.getWebviewContent(view.webview);
	}

// weview with the tip tap editor
	private getWebviewContent(webview: vscode.Webview): string {
		const csp = /* html */ `
			default-src 'none';
			style-src 'unsafe-inline' https:;
			script-src 'unsafe-inline' https:;
			img-src https: data:;
			font-src https:;
		`;

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Inlyne Editor</title>
	<style>
		body { padding: 0; margin: 0; font-family: sans-serif; }
		#editor {
			min-height: 100vh;
			padding: 1rem;
			box-sizing: border-box;
			outline: none;

      border: 1px solid #fff;  // border
		}
		/* Basic prose-style defaults */
		#editor h1, #editor h2, #editor h3 { margin: 0.5em 0; }
		#editor p { margin: 0.5em 0; line-height: 1.4; }
		#editor ul, #editor ol { padding-left: 2rem; }
		#editor blockquote {
			border-left: 3px solid #999;
			margin-left: 0; padding-left: 1rem; color: #666;
		}
	</style>
</head>
<body>
  <h1>Inlyne Editor</h1>
	<div id="editor"></div>

	<script type="module">
		import { Editor } from 'https://esm.sh/@tiptap/core@2';
		import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2';

		const editor = new Editor({
			element: document.getElementById('editor'),
			extensions: [StarterKit],
			content: '<p>Hello, start writing…</p>',
		});

		// Optional: send the current document back to the extension when it changes
		/*
		editor.on('update', () => {
			const html = editor.getHTML();
			vscode.postMessage({ type: 'contentUpdate', html });
		});
		*/

		// VS Code API inside the webview
		const vscode = acquireVsCodeApi();
	</script>
</body>
</html>`;
	}
}
