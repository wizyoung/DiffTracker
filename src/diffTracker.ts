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

export type InlineLineType = 'added' | 'deleted' | 'unchanged';

export interface InlineDiffView {
    content: string;
    lineTypes: InlineLineType[];
}

interface PendingRemovedLine {
    text: string;
    normalized: string;
    originalLineNumber: number;
}

export class DiffTracker {
    private isRecording = false;
    private fileSnapshots = new Map<string, string>();
    private trackedChanges = new Map<string, FileDiff>();
    private lineChanges = new Map<string, LineChange[]>();
    private inlineViews = new Map<string, InlineDiffView>();
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
        this.inlineViews.clear();

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
        this.inlineViews.clear();
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

    public async revertFile(filePath: string): Promise<boolean> {
        const change = this.trackedChanges.get(filePath);
        if (!change) {
            return false;
        }

        try {
            const uri = vscode.Uri.file(change.filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            const edit = new vscode.WorkspaceEdit();

            const fullRange = new vscode.Range(
                doc.lineAt(0).range.start,
                doc.lineAt(doc.lineCount - 1).range.end
            );

            edit.replace(uri, fullRange, change.originalContent);
            const success = await vscode.workspace.applyEdit(edit);
            if (!success) {
                return false;
            }

            await doc.save();
        } catch (error) {
            console.error(`Failed to revert ${filePath}:`, error);
            return false;
        }

        this.trackedChanges.delete(filePath);
        this.lineChanges.delete(filePath);
        this.inlineViews.delete(filePath);
        this._onDidTrackChanges.fire();

        return true;
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

    public getInlineLineTypes(filePath: string): InlineLineType[] | undefined {
        return this.inlineViews.get(filePath)?.lineTypes;
    }

    public getInlineContent(filePath: string): string | undefined {
        const view = this.ensureInlineView(filePath);
        if (!view) {
            return undefined;
        }

        return view.content;
    }

    public getInlineView(filePath: string): InlineDiffView | undefined {
        return this.ensureInlineView(filePath);
    }

    public buildInlineViewFromContents(originalContent: string, currentContent: string): InlineDiffView {
        return this.buildDiffViewFromLines(
            originalContent.split('\n'),
            currentContent.split('\n')
        ).inlineView;
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
            this.inlineViews.delete(filePath);
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

        this.calculateLineChanges(filePath);
        this._onDidTrackChanges.fire();
    }

    private ensureInlineView(filePath: string): InlineDiffView | undefined {
        const cached = this.inlineViews.get(filePath);
        if (cached) {
            return cached;
        }

        const view = this.buildDiffView(filePath);
        if (!view) {
            return undefined;
        }

        this.lineChanges.set(filePath, view.lineChanges);
        this.inlineViews.set(filePath, view.inlineView);
        return view.inlineView;
    }

    private getCurrentContent(filePath: string): string | undefined {
        const tracked = this.trackedChanges.get(filePath);
        if (tracked) {
            return tracked.currentContent;
        }

        const doc = vscode.workspace.textDocuments.find(textDoc => textDoc.uri.fsPath === filePath);
        return doc?.getText();
    }

    private calculateLineChanges(filePath: string) {
        const view = this.buildDiffView(filePath);
        if (!view) {
            this.lineChanges.delete(filePath);
            this.inlineViews.delete(filePath);
            return;
        }

        this.lineChanges.set(filePath, view.lineChanges);
        this.inlineViews.set(filePath, view.inlineView);
    }

    private buildDiffView(filePath: string): { lineChanges: LineChange[]; inlineView: InlineDiffView } | undefined {
        const originalContent = this.fileSnapshots.get(filePath);
        const currentContent = this.getCurrentContent(filePath);

        if (originalContent === undefined || currentContent === undefined) {
            return undefined;
        }

        return this.buildDiffViewFromLines(
            originalContent.split('\n'),
            currentContent.split('\n')
        );
    }

    private buildDiffViewFromLines(
        originalLines: string[],
        currentLines: string[]
    ): { lineChanges: LineChange[]; inlineView: InlineDiffView } {
        const originalNormalized = originalLines.map(line => this.normalizeLineForMatch(line));
        const currentNormalized = currentLines.map(line => this.normalizeLineForMatch(line));
        const arrayDiff = Diff.diffArrays(originalLines, currentLines);

        const lineChanges: LineChange[] = [];
        const inlineLines: string[] = [];
        const inlineTypes: InlineLineType[] = [];

        let originalIndex = 0;
        let currentIndex = 0;
        let originalLineNumber = 1;
        let currentLineNumber = 1;

        const pendingRemoved: PendingRemovedLine[] = [];

        const flushPendingRemoved = () => {
            if (pendingRemoved.length === 0) {
                return;
            }

            pendingRemoved.forEach(removed => {
                lineChanges.push({
                    lineNumber: currentLineNumber,
                    type: 'deleted',
                    originalLineNumber: removed.originalLineNumber,
                    oldText: removed.text
                });
                inlineLines.push(removed.text);
                inlineTypes.push('deleted');
            });

            pendingRemoved.length = 0;
        };

        arrayDiff.forEach(change => {
            const length = change.value.length;

            if (change.removed) {
                for (let i = 0; i < length; i++) {
                    pendingRemoved.push({
                        text: originalLines[originalIndex],
                        normalized: originalNormalized[originalIndex],
                        originalLineNumber
                    });
                    originalIndex++;
                    originalLineNumber++;
                }
                return;
            }

            if (change.added) {
                const addedLines = currentLines.slice(currentIndex, currentIndex + length);
                const addedNormalized = currentNormalized.slice(currentIndex, currentIndex + length);
                const pairing = this.pairLinesBySimilarity(pendingRemoved, addedLines, addedNormalized);

                pairing.pairedByAdded.forEach((deletedIndex, addedIndex) => {
                    const deleted = pendingRemoved[deletedIndex];
                    lineChanges.push({
                        lineNumber: currentLineNumber + addedIndex,
                        type: 'modified',
                        originalLineNumber: deleted.originalLineNumber,
                        oldText: deleted.text,
                        newText: addedLines[addedIndex]
                    });
                });

                const canSuppressBlankDeletes =
                    pendingRemoved.length > 0 &&
                    pendingRemoved.every(removed => removed.text.trim().length === 0) &&
                    pendingRemoved.length === addedLines.length;

                pairing.unpairedDeleted.forEach(index => {
                    const deleted = pendingRemoved[index];
                    const isBlankDeleted = deleted.text.trim().length === 0;

                    if (canSuppressBlankDeletes && isBlankDeleted) {
                        return;
                    }

                    lineChanges.push({
                        lineNumber: currentLineNumber,
                        type: 'deleted',
                        originalLineNumber: deleted.originalLineNumber,
                        oldText: deleted.text
                    });
                });

                pairing.unpairedAdded.forEach(index => {
                    lineChanges.push({
                        lineNumber: currentLineNumber + index,
                        type: 'added',
                        originalLineNumber,
                        newText: addedLines[index]
                    });
                });

                const inlineDeleted = canSuppressBlankDeletes
                    ? pendingRemoved.filter(removed => removed.text.trim().length !== 0)
                    : pendingRemoved;

                inlineDeleted.forEach(removed => {
                    inlineLines.push(removed.text);
                    inlineTypes.push('deleted');
                });

                addedLines.forEach(line => {
                    inlineLines.push(line);
                    inlineTypes.push('added');
                });

                pendingRemoved.length = 0;
                currentIndex += length;
                currentLineNumber += length;
                return;
            }

            flushPendingRemoved();

            let offset = 0;
            while (offset < length) {
                const oldLine = originalLines[originalIndex];
                const newLine = currentLines[currentIndex];

                if (oldLine === newLine) {
                    inlineLines.push(newLine);
                    inlineTypes.push('unchanged');
                    originalIndex++;
                    currentIndex++;
                    originalLineNumber++;
                    currentLineNumber++;
                    offset++;
                    continue;
                }

                let runLength = 0;
                while (offset + runLength < length) {
                    const oldCandidate = originalLines[originalIndex + runLength];
                    const newCandidate = currentLines[currentIndex + runLength];
                    if (oldCandidate === newCandidate) {
                        break;
                    }
                    runLength++;
                }

                for (let i = 0; i < runLength; i++) {
                    inlineLines.push(originalLines[originalIndex + i]);
                    inlineTypes.push('deleted');
                }

                for (let i = 0; i < runLength; i++) {
                    inlineLines.push(currentLines[currentIndex + i]);
                    inlineTypes.push('added');
                }

                for (let i = 0; i < runLength; i++) {
                    lineChanges.push({
                        lineNumber: currentLineNumber + i,
                        type: 'modified',
                        originalLineNumber: originalLineNumber + i,
                        oldText: originalLines[originalIndex + i],
                        newText: currentLines[currentIndex + i]
                    });
                }

                originalIndex += runLength;
                currentIndex += runLength;
                originalLineNumber += runLength;
                currentLineNumber += runLength;
                offset += runLength;
            }
        });

        flushPendingRemoved();

        return {
            lineChanges,
            inlineView: {
                content: inlineLines.join('\n'),
                lineTypes: inlineTypes
            }
        };
    }

    private pairLinesBySimilarity(
        deletedLines: PendingRemovedLine[],
        addedLines: string[],
        addedNormalized: string[]
    ): {
        pairedByAdded: Map<number, number>,
        unpairedDeleted: number[],
        unpairedAdded: number[]
    } {
        const similarityThreshold = 0.6;
        const maxOffset = 5;
        const pairedByAdded = new Map<number, number>();
        const usedDeleted = new Set<number>();
        const usedAdded = new Set<number>();

        for (let i = 0; i < addedLines.length; i++) {
            let bestDeleted = -1;
            let bestSimilarity = 0;

            for (let j = 0; j < deletedLines.length; j++) {
                if (usedDeleted.has(j)) {
                    continue;
                }

                if (Math.abs(j - i) > maxOffset) {
                    continue;
                }

                const similarity = this.calculatePairSimilarity(
                    deletedLines[j],
                    addedLines[i],
                    addedNormalized[i]
                );

                if (similarity > bestSimilarity) {
                    bestSimilarity = similarity;
                    bestDeleted = j;
                }
            }

            if (bestDeleted >= 0 && bestSimilarity >= similarityThreshold) {
                pairedByAdded.set(i, bestDeleted);
                usedDeleted.add(bestDeleted);
                usedAdded.add(i);
            }
        }

        const unpairedDeleted = deletedLines
            .map((_, index) => index)
            .filter(index => !usedDeleted.has(index));

        const unpairedAdded = addedLines
            .map((_, index) => index)
            .filter(index => !usedAdded.has(index));

        return { pairedByAdded, unpairedDeleted, unpairedAdded };
    }

    private calculatePairSimilarity(
        deleted: PendingRemovedLine,
        addedLine: string,
        addedNormalized: string
    ): number {
        if (deleted.normalized.length > 0 && deleted.normalized === addedNormalized) {
            return 1;
        }

        const rawSimilarity = this.calculateSetSimilarity(deleted.text, addedLine);
        const normalizedSimilarity = this.calculateSetSimilarity(deleted.normalized, addedNormalized);

        return Math.max(rawSimilarity, normalizedSimilarity);
    }

    private calculateSetSimilarity(str1: string, str2: string): number {
        const cleaned1 = str1.trim().replace(/\s+/g, '');
        const cleaned2 = str2.trim().replace(/\s+/g, '');

        if (!cleaned1 && !cleaned2) {
            return 1;
        }

        const set1 = new Set(cleaned1);
        const set2 = new Set(cleaned2);

        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);

        return union.size > 0 ? intersection.size / union.size : 0;
    }

    private normalizeLineForMatch(input: string): string {
        let value = input.trim();

        value = value.replace(/^\/\/\s?/, '');
        value = value.replace(/^#\s?/, '');
        value = value.replace(/^--\s?/, '');
        value = value.replace(/^\/\*\s?/, '');
        value = value.replace(/\*\/\s?$/, '');
        value = value.replace(/\s+/g, ' ');

        return value.trim();
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
        this._onDidChangeRecordingState.dispose();
        this._onDidTrackChanges.dispose();
    }
}
