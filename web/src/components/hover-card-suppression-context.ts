import { createContext, useContext } from "react";

const HoverCardSuppressionContext = createContext(false);

export const HoverCardSuppressionProvider = HoverCardSuppressionContext.Provider;

export function useHoverCardsSuppressed(): boolean {
  return useContext(HoverCardSuppressionContext);
}
