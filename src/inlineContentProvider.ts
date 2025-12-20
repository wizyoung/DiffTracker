import * as vscode from 'vscode';
import { DiffTracker } from './diffTracker';

export class InlineContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    constructor(private diffTracker: DiffTracker) {
        this.diffTracker.onDidTrackChanges(() => {
            const changes = this.diffTracker.getTrackedChanges();
            changes.forEach(change => {
                const uri = vscode.Uri.file(change.filePath).with({ scheme: 'diff-tracker-inline' });
                this._onDidChange.fire(uri);
            });
        });
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        const filePath = uri.fsPath || decodeURIComponent(uri.path);
        const content = this.diffTracker.getInlineContent(filePath);
        if (content !== undefined) {
            return content;
        }

        return '// Inline diff not available';
    }

    public dispose() {
        this._onDidChange.dispose();
    }
}
