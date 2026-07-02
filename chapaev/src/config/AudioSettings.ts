/**
 * AudioSettings — singleton that stores user volume preferences.
 * Persisted to localStorage. SoundSystem reads from here.
 */

const STORAGE_KEY = 'chapaev:audio-settings';

interface AudioSettingsData {
  musicVolume: number;
  sfxVolume: number;
}

const DEFAULTS: AudioSettingsData = {
  musicVolume: 0.5,
  sfxVolume: 0.8,
} as const;

type ChangeListener = () => void;

class AudioSettingsStore {
  private data: AudioSettingsData;
  private readonly listeners: ChangeListener[] = [];

  /**
   * Transient master mute, layered ON TOP of the user's volume preferences
   * without overwriting them. Used for platform-driven muting (CrazyGames
   * `settings.muteAudio`, in-ad muting, etc.). Never persisted: it reflects a
   * runtime host/ad state, not a user choice, so a page reload starts unmuted
   * and re-syncs from the SDK. When `true`, `effective*Volume` returns 0 while
   * `musicVolume`/`sfxVolume` keep the real values — so opening the in-game
   * audio settings during a mute never clobbers what the player had set.
   */
  private masterMuted = false;

  constructor() {
    this.data = this.load();
  }

  public get musicVolume(): number {
    return this.data.musicVolume;
  }

  public set musicVolume(value: number) {
    this.data.musicVolume = Math.max(0, Math.min(1, value));
    this.save();
    this.notify();
  }

  public get sfxVolume(): number {
    return this.data.sfxVolume;
  }

  public set sfxVolume(value: number) {
    this.data.sfxVolume = Math.max(0, Math.min(1, value));
    this.save();
    this.notify();
  }

  /** Music volume after applying master mute. Consumers should read this. */
  public get effectiveMusicVolume(): number {
    return this.masterMuted ? 0 : this.data.musicVolume;
  }

  /** SFX volume after applying master mute. Consumers should read this. */
  public get effectiveSfxVolume(): number {
    return this.masterMuted ? 0 : this.data.sfxVolume;
  }

  public get isMasterMuted(): boolean {
    return this.masterMuted;
  }

  /**
   * Toggle transient master mute. Idempotent: a no-op change doesn't notify.
   * Not persisted (see `masterMuted` docs).
   */
  public setMasterMuted(muted: boolean): void {
    if (this.masterMuted === muted) return;
    this.masterMuted = muted;
    this.notify();
  }

  public onChange(listener: ChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private load(): AudioSettingsData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          const obj = parsed as Record<string, unknown>;
          return {
            musicVolume:
              typeof obj['musicVolume'] === 'number'
                ? obj['musicVolume']
                : DEFAULTS.musicVolume,
            sfxVolume:
              typeof obj['sfxVolume'] === 'number'
                ? obj['sfxVolume']
                : DEFAULTS.sfxVolume,
          };
        }
      }
    } catch {
      // Ignore parse errors
    }
    return { ...DEFAULTS };
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Ignore quota errors
    }
  }
}

/** Global audio settings instance */
export const audioSettings = new AudioSettingsStore();
