# Takode VS Code Panel Prototype

This is a minimal VS Code extension prototype that renders the existing Takode web app inside a `WebviewPanel` by loading the local Takode URL in an iframe.

Why this shape:

- It preserves the current Takode frontend exactly as-is instead of rebuilding it for VS Code.
- It preserves Takode's own `window.location`, hash routing, WebSocket URLs, and browser `localStorage` because the iframe still runs on the Takode origin.
- It keeps the future editor-context bridge simple: the extension can later send selection/diagnostic context into the wrapper or directly into Takode.

## What it does

- Adds `Takode: Open Panel`
- Adds `Takode: Reload Panel`
- Loads `http://localhost:5174` by default
- Shows a lightweight error overlay if the local Takode server is not reachable
- Keeps the panel alive while hidden by default
- Streams the current VS Code cursor or selection into the embedded Takode UI
- Lets the Takode composer decide whether that VS Code context is appended to outgoing user messages

## Try it

1. Start Takode.

   Development:

   ```bash
   make dev
   ```

   Production-style local server:

   ```bash
   cd web
   bun run build
   bun run start
   ```

2. Launch desktop VS Code with this extension in development mode:

   ```bash
   code --extensionDevelopmentPath=/home/jiayiwei/.companion/worktrees/companion/jiayi-wt-7712/vscode/takode-panel-prototype
   ```

3. In the Extension Development Host window, run `Takode: Open Panel` from the command palette.

If you are inside a remote shell and `code` says `Ignoring option 'extensionDevelopmentPath'`, that is not the desktop VS Code CLI. It is usually the Remote SSH / server-side shim. In that case, run the command on your local machine instead, or use the local install script below.

## Install without `--extensionDevelopmentPath`

If your editor CLI does not support launching an extension development host, install the unpacked extension into your local editor extensions directory:

```bash
/home/jiayiwei/.companion/worktrees/companion/jiayi-wt-7712/vscode/takode-panel-prototype/scripts/install-local.sh
```

Examples:

```bash
/home/jiayiwei/.companion/worktrees/companion/jiayi-wt-7712/vscode/takode-panel-prototype/scripts/install-local.sh vscode
/home/jiayiwei/.companion/worktrees/companion/jiayi-wt-7712/vscode/takode-panel-prototype/scripts/install-local.sh cursor
```

Then reload the editor window and run `Takode: Open Panel`.

## Settings

- `takodePrototype.baseUrl`
  - Default: `http://localhost:5174`
  - For a production server, change this to the Takode server URL, for example `http://localhost:3456`
- `takodePrototype.retainContextWhenHidden`
  - Default: `true`

## Notes on storage

This prototype intentionally uses an iframe so Takode keeps using its own origin storage. That means:

- the dev server (`127.0.0.1:5174`) and production server (`127.0.0.1:3456`) will have different `localStorage` buckets
- Takode's existing server-scoped storage behavior is left untouched
- in Remote SSH, the extension now prefers the workspace host and uses webview port mapping for `localhost`, so the panel can reach the Takode server on the remote machine without relying on your own manual port forward

## VS Code selection behavior

- The extension sends the active editor selection into the Takode iframe as local UI context only.
- The real Takode composer renders that line inside the app.
- The composer exposes an `Attach on` / `Attach off` toggle:
  - `Attach on`: appends a suffix like `[user cursor in VSCode: path:line:col] (this may or may not be relevant)` to the outgoing user message
  - `Attach off`: still shows the live VS Code selection in the UI, but sends the message unchanged
- A normal browser-only Takode session behaves exactly as before.

## Next obvious step

Once panel rendering feels good, the next minimal integration is:

- `window.onDidChangeActiveTextEditor`
- `window.onDidChangeTextEditorSelection`
- `languages.getDiagnostics(activeEditor.document.uri)`

That can be attached as structured context to the next user message without changing the Takode UI architecture first.
