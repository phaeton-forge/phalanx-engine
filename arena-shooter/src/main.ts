import { Game } from './core/Game.ts';

const canvas = document.getElementById('render-canvas') as HTMLCanvasElement;
const game = new Game(canvas);
game.init();
