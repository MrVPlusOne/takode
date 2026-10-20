export interface VoiceAudioBridge {
  /** One stable track for MediaRecorder; only the upstream microphone changes. */
  stream: MediaStream;
  analyser: AnalyserNode;
  ready: Promise<boolean>;
  setInput: (stream: MediaStream) => Promise<void>;
  close: () => void;
}

/**
 * Whether a recording may go through the bridge, which is what makes live microphone switching work.
 *
 * WebKit, the engine of Safari and every iPhone browser, fixes an AudioContext's output rate when
 * the context starts and does not follow later audio route changes. Opening a Bluetooth headset
 * microphone such as AirPods, or the built-in mic while AirPods are worn, moves the phone to a
 * lower-rate call route, so a context started before or across that change runs at a fraction of
 * real time and records near-silence. WebKit therefore records the microphone track directly.
 */
export function canRecordThroughVoiceAudioBridge(userAgent = navigator.userAgent): boolean {
  // iPhone Chrome, Edge and Firefox identify as "CriOS", "EdgiOS" and "FxiOS", never "Chrome/".
  return !userAgent.includes("AppleWebKit/") || /\b(Chrome|Chromium)\//.test(userAgent);
}

/**
 * Prepares a continuous recorder input during the recording click. Swapping sources leaves
 * MediaRecorder's track set and encoded file intact. Unsupported or blocked Web Audio lets
 * the caller keep direct capture and apply microphone picks to the next recording instead.
 * A direct recording uses a bridge created once capture is open only for its level meter.
 */
export function createVoiceAudioBridge(): VoiceAudioBridge | null {
  let context: AudioContext | undefined;
  try {
    const ctx = new AudioContext();
    context = ctx;
    const destination = ctx.createMediaStreamDestination();
    destination.channelCount = 1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    let source: MediaStreamAudioSourceNode | null = null;
    let gain: GainNode | null = null;
    let pending: { source: MediaStreamAudioSourceNode; gain: GainNode } | null = null;
    let closed = false;
    // Resume inside the gesture, not after waiting for the microphone permission prompt.
    const resume = ctx.state === "running" ? Promise.resolve() : ctx.resume();
    const ready = waitForAudioContext(ctx, resume);
    return {
      stream: destination.stream,
      analyser,
      ready,
      async setInput(stream) {
        if (closed || ctx.state !== "running") throw new Error("Live microphone switching is unavailable");
        const next = ctx.createMediaStreamSource(stream);
        const nextGain = ctx.createGain();
        nextGain.gain.value = source ? 0 : 1;
        next.connect(nextGain);
        nextGain.connect(destination);
        nextGain.connect(analyser);
        if (source) {
          pending = { source: next, gain: nextGain };
          // Prime the new source's render buffer while the old mic still feeds the recorder.
          // Connecting and immediately dropping the old source can insert silence at the handoff.
          await new Promise((resolve) => setTimeout(resolve, 60));
          if (closed || ctx.state !== "running") {
            next.disconnect();
            nextGain.disconnect();
            pending = null;
            throw new Error("Live microphone switching is unavailable");
          }
        }
        nextGain.gain.value = 1;
        source?.disconnect();
        gain?.disconnect();
        source = next;
        gain = nextGain;
        pending = null;
      },
      close() {
        if (closed) return;
        closed = true;
        source?.disconnect();
        gain?.disconnect();
        pending?.source.disconnect();
        pending?.gain.disconnect();
        destination.stream.getTracks().forEach((track) => track.stop());
        void ctx.close().catch((error) => console.warn("Could not close voice audio context", error));
      },
    };
  } catch (error) {
    console.warn("Live microphone switching is unavailable; using direct capture", error);
    void context?.close().catch((closeError) => console.warn("Could not close voice audio context", closeError));
    return null;
  }
}

async function waitForAudioContext(context: AudioContext, resume: Promise<void>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Some autoplay-blocked contexts leave resume pending. Never make dictation wait indefinitely.
    return await Promise.race([
      resume.then(() => context.state === "running"),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 500);
      }),
    ]);
  } catch (error) {
    console.warn("Could not start live microphone switching", error);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
