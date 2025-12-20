import * as vscode from 'vscode';
import { DiffTracker } from './diffTracker';

export class DecorationManager {
    private addedDecorationType: vscode.TextEditorDecorationType;
    private deletedDecorationType: vscode.TextEditorDecorationType;
    private modifiedDecorationType: vscode.TextEditorDecorationType;
    private deletedBadgeDecorationType: vscode.TextEditorDecorationType;

    constructor(private diffTracker: DiffTracker) {
        // Green background for added lines (lighter shade)
        this.addedDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(63, 185, 80, 0.12)',
            isWholeLine: true,
            overviewRulerColor: 'rgba(63, 185, 80, 0.8)',
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            gutterIconPath: this.createGutterIcon('+', '#3fb950'),
            gutterIconSize: 'contain'
        });

        // Red background for deleted lines (lighter shade)
        this.deletedDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(248, 81, 73, 0.12)',
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

        // Read settings
        const config = vscode.workspace.getConfiguration('diffTracker');
        const showDeletedBadge = config.get<boolean>('showDeletedLinesBadge', true);
        const highlightAdded = config.get<boolean>('highlightAddedLines', true);
        const highlightModified = config.get<boolean>('highlightModifiedLines', true);

        const addedRanges: vscode.Range[] = [];
        const modifiedRanges: vscode.Range[] = [];
        const deletedBadgeRanges: vscode.DecorationOptions[] = [];

        // Build a mapping from originalLineNumber to currentLineNumber for non-deleted lines
        const origToCurrentMap = new Map<number, number>();
        let maxOriginalLine = 0;

        lineChanges.forEach(change => {
            if (change.type !== 'deleted' && change.originalLineNumber !== undefined) {
                origToCurrentMap.set(change.originalLineNumber, change.lineNumber);
                maxOriginalLine = Math.max(maxOriginalLine, change.originalLineNumber);
            }
        });

        // Group consecutive deleted lines by their originalLineNumber
        const deletedGroups: Array<{ originalLines: number[]; }> = [];
        let currentGroup: number[] = [];

        const deletedChanges = lineChanges.filter(c => c.type === 'deleted');
        deletedChanges.sort((a, b) => (a.originalLineNumber || 0) - (b.originalLineNumber || 0));

        deletedChanges.forEach(change => {
            const origLine = change.originalLineNumber || 0;
            if (currentGroup.length === 0) {
                currentGroup.push(origLine);
            } else {
                const lastLine = currentGroup[currentGroup.length - 1];
                if (origLine === lastLine + 1) {
                    // Consecutive
                    currentGroup.push(origLine);
                } else {
                    // Start new group
                    deletedGroups.push({ originalLines: currentGroup });
                    currentGroup = [origLine];
                }
            }
        });
        if (currentGroup.length > 0) {
            deletedGroups.push({ originalLines: currentGroup });
        }

        // For each deleted group, find the anchor line in current document
        deletedGroups.forEach(group => {
            const firstDeletedOrigLine = group.originalLines[0];
            const count = group.originalLines.length;

            // Find the closest preceding line that exists in current document
            let anchorCurrentLine = 0;
            for (let searchOrig = firstDeletedOrigLine - 1; searchOrig >= 1; searchOrig--) {
                if (origToCurrentMap.has(searchOrig)) {
                    anchorCurrentLine = origToCurrentMap.get(searchOrig)!;
                    break;
                }
            }

            // If no preceding line found (deletion at start), anchor to line 1
            if (anchorCurrentLine === 0 && editor.document.lineCount > 0) {
                anchorCurrentLine = 1;
            }

            // Ensure anchor is within bounds
            if (anchorCurrentLine > 0 && anchorCurrentLine <= editor.document.lineCount) {
                const lineIndex = anchorCurrentLine - 1;
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
            }
        });

        lineChanges.forEach(change => {
            const line = change.lineNumber - 1;
            if (line < 0 || line >= editor.document.lineCount) {
                return;
            }

            const range = new vscode.Range(line, 0, line, Number.MAX_VALUE);

            switch (change.type) {
                case 'added':
                    if (highlightAdded) {
                        addedRanges.push(range);
                    }
                    break;
                case 'modified':
                    if (highlightModified) {
                        modifiedRanges.push(range);
                    }
                    break;
            }
        });

        editor.setDecorations(this.addedDecorationType, addedRanges);
        editor.setDecorations(this.modifiedDecorationType, modifiedRanges);
        editor.setDecorations(this.deletedDecorationType, []);
        editor.setDecorations(this.deletedBadgeDecorationType, showDeletedBadge ? deletedBadgeRanges : []);
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
        // Extract original file path (remove (Diff) prefix if present)
        let filePath = editor.document.uri.fsPath;
        const lastSlash = filePath.lastIndexOf('/');
        if (lastSlash !== -1) {
            const dir = filePath.substring(0, lastSlash);
            const fileName = filePath.substring(lastSlash + 1);
            if (fileName.startsWith('(Diff) ')) {
                filePath = dir + '/' + fileName.substring(7);
            }
        }

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
