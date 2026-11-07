// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { api } from "../api.js";
import type { BackupStatus } from "../../shared/backup-status.js";
import { SettingsBackupSection } from "./SettingsBackupSection.js";

// The Backups group: setting the repository and the machine copy, the status
// of the last backup, machine copy and restore test, and the buttons that
// start a backup or test. The server and host list are mocked.

vi.mock("../remote-hosts.js", () => ({
  useRemoteHosts: () => ({ hosts: [{ id: "laptop-id", name: "laptop" }], loaded: true, local: null }),
}));

const OFF: BackupStatus = {
  repoUrl: "",
  host: null,
  hostName: null,
  running: null,
  consecutiveFailures: 0,
  failureAlerted: false,
};
const REPO = "https://github.com/owner/takode-backup.git";
const HOUR = 60 * 60_000;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SettingsBackupSection", () => {
  it("saves a repository the user enters, which starts a backup", async () => {
    vi.spyOn(api, "getBackupStatus").mockResolvedValue(OFF);
    const set = vi.spyOn(api, "setBackupTargets").mockResolvedValue({ ...OFF, repoUrl: REPO, running: "backup" });
    render(<SettingsBackupSection />);

    expect(await screen.findByText("Backups are off.")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save repository" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Backup repository Git URL"), { target: { value: ` ${REPO} ` } });
    fireEvent.click(save);

    await waitFor(() => expect(set).toHaveBeenCalledWith({ repoUrl: REPO }));
    expect(await screen.findByText("Backing up…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back up now" })).toBeDisabled();
  });

  it("saves a machine and folder for the copy", async () => {
    vi.spyOn(api, "getBackupStatus").mockResolvedValue(OFF);
    const host = { hostId: "laptop-id", path: "~/Backups/takode.git" };
    const set = vi.spyOn(api, "setBackupTargets").mockResolvedValue({ ...OFF, host, hostName: "laptop" });
    render(<SettingsBackupSection />);

    const save = await screen.findByRole("button", { name: "Save machine" });
    fireEvent.change(screen.getByLabelText("Backup machine"), { target: { value: "laptop-id" } });
    // A machine needs a folder before it can be saved.
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Backup folder on that machine"), { target: { value: host.path } });
    fireEvent.click(save);

    await waitFor(() => expect(set).toHaveBeenCalledWith({ host }));
    expect(await screen.findByText(/Copy on laptop: not updated yet/)).toBeInTheDocument();
  });

  it("shows the last backup, machine copy and restore test, and failures in red", async () => {
    vi.spyOn(api, "getBackupStatus").mockResolvedValue({
      ...OFF,
      repoUrl: REPO,
      host: { hostId: "laptop-id", path: "~/Backups/takode.git" },
      hostName: "laptop",
      lastRun: {
        startedAt: Date.now() - 2 * HOUR,
        finishedAt: Date.now() - 2 * HOUR,
        ok: false,
        changed: false,
        commit: "abc",
        quests: 3,
        errors: ["push to the backup repository failed: denied"],
      },
      lastSuccessAt: Date.now() - 5 * HOUR,
      consecutiveFailures: 3,
      hostSync: {
        waiting: "laptop is offline",
        lastSuccessAt: Date.now() - 24 * HOUR,
        error: null,
        consecutiveFailures: 0,
        failureAlerted: false,
      },
      lastTest: { at: Date.now() - 24 * HOUR, ok: true, snapshotAt: null, problems: [] },
    });
    render(<SettingsBackupSection />);

    expect(await screen.findByText(/Last backup 2h ago failed: push to the backup repository failed/)).toHaveClass(
      "text-cc-error",
    );
    expect(screen.getByText(/3 failures in a row; last success 5h ago/)).toBeInTheDocument();
    expect(screen.getByText("Copy on laptop: updated 1d ago; waiting (laptop is offline).")).toHaveClass(
      "text-cc-muted",
    );
    expect(screen.getByText("Restore test 1d ago: passed.")).toBeInTheDocument();
  });

  it("starts a backup or a restore test, and shows a refusal", async () => {
    const ready: BackupStatus = { ...OFF, repoUrl: REPO, lastSuccessAt: Date.now() - HOUR };
    vi.spyOn(api, "getBackupStatus").mockResolvedValue(ready);
    const run = vi.spyOn(api, "startBackup").mockResolvedValue({ ...ready, running: "backup" });
    vi.spyOn(api, "startBackupRestoreTest").mockRejectedValue(new Error("A backup run is under way."));
    render(<SettingsBackupSection />);

    fireEvent.click(await screen.findByRole("button", { name: "Test restore" }));
    expect(await screen.findByText(/A backup run is under way/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(await screen.findByText("Backing up…")).toBeInTheDocument();
  });
});
