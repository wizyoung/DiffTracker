import * as vscode from 'vscode';
import { DiffTracker } from './diffTracker';

export class DecorationManager {
    private addedDecorationType: vscode.TextEditorDecorationType;
    private deletedDecorationType: vscode.TextEditorDecorationType;
    private modifiedDecorationType: vscode.TextEditorDecorationType;

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

        const filePath = editor.document.uri.fsPath;
        const lineChanges = this.diffTracker.getLineChanges(filePath);

        if (!lineChanges) {
            this.clearDecorations(editor);
            return;
        }

        const addedRanges: vscode.Range[] = [];
        const deletedRanges: vscode.Range[] = [];
        const modifiedRanges: vscode.Range[] = [];

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
                    deletedRanges.push(range);
                    break;
                case 'modified':
                    modifiedRanges.push(range);
                    break;
            }
        });

        editor.setDecorations(this.addedDecorationType, addedRanges);
        editor.setDecorations(this.deletedDecorationType, deletedRanges);
        editor.setDecorations(this.modifiedDecorationType, modifiedRanges);
    }

    public clearDecorations(editor: vscode.TextEditor) {
        editor.setDecorations(this.addedDecorationType, []);
        editor.setDecorations(this.deletedDecorationType, []);
        editor.setDecorations(this.modifiedDecorationType, []);
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
    }
}
