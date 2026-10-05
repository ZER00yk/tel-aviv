import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeAudio } from "./audio";

class FakeGain {
  gain = {
    value: 0,
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeOscillator {
  type = "sine";
  frequency = { value: 0 };
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class FakeContext {
  static instances: FakeContext[] = [];
  state = "suspended";
  currentTime = 1;
  destination = {};
  gains: FakeGain[] = [];
  oscillators: FakeOscillator[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  constructor() {
    FakeContext.instances.push(this);
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
}

describe("host audio lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeContext.instances = [];
    vi.stubGlobal("window", { AudioContext: FakeContext });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("creates audio only after activation and honors effects, volume and pause", async () => {
    const audio = new RuntimeAudio();
    audio.configure({ volume: 0.35, effects: false });
    audio.effect("shot");
    expect(FakeContext.instances).toHaveLength(0);
    await audio.unlock();
    const context = FakeContext.instances[0];
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.gains[0].gain.value).toBe(0.35);
    audio.effect("shot");
    expect(context.oscillators).toHaveLength(0);
    audio.configure({ volume: 0.35, effects: true });
    audio.effect("shot");
    expect(context.oscillators).toHaveLength(1);
    audio.configure({ paused: true, volume: 0.35 });
    audio.effect("hit");
    expect(context.oscillators).toHaveLength(1);
    expect(context.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(
      0,
      1,
      0.02,
    );
    audio.dispose();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("stops music scheduling when disabled or muted and releases voices on exit", async () => {
    const audio = new RuntimeAudio();
    audio.configure({ volume: 0.5, music: true });
    audio.setTheme(true);
    await audio.unlock();
    const context = FakeContext.instances[0];
    vi.advanceTimersByTime(720);
    expect(context.oscillators).toHaveLength(2);
    audio.configure({ volume: 0.5, music: false });
    vi.advanceTimersByTime(720);
    expect(context.oscillators).toHaveLength(2);
    audio.configure({ volume: 0.5, music: true, muted: true });
    vi.advanceTimersByTime(720);
    expect(context.oscillators).toHaveLength(2);
    audio.configure({ volume: 0.5, music: true });
    vi.advanceTimersByTime(360);
    expect(context.oscillators).toHaveLength(3);
    audio.dispose();
    vi.advanceTimersByTime(720);
    expect(context.oscillators).toHaveLength(3);
    expect(
      context.oscillators.every((voice) => voice.stop.mock.calls.length === 2),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("can activate again after cleanup and keeps invalid volume silent", async () => {
    const audio = new RuntimeAudio();
    audio.configure({ volume: NaN });
    await audio.unlock();
    audio.effect("hit");
    expect(FakeContext.instances[0].gains[0].gain.value).toBe(0);
    expect(FakeContext.instances[0].oscillators).toHaveLength(0);
    audio.dispose();
    audio.configure({ volume: 0.2 });
    await audio.unlock();
    audio.effect("pickup");
    expect(FakeContext.instances).toHaveLength(2);
    expect(FakeContext.instances[1].oscillators).toHaveLength(1);
    audio.dispose();
  });
});
