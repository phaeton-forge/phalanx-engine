/**
 * RulesScreen — displays game rules for Chapayev Checkers.
 */

import type { UIManager } from '../UIManager.ts';

export interface RulesCallbacks {
  onBack: () => void;
}

export class RulesScreen {
  private readonly callbacks: RulesCallbacks;

  constructor(uiManager: UIManager, callbacks: RulesCallbacks) {
    this.callbacks = callbacks;

    uiManager.registerScreen('rules', (container) => {
      this.render(container);
    });
  }

  private render(container: HTMLDivElement): void {
    container.className = 'ui-screen';
    container.innerHTML = `
      <div class="glass-panel rules-panel">
        <div class="rules-title">📜 Правила игры</div>
        <div class="rules-content">
          <p>
            <strong>Чапаев</strong> — настольная игра для двух игроков, в которой шашки выбиваются
            щелчками с доски. Игра названа в честь героя Гражданской войны Василия Чапаева.
          </p>
          <p>
            <strong>Подготовка.</strong> Каждый игрок расставляет 8 шашек на ближайшей к себе
            горизонтали шахматной доски. Белые занимают нижний ряд, чёрные — верхний.
          </p>
          <p>
            <strong>Ход.</strong> Игроки ходят по очереди. За один ход нужно щёлкнуть (сделать
            «флик») по одной из своих шашек, направив её в сторону шашек соперника. Цель —
            вытолкнуть чужие шашки за пределы доски. Если ваша шашка сама вылетает за край —
            она тоже выбывает из раунда.
          </p>
          <p>
            <strong>Конец раунда.</strong> Раунд завершается, когда у одного из игроков не
            остаётся шашек на доске. Победитель раунда продвигает свои шашки на одну
            горизонталь вперёд. Если обе стороны потеряли все шашки одновременно — ничья,
            раунд переигрывается.
          </p>
          <p>
            <strong>Победа.</strong> Побеждает тот, кто первым доведёт свои шашки до
            противоположного края доски (последней горизонтали соперника), выигрывая
            раунд за раундом.
          </p>
          <p>
            <strong>Совет:</strong> Старайтесь бить по касательной, чтобы одним ударом
            выбить сразу несколько шашек соперника и сохранить свою на доске!
          </p>
        </div>
        <button class="btn-ghost" data-ref="back-btn">← Назад</button>
      </div>
    `;

    const backBtn = container.querySelector('[data-ref="back-btn"]') as HTMLButtonElement;
    backBtn.addEventListener('click', () => this.callbacks.onBack());
  }
}

