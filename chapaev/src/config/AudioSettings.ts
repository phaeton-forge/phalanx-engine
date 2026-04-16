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
            musicVolume: typeof obj['musicVolume'] === 'number' ? obj['musicVolume'] : DEFAULTS.musicVolume,
            sfxVolume: typeof obj['sfxVolume'] === 'number' ? obj['sfxVolume'] : DEFAULTS.sfxVolume,
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

