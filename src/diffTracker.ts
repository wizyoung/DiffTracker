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
    type: 'added' | 'deleted' | 'modified' | 'unchanged';
    originalLineNumber?: number;  // Original line number for reference
    oldText?: string;  // Original text content (for modified/deleted lines)
    newText?: string;  // New text content (for modified lines)
    anchorLineNumber?: number;  // For deleted lines: the line in current doc where badge should show
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

        // For files without snapshot (not open when recording started),
        // capture the document's current content BEFORE this change as the baseline.
        // We use the document state just before this edit event.
        // Note: event.contentChanges contains what changed, so we need to
        // reconstruct the pre-change content or use a different approach.
        // 
        // The safest approach: read the file from disk to get the original content.
        if (!this.fileSnapshots.has(filePath)) {
            // Try to read the original content from disk
            // This works because VS Code's document might have unsaved changes,
            // but we want the state before ANY changes in this recording session.
            try {
                const fs = require('fs');
                const originalContent = fs.readFileSync(filePath, 'utf8');
                this.fileSnapshots.set(filePath, originalContent);
            } catch (error) {
                // File doesn't exist on disk (truly new file), use empty
                this.fileSnapshots.set(filePath, '');
            }
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
        const arrayDiff = this.patienceDiff(originalLines, currentLines);

        const lineChanges: LineChange[] = [];
        const inlineLines: string[] = [];
        const inlineTypes: InlineLineType[] = [];

        let originalIndex = 0;
        let currentIndex = 0;
        let originalLineNumber = 1;
        let currentLineNumber = 1;

        const pendingRemoved: PendingRemovedLine[] = [];

        // Track the last matched line number in current doc (for anchoring deleted badges)
        let lastMatchedCurrentLine = 0;

        const flushPendingRemoved = () => {
            if (pendingRemoved.length === 0) {
                return;
            }

            // All pending deleted lines share the same anchor: the last matched line
            const anchorLine = lastMatchedCurrentLine;

            pendingRemoved.forEach(removed => {
                lineChanges.push({
                    lineNumber: currentLineNumber,
                    type: 'deleted',
                    originalLineNumber: removed.originalLineNumber,
                    oldText: removed.text,
                    anchorLineNumber: anchorLine
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
                        oldText: deleted.text,
                        anchorLineNumber: lastMatchedCurrentLine
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
                    // Record unchanged line for anchor mapping (used by decorationManager)
                    lineChanges.push({
                        lineNumber: currentLineNumber,
                        type: 'unchanged' as const,
                        originalLineNumber
                    });
                    originalIndex++;
                    currentIndex++;
                    originalLineNumber++;
                    lastMatchedCurrentLine = currentLineNumber;  // Track last matched line
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

        // First pass: pair same-position lines (regardless of similarity)
        // This handles the common case of editing a single line in place
        const minLen = Math.min(deletedLines.length, addedLines.length);
        for (let i = 0; i < minLen; i++) {
            // Only auto-pair if both sides have exactly one line at this position
            // that would otherwise be unpaired
            if (deletedLines.length === addedLines.length) {
                // Same number of lines changed - pair by position
                pairedByAdded.set(i, i);
                usedDeleted.add(i);
                usedAdded.add(i);
            }
        }

        // If counts differ, fall back to similarity-based pairing
        if (deletedLines.length !== addedLines.length) {
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

    /**
     * Patience Diff algorithm implementation.
     * 
     * Unlike LCS-based diff, this algorithm:
     * 1. Finds unique lines (appearing exactly once in both old and new)
     * 2. Uses unique lines as anchors
     * 3. Falls back to positional diff (not LCS) when no unique lines exist
     * 
     * This produces more intuitive diffs when similar code blocks exist nearby.
     */
    private patienceDiff(
        oldLines: string[],
        newLines: string[]
    ): Array<{ value: string[]; added?: boolean; removed?: boolean }> {
        return this.patienceDiffRecursive(oldLines, 0, oldLines.length, newLines, 0, newLines.length);
    }

    private patienceDiffRecursive(
        oldLines: string[],
        oldStart: number,
        oldEnd: number,
        newLines: string[],
        newStart: number,
        newEnd: number
    ): Array<{ value: string[]; added?: boolean; removed?: boolean }> {
        // Base cases
        if (oldStart >= oldEnd && newStart >= newEnd) {
            return [];
        }
        if (oldStart >= oldEnd) {
            // All remaining new lines are additions
            return [{ value: newLines.slice(newStart, newEnd), added: true }];
        }
        if (newStart >= newEnd) {
            // All remaining old lines are deletions
            return [{ value: oldLines.slice(oldStart, oldEnd), removed: true }];
        }

        // Find unique lines and their positions
        const oldUniques = this.findUniqueLineIndices(oldLines, oldStart, oldEnd);
        const newUniques = this.findUniqueLineIndices(newLines, newStart, newEnd);

        // Find matching unique lines (anchors)
        const anchors = this.findAnchors(oldLines, oldUniques, newLines, newUniques);

        if (anchors.length === 0) {
            // No anchors: fall back to positional diff
            return this.positionalDiff(oldLines, oldStart, oldEnd, newLines, newStart, newEnd);
        }

        // Process blocks between anchors
        const result: Array<{ value: string[]; added?: boolean; removed?: boolean }> = [];
        let prevOldIdx = oldStart;
        let prevNewIdx = newStart;

        for (const [oldIdx, newIdx] of anchors) {
            // Recursively process content before this anchor
            const beforeDiff = this.patienceDiffRecursive(
                oldLines, prevOldIdx, oldIdx,
                newLines, prevNewIdx, newIdx
            );
            result.push(...beforeDiff);

            // Add the anchor line itself (unchanged)
            result.push({ value: [oldLines[oldIdx]] });

            prevOldIdx = oldIdx + 1;
            prevNewIdx = newIdx + 1;
        }

        // Process content after the last anchor
        const afterDiff = this.patienceDiffRecursive(
            oldLines, prevOldIdx, oldEnd,
            newLines, prevNewIdx, newEnd
        );
        result.push(...afterDiff);

        return this.mergeConsecutiveChanges(result);
    }

    /**
     * Find indices of lines that appear exactly once in the given range.
     */
    private findUniqueLineIndices(
        lines: string[],
        start: number,
        end: number
    ): Map<string, number> {
        const counts = new Map<string, { count: number; index: number }>();

        for (let i = start; i < end; i++) {
            const line = lines[i];
            const existing = counts.get(line);
            if (existing) {
                existing.count++;
            } else {
                counts.set(line, { count: 1, index: i });
            }
        }

        const uniques = new Map<string, number>();
        for (const [line, { count, index }] of counts) {
            if (count === 1) {
                uniques.set(line, index);
            }
        }
        return uniques;
    }

    /**
     * Find matching unique lines between old and new, maintaining order.
     * Uses LCS on the unique lines only to find the longest matching sequence.
     */
    private findAnchors(
        oldLines: string[],
        oldUniques: Map<string, number>,
        newLines: string[],
        newUniques: Map<string, number>
    ): Array<[number, number]> {
        // Find common unique lines
        const commonUniques: Array<{ line: string; oldIdx: number; newIdx: number }> = [];

        for (const [line, oldIdx] of oldUniques) {
            const newIdx = newUniques.get(line);
            if (newIdx !== undefined) {
                commonUniques.push({ line, oldIdx, newIdx });
            }
        }

        if (commonUniques.length === 0) {
            return [];
        }

        // Sort by position in old file
        commonUniques.sort((a, b) => a.oldIdx - b.oldIdx);

        // Find LCS by new index (patience sorting)
        // This ensures we get the longest sequence of anchors that maintains order in both files
        const lcs = this.longestIncreasingSubsequence(
            commonUniques.map(u => u.newIdx)
        );

        return lcs.map(i => [commonUniques[i].oldIdx, commonUniques[i].newIdx] as [number, number]);
    }

    /**
     * Find the longest increasing subsequence indices.
     * Used to find the best anchor chain that maintains order.
     */
    private longestIncreasingSubsequence(nums: number[]): number[] {
        if (nums.length === 0) {
            return [];
        }

        const n = nums.length;
        const dp: number[] = new Array(n).fill(1);
        const parent: number[] = new Array(n).fill(-1);

        for (let i = 1; i < n; i++) {
            for (let j = 0; j < i; j++) {
                if (nums[j] < nums[i] && dp[j] + 1 > dp[i]) {
                    dp[i] = dp[j] + 1;
                    parent[i] = j;
                }
            }
        }

        // Find the index with maximum length
        let maxLen = 0;
        let maxIdx = 0;
        for (let i = 0; i < n; i++) {
            if (dp[i] > maxLen) {
                maxLen = dp[i];
                maxIdx = i;
            }
        }

        // Reconstruct the sequence
        const result: number[] = [];
        let idx = maxIdx;
        while (idx !== -1) {
            result.push(idx);
            idx = parent[idx];
        }
        result.reverse();

        return result;
    }

    /**
     * Positional diff: matches lines by position, not by content similarity.
     * This is the key difference from LCS - it prevents cross-matching similar lines
     * from different code blocks.
     * 
     * When block sizes differ, we first check if the content aligns at the start
     * or end (indicating simple deletion), before falling back to pure removed+added.
     */
    private positionalDiff(
        oldLines: string[],
        oldStart: number,
        oldEnd: number,
        newLines: string[],
        newStart: number,
        newEnd: number
    ): Array<{ value: string[]; added?: boolean; removed?: boolean }> {
        const oldLen = oldEnd - oldStart;
        const newLen = newEnd - newStart;
        const result: Array<{ value: string[]; added?: boolean; removed?: boolean }> = [];

        // If one side is empty, return pure add or remove
        if (oldLen === 0 && newLen > 0) {
            return [{ value: newLines.slice(newStart, newEnd), added: true }];
        }
        if (newLen === 0 && oldLen > 0) {
            return [{ value: oldLines.slice(oldStart, oldEnd), removed: true }];
        }

        // Check if this is a deletion at the START (old ends match new)
        // i.e., new content is a suffix of old content
        if (oldLen > newLen) {
            const diff = oldLen - newLen;
            let suffixMatch = true;
            for (let i = 0; i < newLen; i++) {
                if (oldLines[oldStart + diff + i] !== newLines[newStart + i]) {
                    suffixMatch = false;
                    break;
                }
            }
            if (suffixMatch) {
                // Lines at start were deleted, rest unchanged
                result.push({ value: oldLines.slice(oldStart, oldStart + diff), removed: true });
                result.push({ value: oldLines.slice(oldStart + diff, oldEnd) });
                return result;
            }
        }

        // Check if this is a deletion at the END (old starts match new)
        // i.e., new content is a prefix of old content
        if (oldLen > newLen) {
            const diff = oldLen - newLen;
            let prefixMatch = true;
            for (let i = 0; i < newLen; i++) {
                if (oldLines[oldStart + i] !== newLines[newStart + i]) {
                    prefixMatch = false;
                    break;
                }
            }
            if (prefixMatch) {
                // Lines at end were deleted, start unchanged
                result.push({ value: oldLines.slice(oldStart, oldStart + newLen) });
                result.push({ value: oldLines.slice(oldStart + newLen, oldEnd), removed: true });
                return result;
            }
        }

        // Check if this is an addition at the START (new ends match old)
        if (newLen > oldLen) {
            const diff = newLen - oldLen;
            let suffixMatch = true;
            for (let i = 0; i < oldLen; i++) {
                if (newLines[newStart + diff + i] !== oldLines[oldStart + i]) {
                    suffixMatch = false;
                    break;
                }
            }
            if (suffixMatch) {
                result.push({ value: newLines.slice(newStart, newStart + diff), added: true });
                result.push({ value: newLines.slice(newStart + diff, newEnd) });
                return result;
            }
        }

        // Check if this is an addition at the END (new starts match old)
        if (newLen > oldLen) {
            const diff = newLen - oldLen;
            let prefixMatch = true;
            for (let i = 0; i < oldLen; i++) {
                if (newLines[newStart + i] !== oldLines[oldStart + i]) {
                    prefixMatch = false;
                    break;
                }
            }
            if (prefixMatch) {
                result.push({ value: newLines.slice(newStart, newStart + oldLen) });
                result.push({ value: newLines.slice(newStart + oldLen, newEnd), added: true });
                return result;
            }
        }

        // No simple prefix/suffix match - fall back to finding leading/trailing unchanged
        const minLen = Math.min(oldLen, newLen);

        let leadingUnchanged = 0;
        while (leadingUnchanged < minLen &&
            oldLines[oldStart + leadingUnchanged] === newLines[newStart + leadingUnchanged]) {
            leadingUnchanged++;
        }

        if (leadingUnchanged > 0) {
            result.push({ value: oldLines.slice(oldStart, oldStart + leadingUnchanged) });
        }

        let trailingUnchanged = 0;
        while (trailingUnchanged < minLen - leadingUnchanged &&
            oldLines[oldEnd - 1 - trailingUnchanged] === newLines[newEnd - 1 - trailingUnchanged]) {
            trailingUnchanged++;
        }

        const oldMiddleStart = oldStart + leadingUnchanged;
        const oldMiddleEnd = oldEnd - trailingUnchanged;
        const newMiddleStart = newStart + leadingUnchanged;
        const newMiddleEnd = newEnd - trailingUnchanged;

        if (oldMiddleStart < oldMiddleEnd) {
            result.push({ value: oldLines.slice(oldMiddleStart, oldMiddleEnd), removed: true });
        }
        if (newMiddleStart < newMiddleEnd) {
            result.push({ value: newLines.slice(newMiddleStart, newMiddleEnd), added: true });
        }

        if (trailingUnchanged > 0) {
            result.push({ value: oldLines.slice(oldEnd - trailingUnchanged, oldEnd) });
        }

        return result;
    }

    /**
     * Merge consecutive changes of the same type for cleaner output.
     */
    private mergeConsecutiveChanges(
        changes: Array<{ value: string[]; added?: boolean; removed?: boolean }>
    ): Array<{ value: string[]; added?: boolean; removed?: boolean }> {
        if (changes.length === 0) {
            return [];
        }

        const result: Array<{ value: string[]; added?: boolean; removed?: boolean }> = [];

        for (const change of changes) {
            if (change.value.length === 0) {
                continue;
            }

            const last = result[result.length - 1];
            if (last &&
                last.added === change.added &&
                last.removed === change.removed) {
                last.value.push(...change.value);
            } else {
                result.push({ ...change, value: [...change.value] });
            }
        }

        return result;
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
