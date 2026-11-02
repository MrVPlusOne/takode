import { createContext, useContext } from "react";
import type { ArtifactKind, ArtifactMessageMarker } from "../../shared/artifact-library.js";
import { artifactApi } from "../api/artifacts.js";
import { openLibraryArtifact } from "../utils/library-nav.js";
import { newWindowClickLabel, openArtifactWindow } from "../utils/artifact-window.js";
import { canOpenInSide, openArtifactInSide } from "../utils/side-column.js";
import type { ContextMenuItem } from "./ContextMenu.js";

/** The Library entries a message saved, for the cards that show them (drafts, reports, visuals). */
export const ArtifactMarkersContext = createContext<readonly ArtifactMessageMarker[] | undefined>(undefined);

/**
 * The marker of the artifact a card in a message shows: the one of its kind with the card's title,
 * else the message's only one of that kind (an untitled card, or one renamed in the Library).
 * Read-only views provide no markers, so their cards show no Library items.
 */
export function useArtifactMarker(kind: ArtifactKind, title: string | undefined): ArtifactMessageMarker | undefined {
  const ofKind = (useContext(ArtifactMarkersContext) ?? []).filter((marker) => marker.kind === kind);
  const named = title
    ? ofKind.find((marker) => marker.title.trim().toLowerCase() === title.trim().toLowerCase())
    : undefined;
  return named ?? (ofKind.length === 1 ? ofKind[0] : undefined);
}

/**
 * The More menu items of a card's artifact: opening it elsewhere (in the Library at its version,
 * named when there are several; in the side column while a leader's conversation is on screen; in a
 * window of its own), and starring it. Cards open full screen from their header; these are the less
 * common places. The star is the Library's: the server refreshes the conversations showing the
 * artifact, so the item reads Unstar once the star is saved, here and on other devices.
 */
export function libraryMenuItems(marker: ArtifactMessageMarker): ContextMenuItem[] {
  const target = { id: marker.id, version: marker.version, title: marker.title };
  return [
    {
      label:
        marker.versionCount > 1
          ? `Open version ${marker.version} of ${marker.versionCount} in Library`
          : "Open in Library",
      onClick: () => openLibraryArtifact(marker.id, marker.version),
    },
    ...(canOpenInSide() ? [{ label: "Open in side column", onClick: () => openArtifactInSide(target) }] : []),
    { label: `Open in new window (${newWindowClickLabel()})`, onClick: () => openArtifactWindow(target) },
    {
      label: marker.starred ? "Unstar" : "Star",
      onClick: () => void artifactApi.setStarred(marker.id, !marker.starred).catch(console.error),
    },
  ];
}
