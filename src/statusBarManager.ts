import * as vscode from 'vscode';
import { DiffTracker } from './diffTracker';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;

    constructor(private diffTracker: DiffTracker) {
        // Create status bar item on the right side
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );

        this.statusBarItem.command = 'diffTracker.toggleRecording';
        this.statusBarItem.tooltip = 'Toggle Diff Recording';

        // Listen to recording state changes
        this.diffTracker.onDidChangeRecordingState(isRecording => {
            this.updateStatusBar(isRecording);
        });

        // Initialize
        this.updateStatusBar(this.diffTracker.getIsRecording());
        this.statusBarItem.show();
    }

    private updateStatusBar(isRecording: boolean) {
        if (isRecording) {
            this.statusBarItem.text = '$(circle-filled) Recording';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            this.statusBarItem.text = '$(circle-outline) Not Recording';
            this.statusBarItem.backgroundColor = undefined;
        }
    }

    public dispose() {
        this.statusBarItem.dispose();
    }
}
