import * as THREE from 'three';
import { FPVector3 } from '@phalanx-engine/math';
import type { SceneContext } from './SceneSetup.ts';
import { createBoardMesh } from './BoardMesh.ts';
import { createCheckerMesh } from './CheckerMesh.ts';
import {
  INITIAL_POSITIONS,
  CAMERA_POSITION,
  BOARD_HEIGHT,
  CHECKER_HEIGHT,
} from '../config/constants.ts';
import { TeamTag } from '../enums/TeamTag.ts';

/**
 * Owns the decorative scene shown behind menu screens (board + checkers,
 * auto-rotating camera) and the camera-pose tweak applied when entering
 * a match. Keeps this presentation concern out of `Game`.
 */
export class MenuScenePresenter {
  private rafHandle = 0;
  private decorations: THREE.Object3D[] = [];

  constructor(private readonly sceneCtx: SceneContext) {}

  startAutoRotate(): void {
    const { controls, composer } = this.sceneCtx;

    controls.enabled = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    this.addDecorations();

    const animate = (): void => {
      controls.update();
      composer.render();
      this.rafHandle = requestAnimationFrame(animate);
    };
    this.rafHandle = requestAnimationFrame(animate);
  }

  stopAutoRotate(): void {
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
    this.sceneCtx.controls.autoRotate = false;
    this.sceneCtx.controls.enabled = true;

    this.removeDecorations();
  }

  /** Position camera behind the local player's checkers. */
  adjustCameraForTeam(team: TeamTag): void {
    const { camera, controls } = this.sceneCtx;
    const zSign = team === TeamTag.White ? 1 : -1;

    camera.position.set(
      CAMERA_POSITION.x,
      CAMERA_POSITION.y,
      CAMERA_POSITION.z * zSign
    );
    controls.target.set(0, 0, 0);
    controls.update();
  }

  private addDecorations(): void {
    this.removeDecorations();

    const { scene } = this.sceneCtx;
    const yChecker = BOARD_HEIGHT / 2 + CHECKER_HEIGHT / 2;

    const boardGroup = createBoardMesh();
    scene.add(boardGroup);
    this.decorations.push(boardGroup);

    for (const placement of INITIAL_POSITIONS) {
      const team = placement.team === 'white' ? TeamTag.White : TeamTag.Black;
      const mesh = createCheckerMesh(team);
      const pos = FPVector3.ToFloat(placement.position);
      mesh.position.set(pos.x, yChecker, pos.z);
      scene.add(mesh);
      this.decorations.push(mesh);
    }
  }

  private removeDecorations(): void {
    const { scene } = this.sceneCtx;
    for (const obj of this.decorations) {
      scene.remove(obj);
    }
    this.decorations = [];
  }
}
