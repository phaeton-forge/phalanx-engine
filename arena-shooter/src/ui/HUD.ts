// Stage 2: Babylon GUI HUD implementation
// This file will replace the HTML overlay HUD from Stage 1

import {
  AdvancedDynamicTexture,
  TextBlock,
  Rectangle,
  Control,
  StackPanel,
  Ellipse,
  Button,
} from '@babylonjs/gui';
import type { Scene } from '@babylonjs/core';
import type { GameState } from '../components/WaveComponent.ts';
import { WEAPON_MAX_AMMO } from '../config/constants.ts';

export class HUD {
  private ui: AdvancedDynamicTexture;

  // Health bar
  private healthBarContainer: Rectangle;
  private healthBarFill: Rectangle;
  private healthText: TextBlock;

  // Ammo
  private ammoPanel: StackPanel;
  private ammoIndicators: Ellipse[] = [];

  // Reload bar
  private reloadContainer: Rectangle;
  private reloadBarFill: Rectangle;
  private reloadText: TextBlock;

  // Wave info
  private waveText: TextBlock;
  private enemyText: TextBlock;

  // Overlays
  private waveClearPanel: Rectangle;
  private waveClearTitle: TextBlock;
  private waveClearCountdown: TextBlock;

  private gameOverPanel: Rectangle;
  private gameOverTitle: TextBlock;
  private gameOverSubtitle: TextBlock;

  private victoryPanel: Rectangle;
  private victoryTitle: TextBlock;
  private victorySubtitle: TextBlock;

  constructor(scene: Scene) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI('hud', true, scene);

    // Health bar
    this.healthBarContainer = new Rectangle('healthBarContainer');
    this.healthBarContainer.width = '200px';
    this.healthBarContainer.height = '20px';
    this.healthBarContainer.color = '#00FF66';
    this.healthBarContainer.thickness = 1;
    this.healthBarContainer.background = '#111';
    this.healthBarContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.healthBarContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.healthBarContainer.left = 20;
    this.healthBarContainer.top = -60;
    this.ui.addControl(this.healthBarContainer);

    this.healthBarFill = new Rectangle('healthBarFill');
    this.healthBarFill.width = 1;
    this.healthBarFill.height = 1;
    this.healthBarFill.background = '#00FF66';
    this.healthBarFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.healthBarContainer.addControl(this.healthBarFill);

    this.healthText = new TextBlock('healthText', '100/100');
    this.healthText.color = '#FFFFFF';
    this.healthText.fontSize = 12;
    this.healthText.fontFamily = 'Orbitron';
    this.healthBarContainer.addControl(this.healthText);

    // Ammo panel
    this.ammoPanel = new StackPanel('ammoPanel');
    this.ammoPanel.isVertical = false;
    this.ammoPanel.height = '20px';
    this.ammoPanel.width = '200px';
    this.ammoPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.ammoPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.ammoPanel.left = 20;
    this.ammoPanel.top = -30;
    this.ui.addControl(this.ammoPanel);

    for (let i = 0; i < WEAPON_MAX_AMMO; i++) {
      const dot = new Ellipse(`ammo_${i}`);
      dot.width = '16px';
      dot.height = '16px';
      dot.background = '#00FFFF';
      dot.color = '#00FFFF';
      dot.thickness = 1;
      dot.paddingRight = '4px';
      this.ammoPanel.addControl(dot);
      this.ammoIndicators.push(dot);
    }

    // Reload bar
    this.reloadContainer = new Rectangle('reloadContainer');
    this.reloadContainer.width = '200px';
    this.reloadContainer.height = '20px';
    this.reloadContainer.color = '#FFAA00';
    this.reloadContainer.thickness = 1;
    this.reloadContainer.background = '#111';
    this.reloadContainer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.reloadContainer.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.reloadContainer.left = 20;
    this.reloadContainer.top = -30;
    this.reloadContainer.isVisible = false;
    this.ui.addControl(this.reloadContainer);

    this.reloadBarFill = new Rectangle('reloadBarFill');
    this.reloadBarFill.width = 0;
    this.reloadBarFill.height = 1;
    this.reloadBarFill.background = '#FFAA00';
    this.reloadBarFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.reloadContainer.addControl(this.reloadBarFill);

    this.reloadText = new TextBlock('reloadText', 'RELOADING...');
    this.reloadText.color = '#FFAA00';
    this.reloadText.fontSize = 12;
    this.reloadText.fontFamily = 'Orbitron';
    this.reloadContainer.addControl(this.reloadText);

    // Wave info
    this.waveText = new TextBlock('waveText', 'WAVE 0/10');
    this.waveText.color = '#88CCFF';
    this.waveText.fontSize = 16;
    this.waveText.fontFamily = 'Orbitron';
    this.waveText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    this.waveText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.waveText.left = -20;
    this.waveText.top = 20;
    this.waveText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    this.ui.addControl(this.waveText);

    this.enemyText = new TextBlock('enemyText', 'ENEMIES: 0');
    this.enemyText.color = '#88CCFF';
    this.enemyText.fontSize = 14;
    this.enemyText.fontFamily = 'Orbitron';
    this.enemyText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    this.enemyText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.enemyText.left = -20;
    this.enemyText.top = 44;
    this.enemyText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    this.ui.addControl(this.enemyText);

    // Wave clear overlay
    this.waveClearPanel = this.createOverlayPanel('#00000088');
    this.waveClearPanel.isVisible = false;
    this.ui.addControl(this.waveClearPanel);

    this.waveClearTitle = new TextBlock('waveClearTitle', 'WAVE CLEARED');
    this.waveClearTitle.color = '#00FFFF';
    this.waveClearTitle.fontSize = 36;
    this.waveClearTitle.fontFamily = 'Orbitron';
    this.waveClearTitle.top = -30;
    this.waveClearPanel.addControl(this.waveClearTitle);

    this.waveClearCountdown = new TextBlock('waveClearCountdown', 'NEXT WAVE IN: 3s');
    this.waveClearCountdown.color = '#88CCFF';
    this.waveClearCountdown.fontSize = 20;
    this.waveClearCountdown.fontFamily = 'Orbitron';
    this.waveClearCountdown.top = 20;
    this.waveClearPanel.addControl(this.waveClearCountdown);

    // Game Over overlay
    this.gameOverPanel = this.createOverlayPanel('#000000CC');
    this.gameOverPanel.isVisible = false;
    this.ui.addControl(this.gameOverPanel);

    this.gameOverTitle = new TextBlock('goTitle', 'GAME OVER');
    this.gameOverTitle.color = '#FF2200';
    this.gameOverTitle.fontSize = 48;
    this.gameOverTitle.fontFamily = 'Orbitron';
    this.gameOverTitle.fontWeight = 'bold';
    this.gameOverTitle.top = -40;
    this.gameOverPanel.addControl(this.gameOverTitle);

    this.gameOverSubtitle = new TextBlock('goSubtitle', 'You survived 0 waves');
    this.gameOverSubtitle.color = '#88CCFF';
    this.gameOverSubtitle.fontSize = 18;
    this.gameOverSubtitle.fontFamily = 'Orbitron';
    this.gameOverSubtitle.top = 10;
    this.gameOverPanel.addControl(this.gameOverSubtitle);

    const goBtn = this.createRestartButton('#FF2200');
    goBtn.top = 60;
    this.gameOverPanel.addControl(goBtn);

    // Victory overlay
    this.victoryPanel = this.createOverlayPanel('#000000CC');
    this.victoryPanel.isVisible = false;
    this.ui.addControl(this.victoryPanel);

    this.victoryTitle = new TextBlock('victoryTitle', 'VICTORY');
    this.victoryTitle.color = '#00FFFF';
    this.victoryTitle.fontSize = 48;
    this.victoryTitle.fontFamily = 'Orbitron';
    this.victoryTitle.fontWeight = 'bold';
    this.victoryTitle.top = -40;
    this.victoryPanel.addControl(this.victoryTitle);

    this.victorySubtitle = new TextBlock('victorySubtitle', 'All 10 waves defeated');
    this.victorySubtitle.color = '#88CCFF';
    this.victorySubtitle.fontSize = 18;
    this.victorySubtitle.fontFamily = 'Orbitron';
    this.victorySubtitle.top = 10;
    this.victoryPanel.addControl(this.victorySubtitle);

    const vicBtn = this.createRestartButton('#00FFFF');
    vicBtn.top = 60;
    this.victoryPanel.addControl(vicBtn);
  }

  private createOverlayPanel(bg: string): Rectangle {
    const panel = new Rectangle();
    panel.width = 1;
    panel.height = 1;
    panel.background = bg;
    panel.thickness = 0;
    return panel;
  }

  private createRestartButton(color: string): Button {
    const btn = Button.CreateSimpleButton('restartBtn', 'RESTART');
    btn.width = '200px';
    btn.height = '50px';
    btn.color = color;
    btn.background = 'transparent';
    btn.thickness = 2;
    btn.fontFamily = 'Orbitron';
    btn.fontSize = 18;
    btn.onPointerClickObservable.add(() => {
      window.location.reload();
    });
    return btn;
  }

  public update(
    hp: number, maxHp: number,
    ammo: number, maxAmmo: number,
    isReloading: boolean, reloadProgress: number,
    currentWave: number, totalWaves: number,
    enemiesAlive: number,
    state: GameState,
    waveTimerSeconds: number,
  ): void {
    // Health bar
    const hpRatio = hp / maxHp;
    this.healthBarFill.width = hpRatio;
    this.healthText.text = `${hp}/${maxHp}`;

    if (hpRatio > 0.5) {
      this.healthBarFill.background = '#00FF66';
      this.healthBarContainer.color = '#00FF66';
    } else if (hpRatio > 0.25) {
      this.healthBarFill.background = '#FFCC00';
      this.healthBarContainer.color = '#FFCC00';
    } else {
      this.healthBarFill.background = '#FF2200';
      this.healthBarContainer.color = '#FF2200';
    }

    // Ammo / Reload
    if (isReloading) {
      this.ammoPanel.isVisible = false;
      this.reloadContainer.isVisible = true;
      this.reloadBarFill.width = reloadProgress;
    } else {
      this.ammoPanel.isVisible = true;
      this.reloadContainer.isVisible = false;
      for (let i = 0; i < maxAmmo; i++) {
        if (i < this.ammoIndicators.length) {
          this.ammoIndicators[i].background = i < ammo ? '#00FFFF' : '#334455';
        }
      }
    }

    // Wave info
    this.waveText.text = `WAVE ${currentWave}/${totalWaves}`;
    this.enemyText.text = `ENEMIES: ${enemiesAlive}`;

    // Overlays
    this.waveClearPanel.isVisible = state === 'WAVE_CLEAR_PAUSE';
    if (state === 'WAVE_CLEAR_PAUSE') {
      this.waveClearTitle.text = `WAVE ${currentWave} CLEARED`;
      this.waveClearCountdown.text = `NEXT WAVE IN: ${waveTimerSeconds}s`;
    }

    this.gameOverPanel.isVisible = state === 'GAME_OVER';
    if (state === 'GAME_OVER') {
      this.gameOverSubtitle.text = `You survived ${currentWave} waves`;
    }

    this.victoryPanel.isVisible = state === 'VICTORY';
  }

  public dispose(): void {
    this.ui.dispose();
  }
}
