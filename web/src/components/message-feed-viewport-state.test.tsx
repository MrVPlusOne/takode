// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useIdempotentState } from "./message-feed-viewport-state.js";

describe("useIdempotentState", () => {
  it("does not rerender for repeated same-value boolean writes", () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useIdempotentState(false);
    });

    act(() => result.current[1](false));
    expect(renderCount).toBe(1);

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(renderCount).toBe(2);

    act(() => result.current[1](true));
    expect(renderCount).toBe(2);
  });

  it("supports functional updates while preserving same-value no-ops", () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useIdempotentState(false);
    });

    act(() => result.current[1]((current) => current));
    expect(renderCount).toBe(1);

    act(() => result.current[1]((current) => !current));
    expect(result.current[0]).toBe(true);
    expect(renderCount).toBe(2);
  });
});
