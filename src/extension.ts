import * as vscode from 'vscode';
import { DiffTracker } from './diffTracker';
import { DecorationManager } from './decorationManager';
import { DiffTreeDataProvider } from './diffTreeView';
import { DiffHoverProvider } from './hoverProvider';
import { StatusBarManager } from './statusBarManager';
import { OriginalContentProvider } from './originalContentProvider';

let diffTracker: DiffTracker;
let decorationManager: DecorationManager;
let statusBarManager: StatusBarManager;
let originalContentProvider: OriginalContentProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('Diff Tracker extension is now active');

    // Initialize services
    diffTracker = new DiffTracker();
    decorationManager = new DecorationManager(diffTracker);
    statusBarManager = new StatusBarManager(diffTracker);
    originalContentProvider = new OriginalContentProvider(diffTracker);

    // Register tree view provider for activity bar
    const treeDataProvider = new DiffTreeDataProvider(diffTracker);
    vscode.window.registerTreeDataProvider('diffTrackerView', treeDataProvider);

    // Register hover provider to show diff details
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('*', new DiffHoverProvider(diffTracker))
    );

    // Register virtual document provider for original content
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('diff-tracker-original', originalContentProvider)
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('diffTracker.toggleRecording', () => {
            if (diffTracker.getIsRecording()) {
                diffTracker.stopRecording();
                treeDataProvider.refresh();
                decorationManager.clearAllDecorations();
            } else {
                diffTracker.startRecording();
                treeDataProvider.refresh();

                // Update decorations for current editor
                if (vscode.window.activeTextEditor) {
                    decorationManager.updateDecorations(vscode.window.activeTextEditor);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('diffTracker.startRecording', () => {
            diffTracker.startRecording();
            treeDataProvider.refresh();

            // Update decorations for current editor
            if (vscode.window.activeTextEditor) {
                decorationManager.updateDecorations(vscode.window.activeTextEditor);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('diffTracker.stopRecording', () => {
            diffTracker.stopRecording();
            treeDataProvider.refresh();
            decorationManager.clearAllDecorations();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('diffTracker.showInlineDiff', async (filePathOrItem: string | any) => {
            // Extract file path from argument (could be string or TreeItem)
            const filePath = typeof filePathOrItem === 'string'
                ? filePathOrItem
                : filePathOrItem?.filePath;

            if (!filePath) {
                return;
            }

            // Open file and show inline diff decorations
            const uri = vscode.Uri.file(filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc);
            decorationManager.updateDecorations(editor);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('diffTracker.showSideBySideDiff', async (filePathOrItem: string | any) => {
            // Extract file path from argument (could be string or TreeItem)
            const filePath = typeof filePathOrItem === 'string'
                ? filePathOrItem
                : filePathOrItem?.filePath;

            if (!filePath) {
                return;
            }

            // Show side-by-side diff using VS Code's built-in diff editor
            const currentUri = vscode.Uri.file(filePath);
            const originalUri = vscode.Uri.parse(`diff-tracker-original://${filePath}`);

            const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'file';

            await vscode.commands.executeCommand('vscode.diff',
                originalUri,
                currentUri,
                `Original  ↔  Current: ${fileName}`
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('diffTracker.showDiffs', async () => {
            // Update decorations for current editor
            if (vscode.window.activeTextEditor) {
                decorationManager.updateDecorations(vscode.window.activeTextEditor);
            }
            vscode.window.showInformationMessage('Diff highlighting applied to editor');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('diffTracker.revertAllChanges', async () => {
            const changes = diffTracker.getTrackedChanges();
            if (changes.length === 0) {
                return;
            }

            // Confirm with user
            const answer = await vscode.window.showWarningMessage(
                `Revert all ${changes.length} file(s) to their original state? This cannot be undone.`,
                { modal: true },
                'Revert All',
                'Cancel'
            );

            if (answer === 'Revert All') {
                const revertedCount = await diffTracker.revertAllChanges();
                treeDataProvider.refresh();
                decorationManager.clearAllDecorations();
                vscode.window.showInformationMessage(`Reverted ${revertedCount} file(s)`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('diffTracker.clearDiffs', () => {
            diffTracker.clearDiffs();
            treeDataProvider.refresh();
            decorationManager.clearAllDecorations();
            vscode.window.showInformationMessage('Diff Tracker: All diffs cleared');
        })
    );

    // Update decorations when switching editors
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                decorationManager.updateDecorations(editor);
            }
        })
    );

    // Update decorations when recording state changes
    diffTracker.onDidChangeRecordingState(() => {
        treeDataProvider.refresh();
        if (vscode.window.activeTextEditor) {
            decorationManager.updateDecorations(vscode.window.activeTextEditor);
        }
    });

    // Update decorations when changes are tracked
    diffTracker.onDidTrackChanges(() => {
        treeDataProvider.refresh();
        if (vscode.window.activeTextEditor) {
            decorationManager.updateDecorations(vscode.window.activeTextEditor);
        }
    });

    // Register disposables
    context.subscriptions.push(statusBarManager);
    context.subscriptions.push(originalContentProvider);
}

export function deactivate() {
    if (diffTracker) {
        diffTracker.dispose();
    }
    if (decorationManager) {
        decorationManager.dispose();
    }
    if (statusBarManager) {
        statusBarManager.dispose();
    }
    if (originalContentProvider) {
        originalContentProvider.dispose();
    }
}
