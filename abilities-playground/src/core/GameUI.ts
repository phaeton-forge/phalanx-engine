export class GameUI {
  private readonly startOverlay: HTMLElement;
  private readonly resultOverlay: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly returnLobbyButton: HTMLButtonElement;
  private readonly onStart: () => void;
  private readonly onReturnLobby: () => void;

  constructor(onStart: () => void, onReturnLobby: () => void) {
    this.onStart = onStart;
    this.onReturnLobby = onReturnLobby;
    this.startOverlay = document.getElementById('start-overlay')!;
    this.resultOverlay = document.getElementById('result-overlay')!;
    this.startButton = document.getElementById('start-btn') as HTMLButtonElement;
    this.returnLobbyButton = document.getElementById('return-lobby-btn') as HTMLButtonElement;
  }

  addListeners(): void {
    this.startButton.addEventListener('click', this.handleStart);
    this.returnLobbyButton.addEventListener('click', this.handleReturnLobby);
  }

  removeListeners(): void {
    this.startButton.removeEventListener('click', this.handleStart);
    this.returnLobbyButton.removeEventListener('click', this.handleReturnLobby);
  }

  showStartOverlay(): void {
    this.startOverlay.classList.add('visible');
  }

  hideStartOverlay(): void {
    this.startOverlay.classList.remove('visible');
  }

  showResultOverlay(title: string): void {
    this.startOverlay.classList.remove('visible');
    const titleEl = document.getElementById('result-title');
    if (titleEl) titleEl.textContent = title;
    this.resultOverlay.classList.add('visible');
  }

  hideResultOverlay(): void {
    this.resultOverlay.classList.remove('visible', 'victory', 'defeat');
  }

  private readonly handleStart = (): void => {
    this.onStart();
    this.hideStartOverlay();
  };

  private readonly handleReturnLobby = (): void => {
    this.onReturnLobby();
  };
}
