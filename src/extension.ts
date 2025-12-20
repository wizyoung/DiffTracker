import * as vscode from 'vscode';
import { DiffTracker } from './diffTracker';
import { DecorationManager } from './decorationManager';
import { DiffTreeDataProvider } from './diffTreeView';
import { DiffHoverProvider } from './hoverProvider';
import { StatusBarManager } from './statusBarManager';
import { OriginalContentProvider } from './originalContentProvider';
import { InlineContentProvider } from './inlineContentProvider';

let diffTracker: DiffTracker;
let decorationManager: DecorationManager;
let statusBarManager: StatusBarManager;
let originalContentProvider: OriginalContentProvider;
let inlineContentProvider: InlineContentProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('Diff Tracker extension is now active');

    // Initialize services
    diffTracker = new DiffTracker();
    decorationManager = new DecorationManager(diffTracker);
    statusBarManager = new StatusBarManager(diffTracker);
    originalContentProvider = new OriginalContentProvider(diffTracker);
    inlineContentProvider = new InlineContentProvider(diffTracker);

    // Register tree view provider for activity bar
    const treeDataProvider = new DiffTreeDataProvider(diffTracker);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('diffTracker.changesView', treeDataProvider)
    );

    // Register hover provider to show diff details
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('*', new DiffHoverProvider(diffTracker))
    );

    // Register virtual document provider for original content
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('diff-tracker-original', originalContentProvider)
    );

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('diff-tracker-inline', inlineContentProvider)
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('diffTracker.toggleRecording', () => {
            if (diffTracker.getIsRecording()) {
                diffTracker.stopRecording();
                vscode.commands.executeCommand('setContext', 'diffTracker.isRecording', false);
                treeDataProvider.refresh();
                decorationManager.clearAllDecorations();
            } else {
                diffTracker.startRecording();
                vscode.commands.executeCommand('setContext', 'diffTracker.isRecording', true);
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
            vscode.commands.executeCommand('setContext', 'diffTracker.isRecording', true);
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
            vscode.commands.executeCommand('setContext', 'diffTracker.isRecording', false);
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

            const inlineUri = vscode.Uri.file(filePath).with({ scheme: 'diff-tracker-inline' });
            const doc = await vscode.workspace.openTextDocument(inlineUri);
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
            const originalUri = currentUri.with({ scheme: 'diff-tracker-original' });

            const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'file';

            await vscode.commands.executeCommand('vscode.diff',
                originalUri,
                currentUri,
                `Original  ↔  Current: ${fileName}`
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('diffTracker.showSideBySideDiffActive', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.uri.scheme !== 'file') {
                return;
            }

            await vscode.commands.executeCommand('diffTracker.showSideBySideDiff', editor.document.uri.fsPath);
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
        vscode.commands.registerCommand('diffTracker.revertFile', async (filePathOrItem: string | any) => {
            const filePath = typeof filePathOrItem === 'string'
                ? filePathOrItem
                : filePathOrItem?.filePath;

            if (!filePath) {
                return;
            }

            const answer = await vscode.window.showWarningMessage(
                `Revert changes for ${filePath}? This cannot be undone.`,
                { modal: true },
                'Revert',
                'Cancel'
            );

            if (answer !== 'Revert') {
                return;
            }

            const success = await diffTracker.revertFile(filePath);
            if (success) {
                treeDataProvider.refresh();
                decorationManager.clearAllDecorations();
                vscode.window.showInformationMessage('File reverted to original content');
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

    context.subscriptions.push(
        vscode.commands.registerCommand('diffTracker.showInlineDiffActive', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.uri.scheme !== 'file') {
                return;
            }

            await vscode.commands.executeCommand('diffTracker.showInlineDiff', editor.document.uri.fsPath);
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

    const updateVisibleDecorations = () => {
        vscode.window.visibleTextEditors.forEach(editor => {
            decorationManager.updateDecorations(editor);
        });
    };

    // Update decorations when recording state changes
    diffTracker.onDidChangeRecordingState(() => {
        treeDataProvider.refresh();
        updateVisibleDecorations();
    });

    // Update decorations when changes are tracked
    diffTracker.onDidTrackChanges(() => {
        treeDataProvider.refresh();
        updateVisibleDecorations();
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
    if (inlineContentProvider) {
        inlineContentProvider.dispose();
    }
}
