import type { UnitType } from '../units';

interface GameUICallbacks {
  onUnitSelect: (type: UnitType | null) => void;
  onReady: () => void;
  onResetArena: () => void;
  onReturnLobby: () => void;
}

interface ShowResultOverlayOptions {
  showResetArena?: boolean;
}

export class GameUI {
  private readonly deploymentControls: HTMLElement;
  private readonly resultOverlay: HTMLElement;
  private readonly readyButton: HTMLButtonElement;
  private readonly resetArenaButton: HTMLButtonElement;
  private readonly returnLobbyButton: HTMLButtonElement;
  private readonly deploymentStatus: HTMLElement;
  private readonly paletteButtons: HTMLButtonElement[] = [];
  private readonly onUnitSelect: (type: UnitType | null) => void;
  private readonly onReady: () => void;
  private readonly onResetArena: () => void;
  private readonly onReturnLobby: () => void;
  private selectedUnitType: UnitType | null = null;

  constructor(callbacks: GameUICallbacks) {
    this.onUnitSelect = callbacks.onUnitSelect;
    this.onReady = callbacks.onReady;
    this.onResetArena = callbacks.onResetArena;
    this.onReturnLobby = callbacks.onReturnLobby;

    this.deploymentControls = document.getElementById('deployment-controls')!;
    this.resultOverlay = document.getElementById('result-overlay')!;
    this.readyButton = document.getElementById(
      'ready-btn'
    ) as HTMLButtonElement;
    this.resetArenaButton = document.getElementById(
      'reset-arena-btn'
    ) as HTMLButtonElement;
    this.returnLobbyButton = document.getElementById(
      'return-lobby-btn'
    ) as HTMLButtonElement;
    this.deploymentStatus = document.getElementById('deployment-status')!;

    const unitButtonIds: { id: string; type: UnitType; label: string }[] = [
      { id: 'unit-btn-sphere', type: 'sphere', label: 'Sphere' },
      { id: 'unit-btn-cube', type: 'cube', label: 'Cube' },
      { id: 'unit-btn-support', type: 'support', label: 'Support' },
      { id: 'unit-btn-rocket', type: 'rocket', label: 'Rocket' },
      { id: 'unit-btn-volt', type: 'volt', label: 'Volt' },
      { id: 'unit-btn-plasma-tank', type: 'plasmaTank', label: 'Plasma Tank' },
      { id: 'unit-btn-sau', type: 'sau', label: 'SAU' },
    ];

    for (const { id, type, label } of unitButtonIds) {
      const btn = document.getElementById(id) as HTMLButtonElement | null;
      if (btn) {
        btn.textContent = label;
        btn.dataset.unitType = type;
        this.paletteButtons.push(btn);
      }
    }
  }

  addListeners(): void {
    this.readyButton.addEventListener('click', this.handleReady);
    this.resetArenaButton.addEventListener('click', this.handleResetArena);
    this.returnLobbyButton.addEventListener('click', this.handleReturnLobby);

    for (const btn of this.paletteButtons) {
      btn.addEventListener('click', this.handlePaletteClick);
    }
  }

  removeListeners(): void {
    this.readyButton.removeEventListener('click', this.handleReady);
    this.resetArenaButton.removeEventListener('click', this.handleResetArena);
    this.returnLobbyButton.removeEventListener('click', this.handleReturnLobby);

    for (const btn of this.paletteButtons) {
      btn.removeEventListener('click', this.handlePaletteClick);
    }
  }

  showStartOverlay(): void {
    this.readyButton.textContent = 'READY';
    this.readyButton.disabled = false;
    this.deploymentStatus.textContent = '';
    for (const btn of this.paletteButtons) {
      btn.disabled = false;
    }
    this.clearUnitSelection();
    this.deploymentControls.classList.add('visible');
  }

  hideStartOverlay(): void {
    this.clearUnitSelection();
    this.deploymentControls.classList.remove('visible');
  }

  showResultOverlay(
    title: string,
    options: ShowResultOverlayOptions = {}
  ): void {
    const { showResetArena = false } = options;
    this.clearUnitSelection();
    this.deploymentControls.classList.remove('visible');
    const titleEl = document.getElementById('result-title');
    if (titleEl) titleEl.textContent = title;

    this.resultOverlay.classList.remove('victory', 'defeat');
    if (title.startsWith('Victory')) {
      this.resultOverlay.classList.add('victory');
    } else if (title === 'Defeat') {
      this.resultOverlay.classList.add('defeat');
    }

    this.resetArenaButton.hidden = !showResetArena;
    this.resultOverlay.classList.add('visible');
  }

  hideResultOverlay(): void {
    this.resultOverlay.classList.remove('visible', 'victory', 'defeat');
    this.resetArenaButton.hidden = true;
  }

  showWaitingStatus(): void {
    this.clearUnitSelection();
    this.readyButton.disabled = true;
    this.deploymentStatus.textContent = 'Waiting for opponent…';
    for (const btn of this.paletteButtons) {
      btn.disabled = true;
    }
  }

  showPalette(): void {
    this.deploymentControls.classList.add('visible');
  }

  hidePalette(): void {
    this.clearUnitSelection();
    this.deploymentControls.classList.remove('visible');
  }

  /**
   * Sync button highlight with selection state (e.g. after Esc from input handler).
   */
  setSelectedUnit(type: UnitType | null): void {
    this.selectedUnitType = type;
    for (const btn of this.paletteButtons) {
      const isSelected = btn.dataset.unitType === type;
      btn.classList.toggle('selected', isSelected);
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    }
    this.deploymentStatus.textContent = type
      ? 'Press Esc to cancel placement'
      : '';
  }

  clearUnitSelection(): void {
    if (this.selectedUnitType === null) return;
    this.setSelectedUnit(null);
    this.onUnitSelect(null);
  }

  private readonly handleReady = (): void => {
    this.onReady();
  };

  private readonly handleResetArena = (): void => {
    this.onResetArena();
  };

  private readonly handleReturnLobby = (): void => {
    this.onReturnLobby();
  };

  private readonly handlePaletteClick = (event: MouseEvent): void => {
    const btn = event.currentTarget as HTMLButtonElement;
    if (btn.disabled) return;

    const type = btn.dataset.unitType as UnitType | undefined;
    if (!type) return;

    const next = this.selectedUnitType === type ? null : type;
    this.setSelectedUnit(next);
    this.onUnitSelect(next);
  };
}
