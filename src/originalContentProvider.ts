import * as vscode from 'vscode';
import { DiffTracker } from './diffTracker';

export class OriginalContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    constructor(private diffTracker: DiffTracker) {
        // Listen to changes and notify VS Code to refresh
        this.diffTracker.onDidTrackChanges(() => {
            this._onDidChange.fire(vscode.Uri.parse('diff-tracker-original://'));
        });
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        // URI format: diff-tracker-original:///<file-path>
        const filePath = uri.path;

        // Get original content from snapshots
        const originalContent = this.diffTracker.getOriginalContent(filePath);
        if (originalContent) {
            return originalContent;
        }

        return '// Original content not available';
    }

    public dispose() {
        this._onDidChange.dispose();
    }
}
