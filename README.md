# Diff Tracker

Diff Tracker is a VS Code extension that records file changes and shows a Git-like inline diff directly in the editor.

## Features

- Activity Bar view for tracked changes
- Recording mode to start and stop tracking
- Inline diff with added/removed highlights
- Side-by-side diff on demand
- Hover details for deleted/modified content
- Multi-file tracking with timestamps
- Revert per file or revert all
- Clear all tracked diffs
- Editor title buttons for inline and side-by-side diff

## Usage

1. Open the Diff Tracker view from the Activity Bar.
2. Click Start Recording.
3. Edit any file in your workspace.
4. Click a file in the left list to open the inline diff.
5. Use the editor title buttons to open:
   - Inline Diff (single-column)
   - Side-by-Side Diff
6. Use Revert File or Revert All as needed.
7. Click Clear Diffs to remove all tracked changes.
8. Click Stop Recording when you are done.

## How It Works

When recording starts, Diff Tracker:
1. Captures a baseline snapshot for files
2. Watches for content changes
3. Builds inline and side-by-side diffs
4. Updates the editor and the changes view in real time

## Installation

### From VSIX
1. Download the .vsix file
2. Open VS Code
3. Open Extensions (Cmd+Shift+X)
4. Click ... -> Install from VSIX...
5. Select the downloaded .vsix

### Development
1. Clone the repository
2. Run npm install
3. Run npm run compile
4. Press F5 to launch the Extension Development Host

## Requirements

- VS Code ^1.80.0

## Extension Settings

This extension does not add any settings.

## Known Issues

None at this time. Please open an issue if you find a bug.

## Release Notes

### 0.1.0

- Activity Bar entry
- Recording mode for change tracking
- Inline diff highlighting
- Side-by-side diff
- Multi-file tracking with timestamps
- Revert file and revert all
- Clear diffs

### 0.2.0
- change from LCS-based diff to Patience Diff algorithm for more intuitive diff display

## License

MIT
