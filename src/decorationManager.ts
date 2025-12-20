import * as vscode from 'vscode';
import { DiffTracker } from './diffTracker';

export class DecorationManager {
    private addedDecorationType: vscode.TextEditorDecorationType;
    private deletedDecorationType: vscode.TextEditorDecorationType;
    private modifiedDecorationType: vscode.TextEditorDecorationType;
    private deletedBadgeDecorationType: vscode.TextEditorDecorationType;

    constructor(private diffTracker: DiffTracker) {
        // Green background for added lines
        this.addedDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(63, 185, 80, 0.25)',
            isWholeLine: true,
            overviewRulerColor: 'rgba(63, 185, 80, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: this.createGutterIcon('+', '#3fb950'),
            gutterIconSize: 'contain'
        });

        // Red background for deleted lines
        this.deletedDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(248, 81, 73, 0.25)',
            isWholeLine: true,
            overviewRulerColor: 'rgba(248, 81, 73, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: this.createGutterIcon('-', '#f85149'),
            gutterIconSize: 'contain'
        });

        // Yellow background for modified lines
        this.modifiedDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(187, 128, 9, 0.25)',
            isWholeLine: true,
            overviewRulerColor: 'rgba(187, 128, 9, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: this.createGutterIcon('~', '#bb8009'),
            gutterIconSize: 'contain'
        });

        this.deletedBadgeDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                color: '#f85149',
                backgroundColor: 'rgba(248, 81, 73, 0.18)',
                fontStyle: 'italic',
                textDecoration: 'none; margin-left: 12px; padding: 0 6px; border-radius: 3px;'
            }
        });
    }

    private createGutterIcon(symbol: string, color: string): vscode.Uri {
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
                <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" 
                      font-family="monospace" font-size="14" font-weight="bold" fill="${color}">
                    ${symbol}
                </text>
            </svg>
        `;
        return vscode.Uri.parse('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
    }

    public updateDecorations(editor: vscode.TextEditor) {
        if (!this.diffTracker.getIsRecording()) {
            this.clearDecorations(editor);
            return;
        }

        if (this.isEditorInDiffView(editor)) {
            this.clearDecorations(editor);
            return;
        }

        if (editor.document.uri.scheme === 'diff-tracker-inline') {
            this.updateInlineDecorations(editor);
            return;
        }

        const filePath = editor.document.uri.fsPath;
        const lineChanges = this.diffTracker.getLineChanges(filePath);

        if (!lineChanges) {
            this.clearDecorations(editor);
            return;
        }

        const addedRanges: vscode.Range[] = [];
        const modifiedRanges: vscode.Range[] = [];
        const deletedBadgeRanges: vscode.DecorationOptions[] = [];
        const deletedCountByLine = new Map<number, number>();

        lineChanges.forEach(change => {
            const line = change.lineNumber - 1;
            if (line < 0 || line >= editor.document.lineCount) {
                return;
            }

            const range = new vscode.Range(line, 0, line, Number.MAX_VALUE);

            switch (change.type) {
                case 'added':
                    addedRanges.push(range);
                    break;
                case 'deleted':
                    {
                        const anchorLine = Math.max(change.lineNumber - 1, 1);
                        const safeLine = Math.min(anchorLine, editor.document.lineCount);
                        const currentCount = deletedCountByLine.get(safeLine) || 0;
                        deletedCountByLine.set(safeLine, currentCount + 1);
                    }
                    break;
                case 'modified':
                    modifiedRanges.push(range);
                    break;
            }
        });

        deletedCountByLine.forEach((count, lineNumber) => {
            if (count <= 0 || editor.document.lineCount === 0) {
                return;
            }

            const lineIndex = Math.min(Math.max(lineNumber, 1), editor.document.lineCount) - 1;
            const line = editor.document.lineAt(lineIndex);
            const label = count === 1 ? '- 1 line deleted' : `- ${count} lines deleted`;

            deletedBadgeRanges.push({
                range: new vscode.Range(line.range.end, line.range.end),
                renderOptions: {
                    after: {
                        contentText: label
                    }
                }
            });
        });

        editor.setDecorations(this.addedDecorationType, addedRanges);
        editor.setDecorations(this.modifiedDecorationType, modifiedRanges);
        editor.setDecorations(this.deletedDecorationType, []);
        editor.setDecorations(this.deletedBadgeDecorationType, deletedBadgeRanges);
    }

    public clearDecorations(editor: vscode.TextEditor) {
        editor.setDecorations(this.addedDecorationType, []);
        editor.setDecorations(this.deletedDecorationType, []);
        editor.setDecorations(this.modifiedDecorationType, []);
        editor.setDecorations(this.deletedBadgeDecorationType, []);
    }

    public clearAllDecorations() {
        vscode.window.visibleTextEditors.forEach(editor => {
            this.clearDecorations(editor);
        });
    }

    public dispose() {
        this.addedDecorationType.dispose();
        this.deletedDecorationType.dispose();
        this.modifiedDecorationType.dispose();
        this.deletedBadgeDecorationType.dispose();
    }

    private updateInlineDecorations(editor: vscode.TextEditor) {
        const filePath = editor.document.uri.fsPath;
        const lineTypes = this.diffTracker.getInlineLineTypes(filePath);

        if (!lineTypes) {
            this.clearDecorations(editor);
            return;
        }

        const addedRanges: vscode.Range[] = [];
        const deletedRanges: vscode.Range[] = [];
        const lineCount = editor.document.lineCount;
        const total = Math.min(lineTypes.length, lineCount);

        for (let i = 0; i < total; i++) {
            const type = lineTypes[i];
            if (type === 'added') {
                addedRanges.push(new vscode.Range(i, 0, i, Number.MAX_VALUE));
            } else if (type === 'deleted') {
                deletedRanges.push(new vscode.Range(i, 0, i, Number.MAX_VALUE));
            }
        }

        editor.setDecorations(this.addedDecorationType, addedRanges);
        editor.setDecorations(this.deletedDecorationType, deletedRanges);
        editor.setDecorations(this.modifiedDecorationType, []);
    }

    private isEditorInDiffView(editor: vscode.TextEditor): boolean {
        const targetUri = editor.document.uri.toString();

        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const input = tab.input;
                if (input instanceof vscode.TabInputTextDiff) {
                    if (input.original.toString() === targetUri || input.modified.toString() === targetUri) {
                        return true;
                    }
                }
            }
        }

        return false;
    }
}
