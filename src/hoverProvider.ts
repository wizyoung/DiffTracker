import * as vscode from 'vscode';
import { DiffTracker } from './diffTracker';

export class DiffHoverProvider implements vscode.HoverProvider {
    constructor(private diffTracker: DiffTracker) { }

    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        if (!this.diffTracker.getIsRecording()) {
            return null;
        }

        const filePath = document.uri.fsPath;
        const lineChanges = this.diffTracker.getLineChanges(filePath);

        if (!lineChanges) {
            return null;
        }

        // Find change for this line (1-based)
        const lineNumber = position.line + 1;
        const change = lineChanges.find(c => c.lineNumber === lineNumber);

        if (!change) {
            return null;
        }

        let hoverText = '';

        switch (change.type) {
            case 'deleted':
                if (change.oldText) {
                    hoverText = `**Deleted:**\n\`\`\`\n${change.oldText}\n\`\`\``;
                }
                break;
            case 'modified':
                if (change.oldText && change.newText) {
                    hoverText = `**Modified:**\n\n**Old:**\n\`\`\`\n${change.oldText}\n\`\`\`\n\n**New:**\n\`\`\`\n${change.newText}\n\`\`\``;
                }
                break;
            case 'added':
                if (change.newText) {
                    hoverText = `**Added:**\n\`\`\`\n${change.newText}\n\`\`\``;
                }
                break;
        }

        if (hoverText) {
            return new vscode.Hover(new vscode.MarkdownString(hoverText));
        }

        return null;
    }
}
