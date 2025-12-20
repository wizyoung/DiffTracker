import * as vscode from 'vscode';

/**
 * Tree item for a setting toggle
 */
class SettingItem extends vscode.TreeItem {
    constructor(
        public readonly settingKey: string,
        public readonly label: string,
        public readonly isEnabled: boolean
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);

        // Use checkbox-style icons
        this.iconPath = new vscode.ThemeIcon(isEnabled ? 'check' : 'circle-outline');
        this.description = isEnabled ? 'On' : 'Off';
        this.contextValue = 'settingItem';
        this.command = {
            command: 'diffTracker.toggleSetting',
            title: 'Toggle Setting',
            arguments: [settingKey]
        };
        this.tooltip = `Click to ${isEnabled ? 'disable' : 'enable'}`;
    }
}

/**
 * Provides the settings tree view in the sidebar
 */
export class SettingsTreeDataProvider implements vscode.TreeDataProvider<SettingItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SettingItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private settings = [
        { key: 'showDeletedLinesBadge', label: 'Show Deleted Lines Badge' },
        { key: 'showCodeLens', label: 'Show CodeLens Actions' },
        { key: 'highlightAddedLines', label: 'Highlight Added Lines' },
        { key: 'highlightModifiedLines', label: 'Highlight Modified Lines' }
    ];

    constructor() {
        // Refresh when settings change
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('diffTracker')) {
                this.refresh();
            }
        });
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SettingItem): vscode.TreeItem {
        return element;
    }

    getChildren(): SettingItem[] {
        const config = vscode.workspace.getConfiguration('diffTracker');

        return this.settings.map(setting => {
            const value = config.get<boolean>(setting.key, true);
            return new SettingItem(setting.key, setting.label, value);
        });
    }

    /**
     * Toggle a setting
     */
    public async toggleSetting(settingKey: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('diffTracker');
        const currentValue = config.get<boolean>(settingKey, true);
        await config.update(settingKey, !currentValue, vscode.ConfigurationTarget.Global);
        this.refresh();
    }

    public dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}
