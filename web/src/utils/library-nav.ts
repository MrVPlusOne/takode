import { create } from "zustand";
import { openSecondaryPage } from "./secondary-view.js";

/**
 * Which artifact the Library page shows. Opening an artifact from a conversation (its "Saved in
 * Library" line or a collapsed older version) opens the Library at that artifact; local UI state.
 */
interface LibraryNavState {
  artifactId: string | null;
  version: number | null;
}

export const useLibraryNav = create<LibraryNavState>(() => ({
  artifactId: null,
  version: null,
}));

export function openLibraryArtifact(artifactId: string, version?: number): void {
  useLibraryNav.setState({ artifactId, version: version ?? null });
  openSecondaryPage("library");
}

export function showLibraryArtifact(artifactId: string | null, version?: number): void {
  useLibraryNav.setState({ artifactId, version: version ?? null });
}
