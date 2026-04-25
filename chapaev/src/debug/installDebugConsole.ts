import { Capacitor } from '@capacitor/core';
import type { InitOptions } from 'eruda';

const ENABLED_FLAG_VALUES = ['1', 'true', 'on', 'yes'] as const;
const DISABLED_FLAG_VALUES = ['0', 'false', 'off', 'no'] as const;

const ERUDA_OPTIONS: InitOptions = {
  autoScale: true,
  useShadowDom: true,
  defaults: {
    displaySize: 50,
    theme: 'dark',
    transparency: 0.95,
  },
};

let isInstalled = false;

function normalizeFlagValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  return value.trim().toLowerCase();
}

function isEnabledFlag(value: string | null | undefined): boolean {
  const normalizedValue = normalizeFlagValue(value);
  return normalizedValue !== null && ENABLED_FLAG_VALUES.includes(normalizedValue);
}

function isDisabledFlag(value: string | null | undefined): boolean {
  const normalizedValue = normalizeFlagValue(value);
  return normalizedValue !== null && DISABLED_FLAG_VALUES.includes(normalizedValue);
}

function isIosDevice(): boolean {
  if (Capacitor.getPlatform() === 'ios') {
    return true;
  }

  const userAgent = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(userAgent)) {
    return true;
  }

  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function shouldInstallDebugConsole(): boolean {
  const params = new URLSearchParams(window.location.search);
  const queryToggle = params.get('debugConsole') ?? params.get('eruda');

  if (isDisabledFlag(queryToggle)) {
    return false;
  }

  const isDebugBuild = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEBUG_CONSOLE === 'true';
  if (!isDebugBuild) {
    return false;
  }

  if (isEnabledFlag(queryToggle)) {
    return true;
  }

  return isIosDevice();
}

export async function installDebugConsole(): Promise<void> {
  if (isInstalled || !shouldInstallDebugConsole()) {
    return;
  }

  try {
    const { default: eruda } = await import('eruda');

    if (isInstalled) {
      return;
    }

    eruda.init(ERUDA_OPTIONS);
    eruda.show('console');
    isInstalled = true;
    console.info('[Chapayev] Debug console enabled');
  } catch (error: unknown) {
    console.warn('[Chapayev] Failed to enable debug console', error);
  }
}


