"use client";
import { useEffect, useRef } from "react";

export interface AudioSettings {
  paused?: boolean;
  muted?: boolean;
  volume?: number;
  music?: boolean;
  effects?: boolean;
}
export type SoundEffect =
  "click" | "shot" | "dash" | "hit" | "pickup" | "victory";

// Games request cues; the host owns volume, pause and user activation.
export class RuntimeAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private settings: AudioSettings = {};
  private theme = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private beat = 0;
  private voices = new Set<OscillatorNode>();
  private lastEffect = new Map<SoundEffect, number>();

  configure(settings: AudioSettings) {
    this.settings = settings;
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        this.level(),
        this.context.currentTime,
        0.02,
      );
    this.syncMusic();
  }
  private level() {
    const value = this.settings.volume ?? 0.7;
    return this.settings.paused || this.settings.muted
      ? 0
      : Number.isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : 0;
  }
  async unlock() {
    if (typeof window === "undefined") return;
    const Constructor = window.AudioContext;
    if (!Constructor) return;
    try {
      if (!this.context) {
        this.context = new Constructor();
        this.master = this.context.createGain();
        this.master.gain.value = this.level();
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended") await this.context.resume();
      this.syncMusic();
    } catch {
      // A browser without audio permission can still play the game.
    }
  }
  setTheme(enabled: boolean) {
    this.theme = enabled;
    this.syncMusic();
  }
  private note(
    frequency: number,
    duration: number,
    strength: number,
    wave: OscillatorType,
  ) {
    const context = this.context;
    if (!context || !this.master || context.state !== "running") return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.value = frequency;
    const now = context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(strength, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    this.voices.add(oscillator);
    oscillator.onended = () => {
      this.voices.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
  effect(kind: SoundEffect) {
    if (this.settings.effects === false || this.level() === 0 || !this.context)
      return;
    const now = this.context.currentTime;
    if (now - (this.lastEffect.get(kind) ?? -Infinity) < 0.055) return;
    this.lastEffect.set(kind, now);
    const cues: Record<SoundEffect, [number, number, number, OscillatorType]> =
      {
        click: [440, 0.045, 0.05, "sine"],
        shot: [185, 0.07, 0.055, "square"],
        dash: [660, 0.12, 0.04, "triangle"],
        hit: [72, 0.18, 0.085, "sawtooth"],
        pickup: [880, 0.16, 0.06, "sine"],
        victory: [523.25, 0.4, 0.07, "triangle"],
      };
    this.note(...cues[kind]);
    if (kind === "victory") this.note(783.99, 0.6, 0.04, "sine");
  }
  private syncMusic() {
    const enabled =
      this.theme &&
      this.settings.music !== false &&
      this.level() > 0 &&
      this.context?.state === "running";
    if (!enabled && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (enabled && !this.timer) {
      const notes = [130.81, 164.81, 196, 261.63, 146.83, 174.61, 220, 293.66];
      this.timer = setInterval(() => {
        if (this.settings.music === false || this.level() === 0) return;
        this.note(notes[this.beat++ % notes.length], 0.5, 0.025, "sine");
      }, 360);
    }
  }
  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {}
    }
    this.voices.clear();
    const context = this.context;
    this.context = null;
    this.master = null;
    this.lastEffect.clear();
    void context?.close().catch(() => {});
  }
}

export function useGameAudio(settings: AudioSettings) {
  const audio = useRef<RuntimeAudio | null>(null);
  if (!audio.current) audio.current = new RuntimeAudio();
  const controller = audio.current;
  useEffect(() => {
    controller.configure(settings);
  }, [
    controller,
    settings.paused,
    settings.muted,
    settings.volume,
    settings.music,
    settings.effects,
  ]);
  useEffect(() => {
    const activate = () => {
      void controller.unlock();
    };
    window.addEventListener("pointerdown", activate, { capture: true });
    window.addEventListener("keydown", activate, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", activate, { capture: true });
      window.removeEventListener("keydown", activate, { capture: true });
      controller.dispose();
    };
  }, [controller]);
  return controller;
}
