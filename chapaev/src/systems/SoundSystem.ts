import { GameSystem } from '@phalanx-engine/ecs';
import type { SystemContext } from '@phalanx-engine/ecs';
import { DeterministicRandom } from '@phalanx-engine/client';
import { FP } from '@phalanx-engine/math';
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
  BGM_VOLUME,
  BGM_CROSSFADE_DURATION,
} from '../config/constants.ts';
import { SilentModeHint } from '../ui/SilentModeHint.ts';
import { audioSettings } from '../config/AudioSettings.ts';
import {
  assetManager,
  HIT_SOUND_PATHS,
  MOVEMENT_SOUND_PATH,
  RIM_HIT_SOUND_PATH,
  FALL_OFF_SOUND_PATHS,
  BGM_SOUND_PATHS,
} from '../rendering';

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
  private rawBgmBuffers: ArrayBuffer[] = [];

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

  /** Pre-decoded audio buffers for background music tracks */
  private readonly bgmBuffers: AudioBuffer[] = [];

  /** Index of the currently playing BGM track in bgmBuffers */
  private bgmCurrentIndex = 0;

  /** Currently playing BGM source node */
  private bgmSource: AudioBufferSourceNode | null = null;

  /** Gain node for BGM volume control / cross-fade */
  private bgmGain: GainNode | null = null;

  /** Whether BGM playback has been started */
  private bgmStarted = false;

  /** iOS silent-mode hint overlay (shown once on iOS Safari) */
  private readonly silentModeHint = new SilentModeHint();

  /** Master gain node for sound effects (hit, movement, sliding, fall-off) */
  private sfxMasterGain: GainNode | null = null;

  /** Master gain node for background music */
  private bgmMasterGain: GainNode | null = null;

  /** Unsubscribe from audioSettings changes */
  private settingsUnsub: (() => void) | null = null;

  /** True when this system suspended audio because the page was hidden. */
  private pageLifecycleSuspendedAudio = false;

  private readonly handlePageHidden = (): void => {
    if (!this.audioCtx || this.audioCtx.state !== 'running') return;
    this.pageLifecycleSuspendedAudio = true;
    void this.audioCtx.suspend();
  };

  private readonly handlePageVisible = (): void => {
    if (this.isPageHidden()) return;
    if (this.pageLifecycleSuspendedAudio && this.audioCtx) {
      this.pageLifecycleSuspendedAudio = false;
      void this.audioCtx.resume();
    }
    if (this.loaded && !this.bgmStarted) {
      this.startBgm();
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (this.isPageHidden()) {
      this.handlePageHidden();
      return;
    }
    this.handlePageVisible();
  };

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
    this.subscribe<AllSettledEvent>(ALL_SETTLED, () =>
      this.stopMovementSound()
    );
    this.subscribe<RapierContactEvent>(RAPIER_CONTACT, (e) =>
      this.onRapierContact(e)
    );
    this.subscribe(RAPIER_SETTLED, () => this.fadeOutSlidingSound());

    this.addPageLifecycleListeners();
    void this.loadSounds();
  }

  private addPageLifecycleListeners(): void {
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pagehide', this.handlePageHidden);
    window.addEventListener('pageshow', this.handlePageVisible);
    window.addEventListener('blur', this.handlePageHidden);
    window.addEventListener('focus', this.handlePageVisible);
  }

  private removePageLifecycleListeners(): void {
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange
    );
    window.removeEventListener('pagehide', this.handlePageHidden);
    window.removeEventListener('pageshow', this.handlePageVisible);
    window.removeEventListener('blur', this.handlePageHidden);
    window.removeEventListener('focus', this.handlePageVisible);
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
    if (this.isPageHidden()) return;

    // Create AudioContext inside the gesture if it doesn't exist yet
    if (!this.audioCtx) {
      this.audioCtx = this.createAudioContext();
      if (!this.audioCtx) return;
    }

    if (
      this.audioCtx.state === 'suspended' ||
      (this.audioCtx.state as string) === 'interrupted'
    ) {
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
    document.addEventListener('touchstart', this.unlockAudio, {
      capture: true,
    });
    document.addEventListener('touchend', this.unlockAudio, { capture: true });
    document.addEventListener('click', this.unlockAudio, { capture: true });
  }

  private removeUnlockListeners(): void {
    document.removeEventListener('touchstart', this.unlockAudio, {
      capture: true,
    });
    document.removeEventListener('touchend', this.unlockAudio, {
      capture: true,
    });
    document.removeEventListener('click', this.unlockAudio, { capture: true });
  }

  /** Create a Web Audio context, using the prefixed constructor on older Safari. */
  private createAudioContext(): AudioContext | null {
    const Ctor =
      window.AudioContext ??
      ((window as unknown as Record<string, unknown>).webkitAudioContext as
        | typeof AudioContext
        | undefined);
    if (!Ctor) return null;
    return new Ctor();
  }

  /**
   * Phase 1 — read all sound files as raw ArrayBuffers from the shared
   * AssetManager cache. This does NOT require an AudioContext and works on
   * every platform. Audio decoding stays in Phase 2, gated on the user-gesture
   * AudioContext unlock (required by iOS Safari).
   */
  private async loadSounds(): Promise<void> {
    try {
      this.rawHitBuffers = HIT_SOUND_PATHS.map((path) =>
        assetManager.getAudioBuffer(path)
      );
      this.rawMovementBuffer = assetManager.getAudioBuffer(MOVEMENT_SOUND_PATH);
      this.rawRimHitBuffer = assetManager.getAudioBuffer(RIM_HIT_SOUND_PATH);
      this.rawFallOffBuffers = FALL_OFF_SOUND_PATHS.map((path) =>
        assetManager.getAudioBuffer(path)
      );
      this.rawBgmBuffers = BGM_SOUND_PATHS.map((path) =>
        assetManager.getAudioBuffer(path)
      );
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
      console.warn('SoundSystem: Failed to load sounds.', err);
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
        this.rawHitBuffers.map((buf) =>
          this.audioCtx!.decodeAudioData(buf.slice(0))
        )
      );

      const movementDecoded = await this.audioCtx.decodeAudioData(
        this.rawMovementBuffer.slice(0)
      );

      const rimHitDecoded = await this.audioCtx.decodeAudioData(
        this.rawRimHitBuffer.slice(0)
      );

      const fallOffDecoded = await Promise.all(
        this.rawFallOffBuffers.map((buf) =>
          this.audioCtx!.decodeAudioData(buf.slice(0))
        )
      );

      const bgmDecoded = await Promise.all(
        this.rawBgmBuffers.map((buf) =>
          this.audioCtx!.decodeAudioData(buf.slice(0))
        )
      );

      this.hitBuffers.push(...hitDecoded);
      this.movementBuffer = movementDecoded;
      this.rimHitBuffer = rimHitDecoded;
      this.fallOffBuffers.push(...fallOffDecoded);
      this.bgmBuffers.push(...bgmDecoded);
      this.loaded = true;

      // Create master gain nodes for volume control
      this.setupMasterGains();

      // On iOS Safari, remind the user about the hardware silent switch
      this.silentModeHint.show();

      // Start background music once everything is decoded
      this.startBgm();
    } catch (err) {
      console.warn('SoundSystem: Failed to decode audio buffers.', err);
    }
  }

  // ── Master gain / volume ─────────────────────────────────────────

  /** Create master gain nodes and subscribe to audioSettings changes. */
  private setupMasterGains(): void {
    if (!this.audioCtx) return;

    this.sfxMasterGain = this.audioCtx.createGain();
    this.sfxMasterGain.gain.value = audioSettings.effectiveSfxVolume;
    this.sfxMasterGain.connect(this.audioCtx.destination);

    this.bgmMasterGain = this.audioCtx.createGain();
    this.bgmMasterGain.gain.value = audioSettings.effectiveMusicVolume;
    this.bgmMasterGain.connect(this.audioCtx.destination);

    // Live-update volumes when the user changes settings OR the platform
    // master-mute toggles (ads, CrazyGames settings.muteAudio). Reading the
    // effective volumes folds both concerns into one subscription.
    this.settingsUnsub = audioSettings.onChange(() => {
      if (this.sfxMasterGain) {
        this.sfxMasterGain.gain.value = audioSettings.effectiveSfxVolume;
      }
      if (this.bgmMasterGain) {
        this.bgmMasterGain.gain.value = audioSettings.effectiveMusicVolume;
      }
    });
  }

  /** Get the audio node SFX sources should connect to. */
  private get sfxDestination(): AudioNode {
    return this.sfxMasterGain ?? this.audioCtx!.destination;
  }

  /** Get the audio node BGM sources should connect to. */
  private get bgmDestination(): AudioNode {
    return this.bgmMasterGain ?? this.audioCtx!.destination;
  }

  private isPageHidden(): boolean {
    return document.hidden || document.visibilityState === 'hidden';
  }

  private ensureAudioRunning(): boolean {
    if (!this.audioCtx || this.isPageHidden()) return false;
    if (this.audioCtx.state !== 'running') {
      void this.audioCtx.resume();
    }
    return true;
  }

  // ── Playback ───────────────────────────────────────────────────

  private playHitSound(): void {
    if (!this.loaded || !this.audioCtx || this.hitBuffers.length === 0) return;
    if (!this.ensureAudioRunning()) return;

    const buffer = this.rng.pick(this.hitBuffers);
    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.sfxDestination);
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
    if (!this.ensureAudioRunning()) return;

    const source = this.audioCtx.createBufferSource();
    source.buffer = this.rimHitBuffer;
    source.connect(this.sfxDestination);
    source.start(0);
  }

  /** Start a fall-off sliding sound (plays once). Does nothing if already playing. */
  private startSlidingSound(): void {
    if (!this.loaded || !this.audioCtx || this.fallOffBuffers.length === 0)
      return;
    // Don't restart if already playing or fading out
    if (this.slidingSource) return;
    if (!this.ensureAudioRunning()) return;

    const gain = this.audioCtx.createGain();
    gain.gain.value = 1;
    gain.connect(this.sfxDestination);

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
    if (
      this.slidingFadingOut ||
      !this.slidingGain ||
      !this.audioCtx ||
      !this.slidingSource
    )
      return;
    this.slidingFadingOut = true;

    const now = this.audioCtx.currentTime;
    this.slidingGain.gain.setValueAtTime(this.slidingGain.gain.value, now);
    this.slidingGain.gain.linearRampToValueAtTime(0, now + FADE_OUT_DURATION);

    const src = this.slidingSource;
    const gain = this.slidingGain;
    setTimeout(
      () => {
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
      },
      FADE_OUT_DURATION * 1000 + 50
    );
  }

  /** Start the checker movement sound, stretching it to match predicted slide time. */
  private startMovementSound(initialSpeed: number): void {
    if (!this.loaded || !this.audioCtx || !this.movementBuffer) return;
    if (initialSpeed <= STOP_THRESHOLD) return;
    if (!this.ensureAudioRunning()) return;

    // Stop previous movement sound if still playing
    this.stopMovementSound();

    // Store for per-frame fade-out check
    this.flickInitialSpeed = initialSpeed;
    this.flickStartTime = this.audioCtx.currentTime;
    this.fadingOut = false;

    // Predict movement duration from exponential friction model:
    //   speed(N) = initialSpeed × dampFactor^N   →   stops when speed ≤ STOP_THRESHOLD
    //   N = ⌈ ln(STOP_THRESHOLD / initialSpeed) / ln(dampFactor) ⌉
    const ticks = Math.ceil(Math.log(STOP_THRESHOLD / initialSpeed) / LN_DAMP);
    const movementTime = ticks * PHYSICS_DT;

    const duration = this.movementBuffer.duration;

    // Slow the sound down so it fills the entire movement time.
    // If the movement is shorter than the buffer we keep normal speed
    // (stopMovementSound will cut it short).
    const playbackRate = movementTime > duration ? duration / movementTime : 1;

    const gain = this.audioCtx.createGain();
    gain.gain.value = 1;
    gain.connect(this.sfxDestination);

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
    if (
      this.fadingOut ||
      !this.movementGain ||
      !this.audioCtx ||
      !this.movementSource
    )
      return;
    this.fadingOut = true;

    const now = this.audioCtx.currentTime;
    this.movementGain.gain.setValueAtTime(this.movementGain.gain.value, now);
    this.movementGain.gain.linearRampToValueAtTime(0, now + FADE_OUT_DURATION);

    // Schedule a hard stop after the ramp so resources are freed
    const src = this.movementSource;
    const gain = this.movementGain;
    setTimeout(
      () => {
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
      },
      FADE_OUT_DURATION * 1000 + 50
    );
  }

  // ── Background music ─────────────────────────────────────────────

  /**
   * Begin looping background music. Picks a random starting track and
   * cross-fades into the next track when the current one ends.
   */
  private startBgm(): void {
    if (this.bgmStarted || this.bgmBuffers.length === 0 || !this.audioCtx)
      return;
    if (this.isPageHidden()) return;
    this.bgmStarted = true;

    // Pick a random first track
    this.bgmCurrentIndex = this.rng.intRange(0, this.bgmBuffers.length - 1);
    this.playBgmTrack(this.bgmCurrentIndex);
  }

  /** Play a specific BGM track by index, fading in over BGM_CROSSFADE_DURATION. */
  private playBgmTrack(index: number): void {
    if (!this.audioCtx || this.bgmBuffers.length === 0) return;
    if (!this.ensureAudioRunning()) return;

    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(
      BGM_VOLUME,
      this.audioCtx.currentTime + BGM_CROSSFADE_DURATION
    );
    gain.connect(this.bgmDestination);

    const source = this.audioCtx.createBufferSource();
    source.buffer = this.bgmBuffers[index];
    source.connect(gain);
    source.start(0);

    source.onended = () => {
      // Only advance if this is still the active source (not stopped manually)
      if (this.bgmSource === source) {
        this.bgmSource = null;
        if (this.bgmGain) {
          this.bgmGain.disconnect();
          this.bgmGain = null;
        }
        this.playNextBgmTrack();
      }
    };

    this.bgmSource = source;
    this.bgmGain = gain;
  }

  /** Advance to the next BGM track (wraps around). */
  private playNextBgmTrack(): void {
    if (this.bgmBuffers.length === 0) return;
    this.bgmCurrentIndex = (this.bgmCurrentIndex + 1) % this.bgmBuffers.length;
    this.playBgmTrack(this.bgmCurrentIndex);
  }

  /** Stop background music, optionally fading out. */
  private stopBgm(): void {
    if (this.bgmSource) {
      // Detach the onended handler to prevent chaining to the next track
      this.bgmSource.onended = null;
      this.bgmSource.stop();
      this.bgmSource.disconnect();
      this.bgmSource = null;
    }
    if (this.bgmGain) {
      this.bgmGain.disconnect();
      this.bgmGain = null;
    }
    this.bgmStarted = false;
  }

  // ── Frame update — speed-based fade-out ─────────────────────────

  public override update(_deltaTime: number): void {
    if (!this.movementSource || this.fadingOut || this.flickInitialSpeed <= 0)
      return;

    // Estimate elapsed ticks from wall-clock time since flick start.
    // We use the AudioContext currentTime for a smooth, drift-free clock.
    const elapsed = (this.audioCtx?.currentTime ?? 0) - this.flickStartTime;
    if (elapsed < 0) return;

    const elapsedTicks = elapsed / PHYSICS_DT;

    // Predicted current speed: speed(t) = initialSpeed × dampFactor ^ elapsedTicks
    const predictedSpeed =
      this.flickInitialSpeed * Math.pow(DAMP_FACTOR, elapsedTicks);

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
    this.stopBgm();
    this.removeUnlockListeners();
    this.removePageLifecycleListeners();
    this.silentModeHint.dispose();
    this.settingsUnsub?.();
    this.settingsUnsub = null;

    if (this.sfxMasterGain) {
      this.sfxMasterGain.disconnect();
      this.sfxMasterGain = null;
    }
    if (this.bgmMasterGain) {
      this.bgmMasterGain.disconnect();
      this.bgmMasterGain = null;
    }

    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
