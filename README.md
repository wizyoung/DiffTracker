# Diff Tracker

A powerful VS Code extension that visually tracks file changes in real-time with an intuitive diff display.

## Features

- **📍 Activity Bar Integration**: Convenient sidebar icon for easy access
- **🎥 Recording Mode**: Start/stop tracking file changes with a single click
- **🎨 Visual Diff Display**: Beautiful, color-coded diff view showing additions (green) and deletions (red)
- **📄 Multi-file Support**: Track changes across multiple files simultaneously
- **⏱️ Timestamp Tracking**: See when each change was made
- **🔍 Line-by-line Comparison**: Detailed view with line numbers for both original and modified content

## Usage

1. **Open the Diff Tracker** by clicking the recording icon in the activity bar (leftmost sidebar)

2. **Start Recording** by clicking the "Start Recording" button in the sidebar

3. **Edit Files** - make changes to any files in your workspace

4. **View Diffs** - click "View Diffs" to see all tracked changes in a visual diff panel

5. **Stop Recording** when you're done to prevent tracking new changes

6. **Clear Diffs** to remove all tracked changes from the view

## How It Works

When you start recording, Diff Tracker:
1. Captures a snapshot of all currently open files
2. Monitors file changes in real-time
3. Generates visual diffs comparing original vs. modified content
4. Displays changes with syntax highlighting and line numbers

## Installation

### From VSIX
1. Download the `.vsix` file
2. Open VS Code
3. Go to Extensions view (Cmd+Shift+X)
4. Click the "..." menu → "Install from VSIX..."
5. Select the downloaded `.vsix` file

### Development
1. Clone this repository
2. Run `npm install`
3. Run `npm run compile`
4. Press F5 to launch Extension Development Host

## Requirements

- VS Code ^1.80.0

## Extension Settings

This extension does not add any VS Code settings.

## Known Issues

None at this time. Please report issues on the GitHub repository.

## Release Notes

### 0.1.0

Initial release:
- Activity bar integration
- Recording mode for change tracking
- Visual diff display with red/green highlighting
- Multi-file support
- Clear and stop recording functionality

## License

MIT
