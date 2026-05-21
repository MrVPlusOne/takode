# Dependency and Install Policy

Takode uses Bun as its package manager. The accepted baseline is pinned with
`packageManager: "bun@1.3.10"` in active package manifests. Use Bun 1.3.10 or
newer when working from source; changing the pinned baseline should be an
intentional dependency-policy change.

## Routine Installs

Use frozen installs for normal setup and after pulling dependency changes:

```bash
bun install --cwd web --frozen-lockfile
```

If you need root developer hooks, install the root package the same way:

```bash
bun install --frozen-lockfile
```

Do not run a plain `bun install` as part of routine development. A plain install
can refresh lockfiles or resolve packages within manifest ranges. Dependency
changes should be explicit work that reviews the manifest and lockfile diff
together.

## Dependency Changes

- Direct dependencies and dev dependencies should use exact versions.
- Start from the currently accepted lockfile state unless the task is explicitly
  a dependency update.
- When adding or updating packages, refresh the relevant lockfile deliberately
  and inspect the diff for unexpected transitive changes.
- Keep package updates separate from unrelated code changes when practical.
- Do not remediate advisories by opportunistically updating package families in
  unrelated quests.

For new dependency additions or routine updates, prefer a 3-day package age gate:

```bash
bun add --exact --minimum-release-age=259200 <package>
```

Use an explicit override only for urgent security fixes or extension/tooling
compatibility work, and document the reason in the quest or commit notes.

## Lifecycle Scripts

Bun blocks most dependency lifecycle scripts unless the package is trusted. When
dependency changes introduce packages with install scripts:

```bash
bun pm untrusted
```

Review each package before trusting it. Prefer focused trust decisions over broad
trust-all behavior. Lockfile review should pay special attention to native or
binary package families and newly introduced lifecycle scripts.

## Helper Scripts

Repo helper scripts should fail fast when dependencies are missing. If a helper
offers convenience installation, it must be explicit and frozen-lockfile based.
The current opt-in convention is:

```bash
TAKODE_AUTO_INSTALL=1 <command>
```

Running app or tool entrypoints should avoid implicit package fetches where
practical by using Bun's `--no-install` mode.

## VS Code Extension Tooling

`@vscode/vsce` is trusted VS Code extension packaging tooling, not part of the
Takode server runtime dependency surface. Keep it local to
`vscode/takode-panel-prototype/` as an exact-pinned dev dependency and invoke it
through the local package binary.

Review `@vscode/vsce` when changing VS Code extension packaging or bumping
`engines.vscode`, so the tool does not fall far behind VS Code marketplace
requirements.
