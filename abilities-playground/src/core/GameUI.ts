import type { UnitType } from '../units/UnitType';

interface GameUICallbacks {
  onUnitDragStart: (type: UnitType) => void;
  onReady: () => void;
  onReturnLobby: () => void;
}

export class GameUI {
  private readonly deploymentControls: HTMLElement;
  private readonly resultOverlay: HTMLElement;
  private readonly readyButton: HTMLButtonElement;
  private readonly returnLobbyButton: HTMLButtonElement;
  private readonly deploymentStatus: HTMLElement;
  private readonly paletteButtons: HTMLButtonElement[] = [];
  private readonly onUnitDragStart: (type: UnitType) => void;
  private readonly onReady: () => void;
  private readonly onReturnLobby: () => void;

  constructor(callbacks: GameUICallbacks) {
    this.onUnitDragStart = callbacks.onUnitDragStart;
    this.onReady = callbacks.onReady;
    this.onReturnLobby = callbacks.onReturnLobby;

    this.deploymentControls = document.getElementById('deployment-controls')!;
    this.resultOverlay = document.getElementById('result-overlay')!;
    this.readyButton = document.getElementById('ready-btn') as HTMLButtonElement;
    this.returnLobbyButton = document.getElementById('return-lobby-btn') as HTMLButtonElement;
    this.deploymentStatus = document.getElementById('deployment-status')!;

    const unitButtonIds: { id: string; type: UnitType; label: string }[] = [
      { id: 'unit-btn-sphere', type: 'sphere', label: 'Sphere' },
      { id: 'unit-btn-cube', type: 'cube', label: 'Cube' },
      { id: 'unit-btn-support', type: 'support', label: 'Support' },
      { id: 'unit-btn-rocket', type: 'rocket', label: 'Rocket' },
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
    this.returnLobbyButton.addEventListener('click', this.handleReturnLobby);

    for (const btn of this.paletteButtons) {
      btn.addEventListener('pointerdown', this.handlePalettePointerDown);
    }
  }

  removeListeners(): void {
    this.readyButton.removeEventListener('click', this.handleReady);
    this.returnLobbyButton.removeEventListener('click', this.handleReturnLobby);

    for (const btn of this.paletteButtons) {
      btn.removeEventListener('pointerdown', this.handlePalettePointerDown);
    }
  }

  showStartOverlay(): void {
    this.readyButton.textContent = 'READY';
    this.readyButton.disabled = false;
    this.deploymentStatus.textContent = '';
    for (const btn of this.paletteButtons) {
      btn.disabled = false;
    }
    this.deploymentControls.classList.add('visible');
  }

  hideStartOverlay(): void {
    this.deploymentControls.classList.remove('visible');
  }

  showResultOverlay(title: string): void {
    this.deploymentControls.classList.remove('visible');
    const titleEl = document.getElementById('result-title');
    if (titleEl) titleEl.textContent = title;
    this.resultOverlay.classList.add('visible');
  }

  hideResultOverlay(): void {
    this.resultOverlay.classList.remove('visible', 'victory', 'defeat');
  }

  showWaitingStatus(): void {
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
    this.deploymentControls.classList.remove('visible');
  }

  private readonly handleReady = (): void => {
    this.onReady();
  };

  private readonly handleReturnLobby = (): void => {
    this.onReturnLobby();
  };

  private readonly handlePalettePointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    const btn = event.currentTarget as HTMLButtonElement;
    const type = btn.dataset.unitType as UnitType | undefined;
    if (type) {
      this.onUnitDragStart(type);
    }
  };
}
