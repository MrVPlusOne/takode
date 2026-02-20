/**
 * Test mock for react-virtuoso.
 *
 * JSDOM has no real layout engine, so Virtuoso can't measure items and renders
 * nothing. This mock replaces Virtuoso with a simple div that renders all items
 * inline — existing @testing-library tests continue to work unchanged.
 */
import React, { useEffect, useImperativeHandle } from "react";

interface VirtuosoProps<D, C> {
  data?: D[];
  itemContent?: (index: number, data: D, context: C) => React.ReactNode;
  context?: C;
  components?: {
    Header?: React.ComponentType<{ context?: C }>;
    Footer?: React.ComponentType<{ context?: C }>;
  };
  scrollerRef?: (ref: HTMLElement | Window | null) => void;
  firstItemIndex?: number;
  initialTopMostItemIndex?: number;
  atBottomThreshold?: number;
  increaseViewportBy?: number | { top: number; bottom: number };
  followOutput?: ((isAtBottom: boolean) => boolean | string) | boolean | string;
  atBottomStateChange?: (atBottom: boolean) => void;
  startReached?: () => void;
  style?: React.CSSProperties;
  className?: string;
  ref?: React.Ref<VirtuosoHandle>;
}

interface VirtuosoHandle {
  scrollTo: (location: { top?: number; behavior?: string }) => void;
  scrollToIndex: (location: { index: number; align?: string; behavior?: string }) => void;
}

function VirtuosoInner<D, C>(
  {
    data,
    itemContent,
    context,
    components,
    scrollerRef,
    style,
    className,
    atBottomStateChange,
  }: VirtuosoProps<D, C>,
  ref: React.ForwardedRef<VirtuosoHandle>,
) {
  const scrollerElRef = React.useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    scrollTo: () => {},
    scrollToIndex: () => {},
  }));

  useEffect(() => {
    if (scrollerRef && scrollerElRef.current) {
      scrollerRef(scrollerElRef.current);
    }
    return () => { scrollerRef?.(null); };
  }, [scrollerRef]);

  useEffect(() => {
    // Simulate being at bottom initially
    atBottomStateChange?.(true);
  }, [atBottomStateChange]);

  const Header = components?.Header;
  const Footer = components?.Footer;

  return (
    <div ref={scrollerElRef} style={style} className={className}>
      {Header && <Header context={context} />}
      {data?.map((item, i) => (
        <div key={i}>
          {itemContent?.(i, item, context as C)}
        </div>
      ))}
      {Footer && <Footer context={context} />}
    </div>
  );
}

export const Virtuoso = React.forwardRef(VirtuosoInner) as <D, C>(
  props: VirtuosoProps<D, C> & { ref?: React.Ref<VirtuosoHandle> },
) => React.ReactElement;

export type { VirtuosoHandle };
