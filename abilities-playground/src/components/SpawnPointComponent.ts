import type * as THREE from 'three';
import { ComponentType } from './Component';
import type { IComponent } from './Component';

export class SpawnPointComponent implements IComponent {
    public readonly type = ComponentType.SpawnPoint;
    public readonly marker: THREE.Object3D;

    constructor(marker: THREE.Object3D) {
        this.marker = marker;
    }
}
