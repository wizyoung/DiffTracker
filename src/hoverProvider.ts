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

        // Find changes for this line (1-based)
        const lineNumber = position.line + 1;
        const changesForLine = lineChanges.filter(c => c.lineNumber === lineNumber);
        const deletedChangesForAnchor = lineChanges.filter(c => {
            if (c.type !== 'deleted') {
                return false;
            }

            const anchorLine = Math.min(Math.max(c.lineNumber - 1, 1), document.lineCount);
            return anchorLine === lineNumber;
        });

        if (changesForLine.length === 0 && deletedChangesForAnchor.length === 0) {
            return null;
        }

        let hoverText = '';

        const deletedTexts = deletedChangesForAnchor
            .filter(c => c.type === 'deleted' && c.oldText !== undefined)
            .map(c => c.oldText === '' ? '(empty line)' : c.oldText as string);

        const addedTexts = changesForLine
            .filter(c => c.type === 'added' && c.newText !== undefined)
            .map(c => c.newText === '' ? '(empty line)' : c.newText as string);

        const modifiedOld = changesForLine
            .filter(c => c.type === 'modified' && c.oldText !== undefined)
            .map(c => c.oldText === '' ? '(empty line)' : c.oldText as string);

        const modifiedNew = changesForLine
            .filter(c => c.type === 'modified' && c.newText !== undefined)
            .map(c => c.newText === '' ? '(empty line)' : c.newText as string);

        if (deletedTexts.length > 0) {
            hoverText = `**Deleted (${deletedTexts.length} line(s)):**\n\`\`\`\n${deletedTexts.join('\n')}\n\`\`\``;
        } else if (modifiedOld.length > 0 || modifiedNew.length > 0) {
            const oldBlock = modifiedOld.length > 0 ? modifiedOld.join('\n') : '';
            const newBlock = modifiedNew.length > 0 ? modifiedNew.join('\n') : '';
            hoverText = `**Modified:**\n\n**Old:**\n\`\`\`\n${oldBlock}\n\`\`\`\n\n**New:**\n\`\`\`\n${newBlock}\n\`\`\``;
        } else if (addedTexts.length > 0) {
            hoverText = `**Added (${addedTexts.length} line(s)):**\n\`\`\`\n${addedTexts.join('\n')}\n\`\`\``;
        }

        if (hoverText) {
            return new vscode.Hover(new vscode.MarkdownString(hoverText));
        }

        return null;
    }
}
