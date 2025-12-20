import * as vscode from 'vscode';
import * as Diff from 'diff';

export interface FileDiff {
    filePath: string;
    fileName: string;
    originalContent: string;
    currentContent: string;
    changes: Diff.Change[];
    timestamp: Date;
}

export interface LineChange {
    lineNumber: number;  // 1-based line number in current document
    type: 'added' | 'deleted' | 'modified';
    originalLineNumber?: number;  // Original line number for reference
    oldText?: string;  // Original text content (for modified/deleted lines)
    newText?: string;  // New text content (for modified lines)
}

export class DiffTracker {
    private isRecording = false;
    private fileSnapshots = new Map<string, string>();
    private trackedChanges = new Map<string, FileDiff>();
    private lineChanges = new Map<string, LineChange[]>();
    private disposables: vscode.Disposable[] = [];
    private readonly _onDidChangeRecordingState = new vscode.EventEmitter<boolean>();
    private readonly _onDidTrackChanges = new vscode.EventEmitter<void>();

    public readonly onDidChangeRecordingState = this._onDidChangeRecordingState.event;
    public readonly onDidTrackChanges = this._onDidTrackChanges.event;

    constructor() {
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(this.onDocumentChanged, this)
        );
    }

    public startRecording() {
        this.isRecording = true;
        this.fileSnapshots.clear();
        this.trackedChanges.clear();
        this.lineChanges.clear();

        vscode.workspace.textDocuments.forEach(doc => {
            if (doc.uri.scheme === 'file') {
                this.fileSnapshots.set(doc.uri.fsPath, doc.getText());
            }
        });

        this._onDidChangeRecordingState.fire(true);
    }

    public stopRecording() {
        this.isRecording = false;
        this._onDidChangeRecordingState.fire(false);
    }

    public clearDiffs() {
        this.trackedChanges.clear();
        this.lineChanges.clear();
        this._onDidTrackChanges.fire();
    }

    public async revertAllChanges(): Promise<number> {
        const changes = Array.from(this.trackedChanges.values());
        let revertedCount = 0;

        for (const change of changes) {
            try {
                const uri = vscode.Uri.file(change.filePath);
                const doc = await vscode.workspace.openTextDocument(uri);
                const edit = new vscode.WorkspaceEdit();

                // Replace entire document with original content
                const fullRange = new vscode.Range(
                    doc.lineAt(0).range.start,
                    doc.lineAt(doc.lineCount - 1).range.end
                );

                edit.replace(uri, fullRange, change.originalContent);

                const success = await vscode.workspace.applyEdit(edit);
                if (success) {
                    await doc.save();
                    revertedCount++;
                }
            } catch (error) {
                console.error(`Failed to revert ${change.filePath}:`, error);
            }
        }

        // Clear all tracked changes after reverting
        this.clearDiffs();

        return revertedCount;
    }

    public getIsRecording(): boolean {
        return this.isRecording;
    }

    public getTrackedChanges(): FileDiff[] {
        return Array.from(this.trackedChanges.values())
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }

    public getLineChanges(filePath: string): LineChange[] | undefined {
        return this.lineChanges.get(filePath);
    }

    public getOriginalContent(filePath: string): string | undefined {
        return this.fileSnapshots.get(filePath);
    }

    private onDocumentChanged(event: vscode.TextDocumentChangeEvent) {
        if (!this.isRecording) {
            return;
        }

        const doc = event.document;
        if (doc.uri.scheme !== 'file') {
            return;
        }

        const filePath = doc.uri.fsPath;

        // For new files without snapshot, initialize with empty content
        // so all lines show as "added", not "modified"
        if (!this.fileSnapshots.has(filePath)) {
            this.fileSnapshots.set(filePath, '');
            // Continue to process the change below, don't return
        }

        const originalContent = this.fileSnapshots.get(filePath)!;
        const currentContent = doc.getText();

        if (originalContent === currentContent) {
            this.trackedChanges.delete(filePath);
            this.lineChanges.delete(filePath);
            this._onDidTrackChanges.fire();
            return;
        }

        const changes = Diff.diffLines(originalContent, currentContent);

        const fileName = filePath.split('/').pop() || filePath;
        this.trackedChanges.set(filePath, {
            filePath,
            fileName,
            originalContent,
            currentContent,
            changes,
            timestamp: new Date()
        });

        this.calculateLineChanges(filePath, changes);
        this._onDidTrackChanges.fire();
    }

    private calculateLineChanges(filePath: string, changes: Diff.Change[]) {
        const originalContent = this.fileSnapshots.get(filePath)!;
        const currentContent = this.trackedChanges.get(filePath)!.currentContent;

        const originalLines = originalContent.split('\n');
        const currentLines = currentContent.split('\n');

        const arrayDiff = Diff.diffArrays(originalLines, currentLines);

        const lineChangesList: LineChange[] = [];
        let currentLineNumber = 1;
        let originalLineNumber = 1;

        const pendingDeleted: Array<{ text: string, originalLineNum: number }> = [];

        arrayDiff.forEach(change => {
            if (change.removed) {
                // Store all deleted lines
                change.value.forEach((line: string) => {
                    pendingDeleted.push({
                        text: line,
                        originalLineNum: originalLineNumber
                    });
                    originalLineNumber++;
                });
            } else if (change.added) {
                const addedLines = change.value as string[];

                // Pair lines independently based on position and similarity
                const minLength = Math.min(pendingDeleted.length, addedLines.length);
                const pairedIndices = new Set<number>();

                // First pass: pair lines at same position if similar
                for (let i = 0; i < minLength; i++) {
                    const deleted = pendingDeleted[i];
                    const added = addedLines[i];
                    const similarity = this.calculateSimilarity(deleted.text, added);

                    if (similarity > 0.5) {
                        // Treat as modification
                        lineChangesList.push({
                            lineNumber: currentLineNumber,
                            type: 'modified',
                            originalLineNumber: deleted.originalLineNum,
                            oldText: deleted.text,
                            newText: added
                        });
                        currentLineNumber++;
                        pairedIndices.add(i);
                    }
                }

                // Second pass: add unpaired deletions and additions as separate changes
                for (let i = 0; i < pendingDeleted.length; i++) {
                    if (!pairedIndices.has(i)) {
                        const deleted = pendingDeleted[i];
                        lineChangesList.push({
                            lineNumber: currentLineNumber,
                            type: 'deleted',
                            originalLineNumber: deleted.originalLineNum,
                            oldText: deleted.text
                        });
                    }
                }

                for (let i = 0; i < addedLines.length; i++) {
                    if (!pairedIndices.has(i)) {
                        lineChangesList.push({
                            lineNumber: currentLineNumber,
                            type: 'added',
                            originalLineNumber: originalLineNumber,
                            newText: addedLines[i]
                        });
                        currentLineNumber++;
                    }
                }

                pendingDeleted.length = 0;
            } else {
                // Unchanged - flush pending deletes first
                pendingDeleted.forEach(deleted => {
                    lineChangesList.push({
                        lineNumber: currentLineNumber,
                        type: 'deleted',
                        originalLineNumber: deleted.originalLineNum,
                        oldText: deleted.text
                    });
                });
                pendingDeleted.length = 0;

                change.value.forEach(() => {
                    currentLineNumber++;
                    originalLineNumber++;
                });
            }
        });

        // Flush remaining
        pendingDeleted.forEach(deleted => {
            lineChangesList.push({
                lineNumber: currentLineNumber,
                type: 'deleted',
                originalLineNumber: deleted.originalLineNum,
                oldText: deleted.text
            });
        });

        this.lineChanges.set(filePath, lineChangesList);
    }

    private calculateSimilarity(str1: string, str2: string): number {
        // Simple similarity check based on common characters
        const set1 = new Set(str1.trim().replace(/\s+/g, ''));
        const set2 = new Set(str2.trim().replace(/\s+/g, ''));

        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);

        return union.size > 0 ? intersection.size / union.size : 0;
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
        this._onDidChangeRecordingState.dispose();
        this._onDidTrackChanges.dispose();
    }
}
