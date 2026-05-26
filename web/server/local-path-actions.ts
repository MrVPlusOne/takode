import * as childProcess from "node:child_process";
import { dirname, win32 } from "node:path";
import { promisify } from "node:util";

type ExecFile = typeof childProcess.execFile;

export interface LocalPathOpenCapability {
  canOpenContainingFolder: boolean;
  openContainingFolderLabel: string;
  platform: NodeJS.Platform;
  unavailableReason?: string;
}

export interface OpenLocalPathResult {
  ok: true;
  absolutePath: string;
  openedPath: string;
  platform: NodeJS.Platform;
}

export function getLocalPathOpenCapability(platform: NodeJS.Platform = process.platform): LocalPathOpenCapability {
  switch (platform) {
    case "darwin":
      return { canOpenContainingFolder: true, openContainingFolderLabel: "Open in Finder", platform };
    case "win32":
      return { canOpenContainingFolder: true, openContainingFolderLabel: "Open in Explorer", platform };
    case "linux":
    case "freebsd":
    case "openbsd":
      return { canOpenContainingFolder: true, openContainingFolderLabel: "Open folder", platform };
    default:
      return {
        canOpenContainingFolder: false,
        openContainingFolderLabel: "Open folder",
        platform,
        unavailableReason: `Opening local folders is not supported on ${platform}`,
      };
  }
}

export async function openLocalPathContainingFolder({
  absolutePath,
  isDirectory,
  platform = process.platform,
  execFile = childProcess.execFile,
}: {
  absolutePath: string;
  isDirectory: boolean;
  platform?: NodeJS.Platform;
  execFile?: ExecFile;
}): Promise<OpenLocalPathResult> {
  const capability = getLocalPathOpenCapability(platform);
  if (!capability.canOpenContainingFolder) {
    throw new Error(capability.unavailableReason ?? `Opening local folders is not supported on ${platform}`);
  }

  const { command, args, openedPath } = buildOpenCommand({ absolutePath, isDirectory, platform });
  await promisify(execFile)(command, args);
  return { ok: true, absolutePath, openedPath, platform };
}

function buildOpenCommand({
  absolutePath,
  isDirectory,
  platform,
}: {
  absolutePath: string;
  isDirectory: boolean;
  platform: NodeJS.Platform;
}): { command: string; args: string[]; openedPath: string } {
  if (platform === "darwin") {
    return isDirectory
      ? { command: "open", args: [absolutePath], openedPath: absolutePath }
      : { command: "open", args: ["-R", absolutePath], openedPath: dirname(absolutePath) };
  }

  if (platform === "win32") {
    return isDirectory
      ? { command: "explorer.exe", args: [absolutePath], openedPath: absolutePath }
      : { command: "explorer.exe", args: [`/select,${absolutePath}`], openedPath: win32.dirname(absolutePath) };
  }

  const openedPath = isDirectory ? absolutePath : dirname(absolutePath);
  return { command: "xdg-open", args: [openedPath], openedPath };
}

export const _testHelpers = {
  buildOpenCommand,
};
