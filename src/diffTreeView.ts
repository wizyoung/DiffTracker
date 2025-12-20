import * as vscode from 'vscode';
import * as path from 'path';
import { DiffTracker, FileDiff } from './diffTracker';

export class DiffTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private diffTracker: DiffTracker) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeItem): Thenable<TreeItem[]> {
        const items: TreeItem[] = [];

        // Root level - show files
        if (!element) {
            const changes = this.diffTracker.getTrackedChanges();

            if (changes.length === 0) {
                const emptyItem = new TreeItem('No changes tracked', vscode.TreeItemCollapsibleState.None);
                emptyItem.description = this.diffTracker.getIsRecording() ? 'Make some edits...' : 'Start recording to track changes';
                return Promise.resolve([emptyItem]);
            }

            // Add "Revert All Changes" button at top
            const revertButton = new TreeItem('Revert All Changes', vscode.TreeItemCollapsibleState.None);
            revertButton.command = {
                command: 'diffTracker.revertAllChanges',
                title: 'Revert All Changes'
            };
            revertButton.iconPath = new vscode.ThemeIcon('discard');
            revertButton.tooltip = `Restore all ${changes.length} file(s) to original state`;
            revertButton.description = `${changes.length} file(s)`;
            items.push(revertButton);

            // Group files by directory
            const filesByDir = new Map<string, FileDiff[]>();

            changes.forEach(change => {
                const dir = path.dirname(change.filePath);
                if (!filesByDir.has(dir)) {
                    filesByDir.set(dir, []);
                }
                filesByDir.get(dir)!.push(change);
            });

            // Create tree items
            for (const [dir, files] of filesByDir) {
                if (filesByDir.size === 1) {
                    // Only one directory - show files directly
                    files.forEach(file => {
                        items.push(this.createFileItem(file));
                    });
                } else {
                    // Multiple directories - show directory tree
                    const dirItem = new TreeItem(path.basename(dir), vscode.TreeItemCollapsibleState.Expanded);
                    dirItem.iconPath = new vscode.ThemeIcon('folder');
                    dirItem.description = `${files.length} file(s)`;
                    dirItem.children = files.map(file => this.createFileItem(file));
                    items.push(dirItem);
                }
            }
        } else if (element.children) {
            return Promise.resolve(element.children);
        }

        return Promise.resolve(items);
    }

    private createFileItem(fileDiff: FileDiff): TreeItem {
        const item = new TreeItem(fileDiff.fileName, vscode.TreeItemCollapsibleState.None);
        item.filePath = fileDiff.filePath;
        item.iconPath = this.getFileIcon(fileDiff.fileName);
        item.tooltip = fileDiff.filePath;

        // Add inline diff command
        item.command = {
            command: 'diffTracker.showInlineDiff',
            title: 'Show Inline Diff',
            arguments: [fileDiff.filePath]
        };

        // Add side-by-side button in context menu
        item.contextValue = 'changedFile';

        return item;
    }

    private getFileIcon(fileName: string): vscode.ThemeIcon {
        const ext = fileName.split('.').pop()?.toLowerCase() || '';

        // Map file extensions to VS Code icons
        const iconMap: { [key: string]: string } = {
            // Programming languages
            'ts': 'symbol-class',
            'tsx': 'symbol-class',
            'js': 'symbol-method',
            'jsx': 'symbol-method',
            'py': 'symbol-namespace',
            'java': 'symbol-interface',
            'c': 'symbol-struct',
            'cpp': 'symbol-struct',
            'h': 'symbol-struct',
            'cs': 'symbol-class',
            'go': 'symbol-method',
            'rs': 'symbol-module',
            'rb': 'ruby',
            'php': 'symbol-method',
            'swift': 'symbol-class',
            'kt': 'symbol-class',

            // Web
            'html': 'code',
            'css': 'symbol-color',
            'scss': 'symbol-color',
            'sass': 'symbol-color',
            'less': 'symbol-color',
            'vue': 'symbol-misc',

            // Config/Data
            'json': 'json',
            'yaml': 'symbol-key',
            'yml': 'symbol-key',
            'xml': 'symbol-key',
            'toml': 'symbol-key',
            'ini': 'gear',
            'env': 'gear',

            // Docs
            'md': 'book',
            'txt': 'file-text',
            'pdf': 'file-pdf',

            // Others
            'sql': 'database',
            'sh': 'terminal',
            'bash': 'terminal',
            'zsh': 'terminal',
            'dockerfile': 'package'
        };

        const iconName = iconMap[ext] || 'file-code';
        return new vscode.ThemeIcon(iconName);
    }
}

class TreeItem extends vscode.TreeItem {
    public children?: TreeItem[];
    public filePath?: string;

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }
}
