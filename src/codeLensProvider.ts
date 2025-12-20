import * as vscode from 'vscode';
import { DiffTracker, LineChange } from './diffTracker';

/**
 * Represents a block of consecutive changes
 */
export interface ChangeBlock {
    startLine: number;      // 1-based, first line of block in current document
    endLine: number;        // 1-based, last line of block in current document
    type: 'added' | 'modified' | 'deleted';
    changes: LineChange[];  // The individual line changes in this block
    blockIndex: number;     // Index of this block (0-based)
}

/**
 * Provides CodeLens actions for change blocks
 */
export class DiffCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    constructor(private diffTracker: DiffTracker) {
        // Refresh CodeLens when diff changes
        this.diffTracker.onDidTrackChanges(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    public refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        if (!this.diffTracker.getIsRecording()) {
            return [];
        }

        if (document.uri.scheme !== 'file') {
            return [];
        }

        const filePath = document.uri.fsPath;
        const blocks = this.getChangeBlocks(filePath);

        if (blocks.length === 0) {
            return [];
        }

        const codeLenses: vscode.CodeLens[] = [];

        blocks.forEach((block, index) => {
            // Position CodeLens at the start of the block
            const line = Math.max(0, block.startLine - 1);
            const range = new vscode.Range(line, 0, line, 0);

            // "Revert" action
            codeLenses.push(new vscode.CodeLens(range, {
                title: '↩ Revert',
                command: 'diffTracker.revertBlock',
                arguments: [filePath, index],
                tooltip: 'Revert this block to original content'
            }));

            // "Keep" action
            codeLenses.push(new vscode.CodeLens(range, {
                title: '✓ Keep',
                command: 'diffTracker.keepBlock',
                arguments: [filePath, index],
                tooltip: 'Accept this change and remove from diff'
            }));

            // Block counter and navigation
            const totalBlocks = blocks.length;
            const blockNum = index + 1;

            if (totalBlocks > 1) {
                // Previous block
                if (index > 0) {
                    codeLenses.push(new vscode.CodeLens(range, {
                        title: '↑',
                        command: 'diffTracker.goToBlock',
                        arguments: [filePath, index - 1],
                        tooltip: 'Go to previous change block'
                    }));
                }

                // Block counter
                codeLenses.push(new vscode.CodeLens(range, {
                    title: `${blockNum} of ${totalBlocks}`,
                    command: '',
                    arguments: []
                }));

                // Next block
                if (index < totalBlocks - 1) {
                    codeLenses.push(new vscode.CodeLens(range, {
                        title: '↓',
                        command: 'diffTracker.goToBlock',
                        arguments: [filePath, index + 1],
                        tooltip: 'Go to next change block'
                    }));
                }
            }
        });

        return codeLenses;
    }

    /**
     * Group consecutive LineChanges into blocks
     */
    public getChangeBlocks(filePath: string): ChangeBlock[] {
        const lineChanges = this.diffTracker.getLineChanges(filePath);
        if (!lineChanges || lineChanges.length === 0) {
            return [];
        }

        // Filter out 'unchanged' type and sort by line number
        const changes = lineChanges
            .filter(c => c.type !== 'unchanged')
            .sort((a, b) => a.lineNumber - b.lineNumber);

        if (changes.length === 0) {
            return [];
        }

        const blocks: ChangeBlock[] = [];
        let currentBlock: LineChange[] = [changes[0]];
        let currentType = changes[0].type;

        for (let i = 1; i < changes.length; i++) {
            const change = changes[i];
            const prevChange = changes[i - 1];

            // Check if this change is consecutive and same type
            const isConsecutive = change.lineNumber <= prevChange.lineNumber + 1;
            const isSameType = change.type === currentType;

            if (isConsecutive && isSameType) {
                currentBlock.push(change);
            } else {
                // Save current block and start new one
                blocks.push(this.createBlock(currentBlock, blocks.length));
                currentBlock = [change];
                currentType = change.type;
            }
        }

        // Don't forget the last block
        if (currentBlock.length > 0) {
            blocks.push(this.createBlock(currentBlock, blocks.length));
        }

        return blocks;
    }

    private createBlock(changes: LineChange[], blockIndex: number): ChangeBlock {
        const startLine = Math.min(...changes.map(c => c.lineNumber));
        const endLine = Math.max(...changes.map(c => c.lineNumber));
        const type = changes[0].type as 'added' | 'modified' | 'deleted';

        return {
            startLine,
            endLine,
            type,
            changes,
            blockIndex
        };
    }

    public dispose(): void {
        this._onDidChangeCodeLenses.dispose();
    }
}
