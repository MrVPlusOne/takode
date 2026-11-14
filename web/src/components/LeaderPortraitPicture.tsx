import type { ImgHTMLAttributes } from "react";
import { useStore } from "../store.js";
import { leaderProfilePortraitInkUrl, type LeaderProfilePortrait } from "../../shared/leader-profile-portraits.js";

interface LeaderPortraitPictureProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> {
  portrait: LeaderProfilePortrait;
  /** `small` is the 96 px file for avatars and grids, `large` the 320 px one. */
  variant?: "small" | "large";
}

/**
 * A leader portrait's `<img>`. While the Ink & Paper background is on it shows the portrait's
 * ink-wash painting instead, a little dimmed in the dark theme so its cream paper doesn't glare
 * on dark panels. Only the picture shown is ever requested, so the ink files load only with
 * Ink & Paper on.
 */
export function LeaderPortraitPicture({ portrait, variant = "small", className, ...img }: LeaderPortraitPictureProps) {
  const ink = useStore((state) => state.scenicBackground === "ink");
  const dark = useStore((state) => state.darkMode);
  const inkUrl = ink ? leaderProfilePortraitInkUrl(portrait, variant) : null;
  const size = variant === "small" ? portrait.smallSize : portrait.largeSize;
  return (
    <img
      {...img}
      src={inkUrl ?? (variant === "small" ? portrait.smallUrl : portrait.largeUrl)}
      width={size}
      height={size}
      data-ink-portrait={inkUrl ? "" : undefined}
      className={inkUrl && dark ? `${className ?? ""} brightness-90` : className}
    />
  );
}
