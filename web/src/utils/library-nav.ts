import { create } from "zustand";
import { openSecondaryPage } from "./secondary-view.js";

/**
 * What the Library page (the artifact gallery) shows: whose artifacts, and the artifact open in it.
 * Opening an artifact from a conversation (its "Saved in Library" line, a collapsed older version
 * or an artifact link) opens the Library there; a leader's topic panel opens that leader's.
 * Local UI state.
 */
interface LibraryNavState {
  artifactId: string | null;
  version: number | null;
  /** The leader whose artifacts are shown (what it and its workers made); null for a space or all. */
  leaderId: string | null;
}

export const useLibraryNav = create<LibraryNavState>(() => ({
  artifactId: null,
  version: null,
  leaderId: null,
}));

export function openLibraryArtifact(artifactId: string, version?: number): void {
  useLibraryNav.setState({ artifactId, version: version ?? null });
  openSecondaryPage("library");
}

export function showLibraryArtifact(artifactId: string | null, version?: number): void {
  useLibraryNav.setState({ artifactId, version: version ?? null });
}

/** Opens the gallery of what a leader and its workers made. */
export function openLeaderLibrary(leaderId: string): void {
  useLibraryNav.setState({ leaderId, artifactId: null, version: null });
  openSecondaryPage("library");
}

/** Shows a space, or all spaces, instead of a leader's artifacts. */
export function setLibraryLeader(leaderId: string | null): void {
  useLibraryNav.setState({ leaderId });
}
