import { GameSystem } from 'phalanx-ecs';
import type { SystemContext } from 'phalanx-ecs';
import { DeterministicRandom } from 'phalanx-client';
import { FP } from 'phalanx-math';
import {
  FLICK_EXECUTED,
  CHECKER_COLLISION,
  RAPIER_CONTACT,
  RAPIER_SETTLED,
  ALL_SETTLED,
} from '../events/GameEvents.ts';
import type {
  FlickExecutedEvent,
  CheckerCollisionEvent,
  RapierContactEvent,
  AllSettledEvent,
} from '../events/GameEvents.ts';
import {
  FRICTION,
  PHYSICS_DT,
  STOP_THRESHOLD,
} from '../config/constants.ts';
import { SilentModeHint } from '../ui/SilentModeHint.ts';

/** Paths to hit sound variants (served from public/) */
const HIT_SOUND_PATHS: readonly string[] = [
  'sounds/hit_01.mp3',
  'sounds/hit_02.mp3',
  'sounds/hit_03.mp3',
  'sounds/hit_04.mp3',
] as const;

/** Path to the checker movement sound (served from public/) */
const MOVEMENT_SOUND_PATH = 'sounds/checker_movement.mp3';

/** Path to the rim hit sound played when a checker hits the table border */
const RIM_HIT_SOUND_PATH = 'sounds/hit_04.mp3';

/** Paths to fall-off sound variants (checker lands on deck/table surface) */
const FALL_OFF_SOUND_PATHS: readonly string[] = [
  'sounds/checker-fall-off.mp3',
  'sounds/checker-fall-off_02.mp3',
] as const;

/**
 * Velocity damp factor per physics tick: max(0, 1 − friction × dt).
 * Pre-computed once — used to predict how long a checker will slide.
 */
const DAMP_FACTOR = Math.max(0, 1 - FRICTION * PHYSICS_DT);

/** ln(dampFactor) — cached for movement-time calculation */
const LN_DAMP = Math.log(DAMP_FACTOR);

/**
 * Speed fade-out threshold (0–1).
 * When the checker's predicted remaining speed drops below this fraction
 * of its initial flick speed, the movement sound begins to fade out.
 * 0 = never fade early, 1 = fade immediately. Sensible range: 0.15–0.35.
 */
const SPEED_FADE_THRESHOLD = 0.05;

/** Duration of the volume fade-out ramp in seconds */
const FADE_OUT_DURATION = 0.4;

/**
 * SoundSystem — frame system that plays audio feedback for game events.
 *
 * Listens for flick and collision events and plays a randomly chosen
 * hit sound variant. Also plays a movement sound while a checker is
 * sliding — its playback rate is stretched to match the predicted slide
 * time, and it fades out once the checker slows below a speed threshold.
 * Uses DeterministicRandom for variant selection.
 *
 * Registered as a frame system (visual/audio side-effect only).
 */
export class SoundSystem extends GameSystem {
  /** RNG for picking random sound variants */
  private readonly rng = new DeterministicRandom(Date.now());

  /** Pre-decoded audio buffers for hit sounds */
  private readonly hitBuffers: AudioBuffer[] = [];

  /** Web Audio context (created lazily to respect autoplay policies) */
  private audioCtx: AudioContext | null = null;

  /** Whether all sounds have been decoded and are ready to play */
  private loaded = false;

  /** Whether raw ArrayBuffers have been fetched (but not yet decoded) */
  private fetched = false;

  /** Raw ArrayBuffers fetched before AudioContext is available */
  private rawHitBuffers: ArrayBuffer[] = [];
  private rawMovementBuffer: ArrayBuffer | null = null;
  private rawRimHitBuffer: ArrayBuffer | null = null;
  private rawFallOffBuffers: ArrayBuffer[] = [];

  /** Pre-decoded audio buffer for the checker movement sound */
  private movementBuffer: AudioBuffer | null = null;

  /** Pre-decoded audio buffer for the rim/border hit sound */
  private rimHitBuffer: AudioBuffer | null = null;

  /** Pre-decoded audio buffers for fall-off / surface landing sounds */
  private readonly fallOffBuffers: AudioBuffer[] = [];

  /** Currently playing movement source (null when not playing) */
  private movementSource: AudioBufferSourceNode | null = null;

  /** Gain node used for volume control / fade-out of the movement sound */
  private movementGain: GainNode | null = null;

  /** Whether we are currently fading out the movement sound */
  private fadingOut = false;

  /** Initial flick speed for the current movement (used for fade threshold) */
  private flickInitialSpeed = 0;

  /** AudioContext.currentTime when the flick started (for elapsed-time calc) */
  private flickStartTime = 0;

  /** Currently playing Rapier sliding source (null when not playing) */
  private slidingSource: AudioBufferSourceNode | null = null;

  /** Gain node for the Rapier sliding sound (fade-out on settle) */
  private slidingGain: GainNode | null = null;

  /** Whether the sliding sound is currently fading out */
  private slidingFadingOut = false;

  /** iOS silent-mode hint overlay (shown once on iOS Safari) */
  private readonly silentModeHint = new SilentModeHint();

  // ── Lifecycle ──────────────────────────────────────────────────

  public override init(context: SystemContext): void {
    super.init(context);

    this.subscribe<FlickExecutedEvent>(FLICK_EXECUTED, (e) => {
      this.playHitSound();
      this.startMovementSound(FP.ToFloat(e.force));
    });
    this.subscribe<CheckerCollisionEvent>(CHECKER_COLLISION, () => {
      this.stopMovementSound();
      this.playHitSound();
    });
    this.subscribe<AllSettledEvent>(ALL_SETTLED, () => this.stopMovementSound());
    this.subscribe<RapierContactEvent>(RAPIER_CONTACT, (e) => this.onRapierContact(e));
    this.subscribe(RAPIER_SETTLED, () => this.fadeOutSlidingSound());

    this.loadSounds();
  }

  // ── Sound loading ──────────────────────────────────────────────

  /**
   * Bound handler for unlocking the AudioContext on first user gesture.
   * iOS Safari requires AudioContext creation/resume from a direct
   * touch/click handler. We create the context here if needed,
   * resume it, play a silent buffer to fully unlock the pipeline,
   * and then decode any pre-fetched raw buffers.
   */
  private readonly unlockAudio = (): void => {
    // Create AudioContext inside the gesture if it doesn't exist yet
    if (!this.audioCtx) {
      this.audioCtx = this.createAudioContext();
      if (!this.audioCtx) return;
    }

    if (this.audioCtx.state === 'suspended' || (this.audioCtx.state as string) === 'interrupted') {
      // Play a tiny silent buffer to fully unlock the iOS audio pipeline
      const silent = this.audioCtx.createBuffer(1, 1, this.audioCtx.sampleRate);
      const src = this.audioCtx.createBufferSource();
      src.buffer = silent;
      src.connect(this.audioCtx.destination);
      src.start(0);

      void this.audioCtx.resume();
    }

    // If raw buffers were already fetched, decode them now
    if (this.fetched && !this.loaded) {
      void this.decodeBuffers();
    }

    this.removeUnlockListeners();
  };

  private addUnlockListeners(): void {
    document.addEventListener('touchstart', this.unlockAudio, { capture: true });
    document.addEventListener('touchend', this.unlockAudio, { capture: true });
    document.addEventListener('click', this.unlockAudio, { capture: true });
  }

  private removeUnlockListeners(): void {
    document.removeEventListener('touchstart', this.unlockAudio, { capture: true });
    document.removeEventListener('touchend', this.unlockAudio, { capture: true });
    document.removeEventListener('click', this.unlockAudio, { capture: true });
  }

  /** Create a Web Audio context, using the prefixed constructor on older Safari. */
  private createAudioContext(): AudioContext | null {
    const Ctor = window.AudioContext
      ?? (window as unknown as Record<string, unknown>).webkitAudioContext as (typeof AudioContext | undefined);
    if (!Ctor) return null;
    return new Ctor();
  }

  /**
   * Phase 1 — fetch all sound files as raw ArrayBuffers.
   * This does NOT require an AudioContext and works on every platform.
   */
  private async loadSounds(): Promise<void> {
    try {
      const hitFetches = HIT_SOUND_PATHS.map(async (path) => {
        const response = await fetch(path);
        return response.arrayBuffer();
      });

      const movementFetch = fetch(MOVEMENT_SOUND_PATH).then((r) => r.arrayBuffer());
      const rimHitFetch = fetch(RIM_HIT_SOUND_PATH).then((r) => r.arrayBuffer());

      const fallOffFetches = FALL_OFF_SOUND_PATHS.map(async (path) => {
        const response = await fetch(path);
        return response.arrayBuffer();
      });

      const [hitRaw, movementRaw, rimHitRaw, fallOffRaw] = await Promise.all([
        Promise.all(hitFetches),
        movementFetch,
        rimHitFetch,
        Promise.all(fallOffFetches),
      ]);

      this.rawHitBuffers = hitRaw;
      this.rawMovementBuffer = movementRaw;
      this.rawRimHitBuffer = rimHitRaw;
      this.rawFallOffBuffers = fallOffRaw;
      this.fetched = true;

      // Register unlock listeners BEFORE trying to decode — on iOS Safari
      // the context won't exist yet and the gesture handler will create it.
      this.addUnlockListeners();

      // Phase 2 — try to create AudioContext and decode immediately.
      // On desktop browsers this succeeds; on iOS Safari the context will
      // be suspended/interrupted and decoding is deferred to unlockAudio.
      this.audioCtx = this.createAudioContext();
      if (this.audioCtx && this.audioCtx.state === 'running') {
        await this.decodeBuffers();
      }
    } catch (err) {
      console.warn('SoundSystem: Failed to fetch sounds.', err);
    }
  }

  /**
   * Phase 2 — decode the pre-fetched raw ArrayBuffers using the AudioContext.
   * Called either immediately (desktop) or from the gesture unlock handler (iOS).
   *
   * `decodeAudioData` consumes the ArrayBuffer, so we `.slice(0)` each one
   * to keep the originals available in case this is called again after a
   * context re-creation.
   */
  private async decodeBuffers(): Promise<void> {
    if (!this.audioCtx || this.loaded) return;
    if (!this.rawMovementBuffer || !this.rawRimHitBuffer) return;

    try {
      const hitDecoded = await Promise.all(
        this.rawHitBuffers.map((buf) => this.audioCtx!.decodeAudioData(buf.slice(0))),
      );

      const movementDecoded = await this.audioCtx.decodeAudioData(
        this.rawMovementBuffer.slice(0),
      );

      const rimHitDecoded = await this.audioCtx.decodeAudioData(
        this.rawRimHitBuffer.slice(0),
      );

      const fallOffDecoded = await Promise.all(
        this.rawFallOffBuffers.map((buf) => this.audioCtx!.decodeAudioData(buf.slice(0))),
      );

      this.hitBuffers.push(...hitDecoded);
      this.movementBuffer = movementDecoded;
      this.rimHitBuffer = rimHitDecoded;
      this.fallOffBuffers.push(...fallOffDecoded);
      this.loaded = true;

      // On iOS Safari, remind the user about the hardware silent switch
      this.silentModeHint.show();
    } catch (err) {
      console.warn('SoundSystem: Failed to decode audio buffers.', err);
    }
  }

  // ── Playback ───────────────────────────────────────────────────

  private playHitSound(): void {
    if (!this.loaded || !this.audioCtx || this.hitBuffers.length === 0) return;

    // Resume suspended/interrupted context (browser autoplay policy)
    if (this.audioCtx.state !== 'running') {
      void this.audioCtx.resume();
    }

    const buffer = this.rng.pick(this.hitBuffers);
    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioCtx.destination);
    source.start(0);
  }

  /** Route Rapier contact events to the appropriate sound. */
  private onRapierContact(event: RapierContactEvent): void {
    switch (event.kind) {
      case 'border':
        this.playRimHitSound();
        break;
      case 'checker':
        this.playHitSound();
        break;
      case 'surface':
        this.playRimHitSound();
        this.startSlidingSound();
        break;
    }
  }

  /** Play the rim/border hit sound when a checker hits the table border rail. */
  private playRimHitSound(): void {
    if (!this.loaded || !this.audioCtx || !this.rimHitBuffer) return;

    if (this.audioCtx.state !== 'running') {
      void this.audioCtx.resume();
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = this.rimHitBuffer;
    source.connect(this.audioCtx.destination);
    source.start(0);
  }

  /** Start a fall-off sliding sound (plays once). Does nothing if already playing. */
  private startSlidingSound(): void {
    if (!this.loaded || !this.audioCtx || this.fallOffBuffers.length === 0) return;
    // Don't restart if already playing or fading out
    if (this.slidingSource) return;

    if (this.audioCtx.state !== 'running') {
      void this.audioCtx.resume();
    }

    const gain = this.audioCtx.createGain();
    gain.gain.value = 1;
    gain.connect(this.audioCtx.destination);

    const buffer = this.rng.pick(this.fallOffBuffers);
    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(0);

    source.onended = () => {
      if (this.slidingSource === source) {
        this.slidingSource = null;
        this.slidingGain = null;
      }
    };

    this.slidingSource = source;
    this.slidingGain = gain;
    this.slidingFadingOut = false;
  }

  /** Stop the sliding sound immediately. */
  private stopSlidingSound(): void {
    if (this.slidingSource) {
      this.slidingSource.stop();
      this.slidingSource.disconnect();
      this.slidingSource = null;
    }
    if (this.slidingGain) {
      this.slidingGain.disconnect();
      this.slidingGain = null;
    }
    this.slidingFadingOut = false;
  }

  /** Fade out the sliding sound smoothly when Rapier bodies have settled. */
  private fadeOutSlidingSound(): void {
    if (this.slidingFadingOut || !this.slidingGain || !this.audioCtx || !this.slidingSource) return;
    this.slidingFadingOut = true;

    const now = this.audioCtx.currentTime;
    this.slidingGain.gain.setValueAtTime(this.slidingGain.gain.value, now);
    this.slidingGain.gain.linearRampToValueAtTime(0, now + FADE_OUT_DURATION);

    const src = this.slidingSource;
    const gain = this.slidingGain;
    setTimeout(() => {
      if (this.slidingSource === src) {
        src.stop();
        src.disconnect();
        this.slidingSource = null;
      }
      if (this.slidingGain === gain) {
        gain.disconnect();
        this.slidingGain = null;
      }
      this.slidingFadingOut = false;
    }, FADE_OUT_DURATION * 1000 + 50);
  }

  /** Start the checker movement sound, stretching it to match predicted slide time. */
  private startMovementSound(initialSpeed: number): void {
    if (!this.loaded || !this.audioCtx || !this.movementBuffer) return;
    if (initialSpeed <= STOP_THRESHOLD) return;

    if (this.audioCtx.state !== 'running') {
      void this.audioCtx.resume();
    }

    // Stop previous movement sound if still playing
    this.stopMovementSound();

    // Store for per-frame fade-out check
    this.flickInitialSpeed = initialSpeed;
    this.flickStartTime = this.audioCtx.currentTime;
    this.fadingOut = false;

    // Predict movement duration from exponential friction model:
    //   speed(N) = initialSpeed × dampFactor^N   →   stops when speed ≤ STOP_THRESHOLD
    //   N = ⌈ ln(STOP_THRESHOLD / initialSpeed) / ln(dampFactor) ⌉
    const ticks = Math.ceil(
      Math.log(STOP_THRESHOLD / initialSpeed) / LN_DAMP,
    );
    const movementTime = ticks * PHYSICS_DT;

    const duration = this.movementBuffer.duration;

    // Slow the sound down so it fills the entire movement time.
    // If the movement is shorter than the buffer we keep normal speed
    // (stopMovementSound will cut it short).
    const playbackRate = movementTime > duration
      ? duration / movementTime
      : 1;

    const gain = this.audioCtx.createGain();
    gain.gain.value = 1;
    gain.connect(this.audioCtx.destination);

    const source = this.audioCtx.createBufferSource();
    source.buffer = this.movementBuffer;
    source.playbackRate.value = playbackRate;
    source.connect(gain);
    source.start(0);

    // Clear reference when the sound finishes naturally
    source.onended = () => {
      if (this.movementSource === source) {
        this.movementSource = null;
        this.movementGain = null;
      }
    };

    this.movementSource = source;
    this.movementGain = gain;
  }

  /** Stop the currently playing checker movement sound immediately. */
  private stopMovementSound(): void {
    if (this.movementSource) {
      this.movementSource.stop();
      this.movementSource.disconnect();
      this.movementSource = null;
    }
    if (this.movementGain) {
      this.movementGain.disconnect();
      this.movementGain = null;
    }
    this.fadingOut = false;
  }

  /**
   * Begin a smooth gain fade-out over FADE_OUT_DURATION seconds.
   * After the ramp completes the source is stopped automatically.
   */
  private fadeOutMovementSound(): void {
    if (this.fadingOut || !this.movementGain || !this.audioCtx || !this.movementSource) return;
    this.fadingOut = true;

    const now = this.audioCtx.currentTime;
    this.movementGain.gain.setValueAtTime(this.movementGain.gain.value, now);
    this.movementGain.gain.linearRampToValueAtTime(0, now + FADE_OUT_DURATION);

    // Schedule a hard stop after the ramp so resources are freed
    const src = this.movementSource;
    const gain = this.movementGain;
    setTimeout(() => {
      if (this.movementSource === src) {
        src.stop();
        src.disconnect();
        this.movementSource = null;
      }
      if (this.movementGain === gain) {
        gain.disconnect();
        this.movementGain = null;
      }
      this.fadingOut = false;
    }, FADE_OUT_DURATION * 1000 + 50);
  }

  // ── Frame update — speed-based fade-out ─────────────────────────

  public override update(_deltaTime: number): void {
    if (!this.movementSource || this.fadingOut || this.flickInitialSpeed <= 0) return;

    // Estimate elapsed ticks from wall-clock time since flick start.
    // We use the AudioContext currentTime for a smooth, drift-free clock.
    const elapsed = (this.audioCtx?.currentTime ?? 0) - this.flickStartTime;
    if (elapsed < 0) return;

    const elapsedTicks = elapsed / PHYSICS_DT;

    // Predicted current speed: speed(t) = initialSpeed × dampFactor ^ elapsedTicks
    const predictedSpeed = this.flickInitialSpeed * Math.pow(DAMP_FACTOR, elapsedTicks);

    // Fade threshold: fraction of initial speed
    const fadeSpeed = this.flickInitialSpeed * SPEED_FADE_THRESHOLD;

    if (predictedSpeed <= fadeSpeed) {
      this.fadeOutMovementSound();
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────

  public override dispose(): void {
    super.dispose();

    this.stopMovementSound();
    this.stopSlidingSound();
    this.removeUnlockListeners();
    this.silentModeHint.dispose();

    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}

