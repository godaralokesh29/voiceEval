/**
 * Browser audio helpers for the Gemini Live interview.
 *
 *  - startMicCapture: mic → PCM16 mono 16 kHz chunks (what Gemini Live expects as input)
 *  - PcmPlayer:       PCM16 mono 24 kHz chunks (Gemini Live output) → gapless playback,
 *                     with flush() to cut the AI off instantly when the candidate interrupts.
 *  - createLevelMeter: 0..1 volume getter for any AudioNode (drives the voice orbs).
 */

export const INPUT_SAMPLE_RATE = 16000;
export const OUTPUT_SAMPLE_RATE = 24000;

// Runs on the audio thread. Downsamples (box filter, works for any input rate) and converts to Int16.
const CAPTURE_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { targetRate, chunkSamples } = options.processorOptions;
    this.ratio = sampleRate / targetRate;
    this.chunkSamples = chunkSamples;
    this.chunk = new Int16Array(chunkSamples);
    this.offset = 0;
    this.acc = 0;
    this.count = 0;
    this.phase = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.acc += input[i];
      this.count++;
      this.phase += 1;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        const s = Math.max(-1, Math.min(1, this.acc / this.count));
        this.acc = 0;
        this.count = 0;
        this.chunk[this.offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.offset === this.chunkSamples) {
          this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
          this.chunk = new Int16Array(this.chunkSamples);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export interface MicCapture {
    /** The mic source node, e.g. for metering. */
    source: MediaStreamAudioSourceNode;
    stop(): void;
}

/** Streams the mic as PCM16 16 kHz chunks (~32 ms each) to `onChunk`. */
export async function startMicCapture(
    ctx: AudioContext,
    stream: MediaStream,
    onChunk: (pcm: ArrayBuffer) => void,
): Promise<MicCapture> {
    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
    try {
        await ctx.audioWorklet.addModule(url);
    } finally {
        URL.revokeObjectURL(url);
    }

    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-capture", {
        processorOptions: { targetRate: INPUT_SAMPLE_RATE, chunkSamples: 512 },
    });
    // The worklet must be connected to the destination to be pulled; keep it silent.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(ctx.destination);
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(e.data);

    return {
        source,
        stop() {
            node.port.onmessage = null;
            source.disconnect();
            node.disconnect();
            mute.disconnect();
        },
    };
}

/** Schedules incoming PCM16 chunks back-to-back on the AudioContext clock. */
export class PcmPlayer {
    private readonly output: GainNode;
    private readonly sources = new Set<AudioBufferSourceNode>();
    private nextTime = 0;

    constructor(private readonly ctx: AudioContext, private readonly sampleRate = OUTPUT_SAMPLE_RATE) {
        this.output = ctx.createGain();
        this.output.connect(ctx.destination);
    }

    /** Output node, for metering the AI's voice. */
    get node(): AudioNode {
        return this.output;
    }

    enqueue(pcm: ArrayBuffer) {
        const samples = new Int16Array(pcm, 0, pcm.byteLength >> 1);
        if (samples.length === 0) return;

        const buffer = this.ctx.createBuffer(1, samples.length, this.sampleRate);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 32768;

        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(this.output);

        // After an underrun (or at the start of a turn) leave a small jitter buffer.
        const now = this.ctx.currentTime;
        if (this.nextTime < now + 0.01) this.nextTime = now + 0.05;
        src.start(this.nextTime);
        this.nextTime += buffer.duration;

        this.sources.add(src);
        src.onended = () => this.sources.delete(src);
    }

    /** Stop everything that is playing or queued (used on interruption). */
    flush() {
        for (const src of this.sources) {
            try {
                src.stop();
            } catch {
                // already stopped
            }
        }
        this.sources.clear();
        this.nextTime = 0;
    }
}

/** Attaches an analyser to a node and returns a getter for its current 0..1 volume level. */
export function createLevelMeter(ctx: AudioContext, node: AudioNode) {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    node.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    return () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            const v = (data[i]! - 128) / 128;
            sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        // Boost and clamp so normal speech fills most of the range.
        return Math.min(1, rms * 3.2);
    };
}
