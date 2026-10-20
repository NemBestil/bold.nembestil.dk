/**
 * Deterministic, synthetic snapshot/display experiment; this does not measure a phone.
 * Run: npx tsx scripts/benchmark-controller-stream.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CONTROLLER_FRAME_BUFFER_OPTIONS, TableFrameBuffer } from "../network/TableFrameBuffer";
import type { TableFrame } from "../shared/types";

interface Packet { frame: TableFrame; arrival: number }

const controllerOptions = CONTROLLER_FRAME_BUFFER_OPTIONS;
const displayHz = 60;
const speedMetersPerSecond = 6;
const durationMs = 6_000;
const measurementStartMs = 1_000;
const packetGap = { startMs: 3_000, durationMs: 50 };
const modes = [
  { name: "legacy-30hz-raw-ball", streamHz: 30, exactSnapshotPlayout: false, options: { ...controllerOptions, interpolateBall: false } },
  { name: "60hz-raw-ball", streamHz: 60, exactSnapshotPlayout: false, options: { ...controllerOptions, interpolateBall: false } },
  { name: "current-60hz-host-interpolation-25ms", streamHz: 60, exactSnapshotPlayout: false, options: controllerOptions },
  { name: "candidate-60hz-exact-snapshot-playout-25ms", streamHz: 60, exactSnapshotPlayout: true, options: { ...controllerOptions, interpolationDelay: 25, interpolateBall: true } },
] as const;

function snapshot(sequence: number, time: number): TableFrame {
  return {
    sequence, time, epoch: 0, phase: "playing",
    ball: {
      position: { x: speedMetersPerSecond * time / 1_000, y: 0.05, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
    rods: Array.from({ length: 8 }, () => ({ translation: 0, angle: 0 })),
    kits: {
      red: { primaryColor: "#ff0000", secondaryColor: "#ffffff" },
      blue: { primaryColor: "#0000ff", secondaryColor: "#ffffff" },
    },
  };
}

// Stable pseudo-random values independent of execution time and runtime timer precision.
function jitterAt(sequence: number): number {
  let value = (sequence + 1) * 0x45d9f3b;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return ((value >>> 0) / 0xffff_ffff) * 2 - 1;
}
const round = (value: number) => Math.round(value * 1_000) / 1_000;
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return { mean: round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)), p50: round(at(0.5)), p95: round(at(0.95)), max: round(at(1)) };
}

function run(mode: typeof modes[number], baseOneWayLatencyMs: number, jitterAmplitudeMs: number, shortPacketGap: boolean) {
  const buffer = new TableFrameBuffer(mode.options);
  const packets: Packet[] = [];
  for (let sequence = 0; sequence <= durationMs * mode.streamHz / 1_000; sequence++) {
    const time = sequence * 1_000 / mode.streamHz;
    if (shortPacketGap && time >= packetGap.startMs && time < packetGap.startMs + packetGap.durationMs) continue;
    const delay = Math.max(0, baseOneWayLatencyMs + jitterAt(sequence) * jitterAmplitudeMs);
    packets.push({ frame: snapshot(sequence, time), arrival: time + delay });
  }
  packets.sort((a, b) => a.arrival - b.arrival || a.frame.sequence - b.frame.sequence);
  const steps: number[] = [], ages: number[] = [], arrivalGaps: number[] = [];
  const receivedSnapshots: TableFrame[] = [];
  let cursor = 0, lastArrival: number | undefined, rejectedOutOfOrder = 0;
  let previousX: number | undefined, repeats = 0, distinctDisplayedPoses = 0, displaySamples = 0;
  let maxRepeats = 0, repeatRun = 0;
  for (let tick = 0; tick <= durationMs * displayHz / 1_000; tick++) {
    const now = tick * 1_000 / displayHz;
    while (packets[cursor] && packets[cursor]!.arrival <= now + 1e-8) {
      const packet = packets[cursor++]!;
      if (buffer.push(packet.frame, packet.arrival)) {
        receivedSnapshots.push(packet.frame);
        if (packet.arrival >= measurementStartMs && lastArrival !== undefined)
          arrivalGaps.push(packet.arrival - lastArrival);
        lastArrival = packet.arrival;
      } else rejectedOutOfOrder++;
    }
    const sampled = buffer.sample(now);
    if (!sampled || now < measurementStartMs) continue;
    displaySamples++;
    // Comparison-only playout: reuse the real buffer's playhead, then display the
    // last exact host snapshot at or before it. No gameplay implementation changes.
    const exact = mode.exactSnapshotPlayout
      ? receivedSnapshots.findLast((frame) => frame.time <= sampled.time + 1e-8)
      : undefined;
    const x = (exact ?? sampled).ball.position.x;
    // frame.time can belong to the interpolated rods while the raw ball belongs to
    // the latest packet. Recover the displayed ball's host time from this test path.
    ages.push(now - x / speedMetersPerSecond * 1_000);
    if (previousX === undefined || Math.abs(x - previousX) > 1e-9) {
      distinctDisplayedPoses++;
      repeatRun = 0;
    } else {
      repeats++;
      repeatRun++;
      maxRepeats = Math.max(maxRepeats, repeatRun);
    }
    if (previousX !== undefined) steps.push(Math.abs(x - previousX));
    previousX = x;
  }
  return {
    mode: mode.name, streamHz: mode.streamHz, baseOneWayLatencyMs, jitterAmplitudeMs, shortPacketGap,
    displaySamples, distinctDisplayedPoses, repeats, repeatPercent: round(100 * repeats / displaySamples),
    longestRepeatedDisplayFrames: maxRepeats, rejectedOutOfOrder,
    biggestInputGapMs: round(Math.max(...arrivalGaps)),
    displayedStepMeters: distribution(steps), hostBallTimestampAgeMs: distribution(ages),
  };
}

const results = modes.flatMap((mode) =>
  [10, 17.5, 25].flatMap((latency) =>
    [0, 3, 8].flatMap((jitter) =>
      [false, true].map((gap) => run(mode, latency, jitter, gap)),
    ),
  ),
);
const aggregate = modes.map((mode) => {
  const stable = results.filter((result) => result.mode === mode.name && !result.shortPacketGap);
  const gaps = results.filter((result) => result.mode === mode.name && result.shortPacketGap);
  return {
    mode: mode.name,
    repeatPercentWithoutGap: distribution(stable.map((result) => result.repeatPercent)),
    maxStepMetersWithoutGap: round(Math.max(...stable.map((result) => result.displayedStepMeters.max))),
    maxStepMetersWithGap: round(Math.max(...gaps.map((result) => result.displayedStepMeters.max))),
    meanHostBallAgeMs: distribution(stable.map((result) => result.hostBallTimestampAgeMs.mean)),
  };
});
const report = {
  kind: "synthetic-controller-stream-benchmark",
  physicalPhoneMeasurement: false,
  reproduce: "npx tsx scripts/benchmark-controller-stream.ts",
  methodology: {
    bufferImplementation: "network/TableFrameBuffer.ts",
    controllerOptionsSource: "network/TableFrameBuffer.ts#CONTROLLER_FRAME_BUFFER_OPTIONS",
    controllerOptions, modes, displayHz, speedMetersPerSecond, durationMs, measurementStartMs, packetGap,
    notes: [
      "This deterministic event simulation does not measure WebRTC, Wi-Fi, browser work, GPU load, RAF jitter, or a physical phone.",
      "Base latency is one-way and jitter is symmetric deterministic variation around that base, so effective delay ranges from 2 to 33 ms.",
      "The trajectory is a constant-speed straight line, deliberately without collisions; coordinates remain inside protocol bounds but are not confined to a physical table.",
      "biggestInputGapMs measures accepted visual snapshot arrival gaps; control input delivery is not simulated.",
      "distinctDisplayedPoses counts consecutive changed ball positions, repeats counts unchanged positions on subsequent display frames.",
      "hostBallTimestampAgeMs derives from the displayed ball path, because raw-ball mode intentionally replaces the ball without replacing interpolated rod timestamps.",
      "The candidate only uses existing interpolation between real host snapshots; it is a comparison configuration, not a gameplay or algorithm change.",
      "Exact-snapshot playout is a benchmark-only selector: it takes the actual TableFrameBuffer playhead and chooses the last received host snapshot at or before that time, without interpolating its ball position.",
      "Warm-up is excluded. No clock offset is introduced because source and receive event clocks share a synthetic epoch.",
    ],
  },
  aggregate, results,
};
const output = new URL("../docs/controller-stream-benchmark.json", import.meta.url);
await mkdir(new URL("../docs/", import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.table(aggregate);
console.log(`Synthetic report saved to ${fileURLToPath(output)}`);
