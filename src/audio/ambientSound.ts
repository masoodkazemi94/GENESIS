/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClimateState } from '../types/simulation.js';

/**
 * Generative procedural nature soundscape engine using the Web Audio API.
 * Synthesizes wind, flowing water, organic harmonic drone, and nature chirps
 * without any external audio asset dependencies.
 * Respects browser autoplay policies by starting suspended/muted until user gesture.
 */
export class AmbientSoundscape {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = true;
  private masterGain: GainNode | null = null;

  // Nodes for generative wind
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  // Nodes for flowing water
  private waterGain: GainNode | null = null;
  private waterFilter: BiquadFilterNode | null = null;

  // Nodes for musical harmony drone
  private droneGain: GainNode | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;

  // Periodic natural life accents (soft insect/bird chirp)
  private chirpTimer: number | null = null;

  private isStarted = false;

  constructor() {
    // AudioContext will be lazily created on user interaction or explicit unmute
  }

  public get muted(): boolean {
    return this.isMuted;
  }

  public async initAudio(): Promise<boolean> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        try {
          await this.ctx.resume();
        } catch {
          // Ignore
        }
      }
      return this.ctx.state === 'running';
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return false;

      this.ctx = new AudioCtx();
      if (this.ctx.state === 'suspended') {
        // Will resume upon user gesture
      }

      this.setupAudioGraph();
      this.isStarted = true;
      return this.ctx.state === 'running';
    } catch (err) {
      console.warn('[Genesis Audio] Web Audio initialization deferred:', err);
      return false;
    }
  }

  private setupAudioGraph(): void {
    if (!this.ctx) return;

    // Master Gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.45, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);

    // 1. Synthesize Wind (Pink/Brown noise passed through lowpass filter)
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      output[i] = (b0 + b1 + b2) * 0.15;
    }

    const windNoise = this.ctx.createBufferSource();
    windNoise.buffer = noiseBuffer;
    windNoise.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.setValueAtTime(280, this.ctx.currentTime);
    this.windFilter.Q.setValueAtTime(1.8, this.ctx.currentTime);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0.2, this.ctx.currentTime);

    windNoise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    windNoise.start();

    // 2. Synthesize Gentle Flowing Stream / Ripples (Bandpass filtered texture)
    const waterNoise = this.ctx.createBufferSource();
    waterNoise.buffer = noiseBuffer;
    waterNoise.loop = true;

    this.waterFilter = this.ctx.createBiquadFilter();
    this.waterFilter.type = 'bandpass';
    this.waterFilter.frequency.setValueAtTime(620, this.ctx.currentTime);
    this.waterFilter.Q.setValueAtTime(3.2, this.ctx.currentTime);

    this.waterGain = this.ctx.createGain();
    this.waterGain.gain.setValueAtTime(0.12, this.ctx.currentTime);

    waterNoise.connect(this.waterFilter);
    this.waterFilter.connect(this.waterGain);
    this.waterGain.connect(this.masterGain);
    waterNoise.start();

    // 3. Ambient Harmonic Drone (Harmonious fifth, very subtle and relaxing)
    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    this.droneGain.connect(this.masterGain);

    this.osc1 = this.ctx.createOscillator();
    this.osc1.type = 'sine';
    this.osc1.frequency.setValueAtTime(110.0, this.ctx.currentTime); // Root A2

    this.osc2 = this.ctx.createOscillator();
    this.osc2.type = 'sine';
    this.osc2.frequency.setValueAtTime(164.81, this.ctx.currentTime); // Fifth E3

    this.osc1.connect(this.droneGain);
    this.osc2.connect(this.droneGain);
    this.osc1.start();
    this.osc2.start();

    // 4. Subtle periodic natural chirp
    this.startChirpLoop();
  }

  private startChirpLoop(): void {
    if (this.chirpTimer !== null) clearInterval(this.chirpTimer);

    this.chirpTimer = window.setInterval(() => {
      if (!this.ctx || this.isMuted || this.ctx.state !== 'running') return;
      // 35% chance to play an organic melodic chirp
      if (Math.random() < 0.35) {
        this.playOrganicChirp();
      }
    }, 4500);
  }

  private playOrganicChirp(): void {
    if (!this.ctx || !this.masterGain) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      const baseFreq = 1400 + Math.random() * 800;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.3, now + 0.08);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.95, now + 0.18);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.035, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.25);
    } catch {
      // Ignore
    }
  }

  public updateClimateAudio(climate: ClimateState): void {
    if (!this.ctx || this.isMuted || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;

      // Adjust wind filter frequency and gain based on rainfall and disasters
      if (this.windFilter && this.windGain) {
        const targetCutoff = 220 + climate.rainfall * 400 + (climate.isDrought ? 120 : 0);
        this.windFilter.frequency.setTargetAtTime(targetCutoff, now, 1.2);
        const targetWindGain = 0.15 + climate.rainfall * 0.18 + (climate.isDrought ? 0.08 : 0);
        this.windGain.gain.setTargetAtTime(targetWindGain, now, 1.0);
      }

      // Adjust water filter based on rainfall
      if (this.waterFilter && this.waterGain) {
        const waterAmp = climate.isDrought ? 0.04 : 0.12 + climate.rainfall * 0.14;
        this.waterGain.gain.setTargetAtTime(waterAmp, now, 1.5);
      }

      // Adjust drone root note slightly based on season
      if (this.osc1 && this.osc2) {
        let baseFreq = 110.0; // A2 spring
        if (climate.season === 'summer') baseFreq = 123.47; // B2
        else if (climate.season === 'autumn') baseFreq = 98.0; // G2
        else if (climate.season === 'winter') baseFreq = 87.31; // F2

        this.osc1.frequency.setTargetAtTime(baseFreq, now, 3.0);
        this.osc2.frequency.setTargetAtTime(baseFreq * 1.5, now, 3.0);
      }
    } catch {
      // Audio parameter update guard
    }
  }

  public async toggleMute(): Promise<boolean> {
    if (!this.ctx) {
      await this.initAudio();
    } else if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // Ignore
      }
    }

    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      const targetGain = this.isMuted ? 0 : 0.45;
      this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.15);
    }
    return !this.isMuted;
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      const targetGain = this.isMuted ? 0 : 0.45;
      this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.15);
    }
  }

  public destroy(): void {
    if (this.chirpTimer !== null) {
      clearInterval(this.chirpTimer);
      this.chirpTimer = null;
    }
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch {
        // Ignore
      }
      this.ctx = null;
    }
  }
}

export const ambientSound = new AmbientSoundscape();
