import { create } from "zustand";
import { openSecondaryPage } from "./secondary-view.js";

/**
 * What the Library page shows: its tab, and the artifact or topic open in it. Opening an artifact from
 * a conversation (its "Saved in Library" line or a collapsed older version), or a topic from the Done
 * list, opens the Library there; local UI state.
 */
interface LibraryNavState {
  artifactId: string | null;
  version: number | null;
  /** The topic open in the Topics tab. */
  topicId: string | null;
  mode: "topics" | "artifacts";
}

export const useLibraryNav = create<LibraryNavState>(() => ({
  artifactId: null,
  version: null,
  topicId: null,
  mode: "artifacts",
}));

export function openLibraryArtifact(artifactId: string, version?: number): void {
  useLibraryNav.setState({ artifactId, version: version ?? null, mode: "artifacts" });
  openSecondaryPage("library");
}

export function showLibraryArtifact(artifactId: string | null, version?: number): void {
  useLibraryNav.setState({ artifactId, version: version ?? null });
}

/** Opens the Library's Topics tab at a topic, as the Done list's topic headings do. */
export function openLibraryTopic(topicId: string | null): void {
  useLibraryNav.setState({ topicId, mode: "topics" });
  openSecondaryPage("library");
}

export function showLibraryTopic(topicId: string | null): void {
  useLibraryNav.setState({ topicId });
}

export function setLibraryMode(mode: "topics" | "artifacts"): void {
  useLibraryNav.setState({ mode });
}
