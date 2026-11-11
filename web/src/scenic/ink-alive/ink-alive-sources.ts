/**
 * Where the living Ink & Paper's sea of clouds comes from: broad, soft banks of cloud entering
 * along the right edge at the heights of the valleys, the lowest and thickest one at the feet of
 * the peaks. Each waxes and wanes over a minute or two, so the clouds arrive in rolling banks
 * rather than a steady sheet. Pure and seeded, so it can be tested without a GPU.
 */
import type { CloudSplat } from "./ink-alive-fluid.js";

export class CloudBanks {
  private state: number;
  private readonly phases: number[];

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
    this.phases = [0, 1, 2, 3].map(() => this.random() * 100);
  }

  /**
   * Cloud to add over the last `dt` seconds of scene time `time` (it slows with the scene's hush),
   * for a pane whose lake line sits at `horizon` (a fraction of its height, from the top).
   */
  release(time: number, dt: number, horizon: number): CloudSplat[] {
    if (dt <= 0) return [];
    // Valley heights, from the high streams to the sea of clouds at the peaks' feet.
    const heights = [horizon - 0.34, horizon - 0.22, horizon - 0.12, horizon - 0.04];
    return heights.map((y, i) => {
      const phase = this.phases[i]!;
      // Slow swells: each bank thickens and thins but never stops, so the valleys never empty,
      // and the banks arrive with clear air between them rather than as one even sheet.
      // The lowest bank, the sea itself, only breathes: a gap there opened a hole down to the lake.
      const low = i === 3 ? 0.55 : 0.15;
      const swell = low + (1 - low) * Math.max(0, Math.sin(time * (0.05 + i * 0.013) + phase)) ** 2;
      return {
        x: 1.02,
        // Each bank rises and sinks as it comes in, and is broad, so the banks blend into one
        // rolling sea; fixed narrow sources left clear horizontal stripes between them.
        y:
          y + (Math.sin(time * 0.07 + phase) * 0.035 + Math.sin(time * 0.19 + phase * 2) * 0.015) * (i === 3 ? 0.5 : 1),
        amount: (i === 3 ? 0.12 : 0.075) * swell * dt,
        radius: i === 3 ? 0.075 : 0.06,
        push: [0, 0] as [number, number],
      };
    });
  }

  private random() {
    this.state ^= this.state << 13;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    return (this.state >>> 0) / 4294967296;
  }
}
