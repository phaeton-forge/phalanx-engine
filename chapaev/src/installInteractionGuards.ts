let installed = false;

export function installInteractionGuards(): void {
  if (installed) return;
  installed = true;

  const preventDefault = (event: Event): void => {
    event.preventDefault();
  };

  document.addEventListener('contextmenu', preventDefault, { capture: true });
  document.addEventListener('selectstart', preventDefault, { capture: true });
  document.addEventListener('dragstart', preventDefault, { capture: true });
}
