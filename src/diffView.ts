import * as vscode from 'vscode';
import { DiffTracker, FileDiff } from './diffTracker';

export class DiffViewProvider {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly diffTracker: DiffTracker
    ) { }

    public async show() {
        const columnToShowIn = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (this.panel) {
            this.panel.reveal(columnToShowIn);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'diffTrackerView',
                'Diff Tracker - Changes',
                columnToShowIn || vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this.extensionUri, 'media')
                    ]
                }
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            this.panel.webview.onDidReceiveMessage(
                message => {
                    switch (message.command) {
                        case 'clearDiffs':
                            this.diffTracker.clearDiffs();
                            this.update();
                            break;
                        case 'openFile':
                            this.openFile(message.filePath);
                            break;
                    }
                }
            );
        }

        this.update();
    }

    public update() {
        if (this.panel) {
            this.panel.webview.html = this.getWebviewContent();
        }
    }

    private async openFile(filePath: string) {
        const uri = vscode.Uri.file(filePath);
        await vscode.window.showTextDocument(uri);
    }

    private getWebviewContent(): string {
        const changes = this.diffTracker.getTrackedChanges();

        if (changes.length === 0) {
            return this.getEmptyStateHtml();
        }

        const diffsHtml = changes.map(diff => this.generateDiffHtml(diff)).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Diff Tracker</title>
    <style>
        ${this.getStyles()}
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 Tracked Changes</h1>
        <button onclick="clearAllDiffs()" class="clear-btn">Clear All</button>
    </div>
    <div class="diffs-container">
        ${diffsHtml}
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        
        function clearAllDiffs() {
            vscode.postMessage({ command: 'clearDiffs' });
        }
        
        function openFile(filePath) {
            vscode.postMessage({ command: 'openFile', filePath: filePath });
        }
    </script>
</body>
</html>`;
    }

    private getEmptyStateHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Diff Tracker</title>
    <style>
        ${this.getStyles()}
    </style>
</head>
<body>
    <div class="empty-state">
        <h2>No Changes Tracked</h2>
        <p>Start recording and make changes to files to see diffs here.</p>
    </div>
</body>
</html>`;
    }

    private generateDiffHtml(fileDiff: FileDiff): string {
        const timeStr = fileDiff.timestamp.toLocaleTimeString();
        let lineNumber = 1;
        let originalLineNumber = 1;
        let currentLineNumber = 1;

        const linesHtml = fileDiff.changes.map(change => {
            if (change.added) {
                const lines = change.value.split('\n').filter((l: string) => l !== '');
                const result = lines.map((line: string) => {
                    const html = `
                        <div class="diff-line added">
                            <span class="line-num old"></span>
                            <span class="line-num new">${currentLineNumber}</span>
                            <span class="line-marker">+</span>
                            <span class="line-content">${this.escapeHtml(line)}</span>
                        </div>`;
                    currentLineNumber++;
                    return html;
                }).join('');
                return result;
            } else if (change.removed) {
                const lines = change.value.split('\n').filter((l: string) => l !== '');
                const result = lines.map((line: string) => {
                    const html = `
                        <div class="diff-line removed">
                            <span class="line-num old">${originalLineNumber}</span>
                            <span class="line-num new"></span>
                            <span class="line-marker">-</span>
                            <span class="line-content">${this.escapeHtml(line)}</span>
                        </div>`;
                    originalLineNumber++;
                    return html;
                }).join('');
                return result;
            } else {
                // Unchanged - only show context (first and last 2 lines)
                const lines = change.value.split('\n').filter((l: string) => l !== '');
                if (lines.length > 6) {
                    // Show first 2 and last 2 lines with ellipsis
                    const firstLines = lines.slice(0, 2);
                    const lastLines = lines.slice(-2);

                    let result = firstLines.map((line: string) => {
                        const html = `
                            <div class="diff-line unchanged">
                                <span class="line-num old">${originalLineNumber}</span>
                                <span class="line-num new">${currentLineNumber}</span>
                                <span class="line-marker"> </span>
                                <span class="line-content">${this.escapeHtml(line)}</span>
                            </div>`;
                        originalLineNumber++;
                        currentLineNumber++;
                        return html;
                    }).join('');

                    const skippedCount = lines.length - 4;
                    result += `
                        <div class="diff-line ellipsis">
                            <span class="line-num old">...</span>
                            <span class="line-num new">...</span>
                            <span class="line-marker"> </span>
                            <span class="line-content">... (${skippedCount} unchanged lines) ...</span>
                        </div>`;
                    originalLineNumber += skippedCount;
                    currentLineNumber += skippedCount;

                    result += lastLines.map((line: string) => {
                        const html = `
                            <div class="diff-line unchanged">
                                <span class="line-num old">${originalLineNumber}</span>
                                <span class="line-num new">${currentLineNumber}</span>
                                <span class="line-marker"> </span>
                                <span class="line-content">${this.escapeHtml(line)}</span>
                            </div>`;
                        originalLineNumber++;
                        currentLineNumber++;
                        return html;
                    }).join('');

                    return result;
                } else {
                    return lines.map((line: string) => {
                        const html = `
                            <div class="diff-line unchanged">
                                <span class="line-num old">${originalLineNumber}</span>
                                <span class="line-num new">${currentLineNumber}</span>
                                <span class="line-marker"> </span>
                                <span class="line-content">${this.escapeHtml(line)}</span>
                            </div>`;
                        originalLineNumber++;
                        currentLineNumber++;
                        return html;
                    }).join('');
                }
            }
        }).join('');

        return `
            <div class="file-diff">
                <div class="file-header" onclick="openFile('${fileDiff.filePath}')">
                    <span class="file-name">📄 ${fileDiff.fileName}</span>
                    <span class="file-time">${timeStr}</span>
                </div>
                <div class="diff-content">
                    ${linesHtml}
                </div>
            </div>
        `;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/ /g, '&nbsp;')
            .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
    }

    private getStyles(): string {
        return `
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                padding: 20px;
            }

            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                padding-bottom: 15px;
                border-bottom: 1px solid var(--vscode-panel-border);
            }

            h1 {
                font-size: 24px;
                font-weight: 600;
            }

            .clear-btn {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 8px 16px;
                cursor: pointer;
                border-radius: 4px;
                font-size: 14px;
                transition: background-color 0.2s;
            }

            .clear-btn:hover {
                background-color: var(--vscode-button-hoverBackground);
            }

            .empty-state {
                text-align: center;
                padding: 60px 20px;
                color: var(--vscode-descriptionForeground);
            }

            .empty-state h2 {
                margin-bottom: 10px;
                font-size: 20px;
            }

            .diffs-container {
                display: flex;
                flex-direction: column;
                gap: 20px;
            }

            .file-diff {
                border: 1px solid var(--vscode-panel-border);
                border-radius: 6px;
                overflow: hidden;
                background-color: var(--vscode-editor-background);
            }

            .file-header {
                background-color: var(--vscode-editorGroupHeader-tabsBackground);
                padding: 12px 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: pointer;
                transition: background-color 0.2s;
            }

            .file-header:hover {
                background-color: var(--vscode-list-hoverBackground);
            }

            .file-name {
                font-weight: 600;
                font-size: 15px;
            }

            .file-time {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
            }

            .diff-content {
                font-family: var(--vscode-editor-font-family);
                font-size: 13px;
                line-height: 1.6;
            }

            .diff-line {
                display: flex;
                align-items: center;
                padding: 2px 0;
                min-height: 22px;
            }

            .line-num {
                display: inline-block;
                width: 50px;
                text-align: right;
                padding: 0 8px;
                color: var(--vscode-editorLineNumber-foreground);
                font-size: 12px;
                user-select: none;
                flex-shrink: 0;
            }

            .line-marker {
                display: inline-block;
                width: 20px;
                text-align: center;
                font-weight: bold;
                flex-shrink: 0;
            }

            .line-content {
                flex: 1;
                padding: 0 8px;
                white-space: pre;
                overflow-x: auto;
            }

            .diff-line.added {
                background-color: rgba(63, 185, 80, 0.15);
            }

            .diff-line.added .line-marker {
                color: #3fb950;
            }

            .diff-line.removed {
                background-color: rgba(248, 81, 73, 0.15);
            }

            .diff-line.removed .line-marker {
                color: #f85149;
            }

            .diff-line.unchanged {
                opacity: 0.6;
            }

            .diff-line.ellipsis {
                background-color: var(--vscode-editorGutter-background);
                opacity: 0.5;
                font-style: italic;
            }

            /* Scrollbar styling */
            ::-webkit-scrollbar {
                width: 10px;
                height: 10px;
            }

            ::-webkit-scrollbar-track {
                background: var(--vscode-scrollbarSlider-background);
            }

            ::-webkit-scrollbar-thumb {
                background: var(--vscode-scrollbarSlider-hoverBackground);
                border-radius: 5px;
            }

            ::-webkit-scrollbar-thumb:hover {
                background: var(--vscode-scrollbarSlider-activeBackground);
            }
        `;
    }
}
