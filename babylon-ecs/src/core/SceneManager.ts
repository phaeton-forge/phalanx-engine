import {
    Scene,
    Vector3,
    HemisphericLight,
    DirectionalLight,
    ShadowGenerator,
    MeshBuilder,
    StandardMaterial,
    Color3,
    Mesh,
    LinesMesh,
} from '@babylonjs/core';
import {PrismaUnit} from '../entities/PrismaUnit';
import type {PrismaUnitConfig} from '../entities/PrismaUnit';
import {LanceUnit} from '../entities/LanceUnit';
import type {LanceUnitConfig} from '../entities/LanceUnit';
import {MutantUnit} from '../entities/MutantUnit';
import type {MutantUnitConfig} from '../entities/MutantUnit';
import {Tower} from '../entities/Tower';
import type {TowerConfig} from '../entities/Tower';
import {Base} from '../entities/Base';
import type {BaseConfig} from '../entities/Base';
import {arenaParams} from '../config/constants';

/**
 * SceneManager - Handles scene setup and world object creation
 * Follows Single Responsibility: Only manages scene elements
 */
export class SceneManager {
    private scene: Scene;
    private ground: Mesh | null = null;
    private destinationMarker: Mesh | null = null;
    private shadowGenerator: ShadowGenerator | null = null;

    // Arena elements
    private arenaMeshes: Mesh[] = [];
    private arenaLines: LinesMesh[] = [];

    constructor(scene: Scene) {
        this.scene = scene;
    }

    public setupLighting(): void {
        // Ambient light for general illumination
        const hemiLight = new HemisphericLight(
            'hemiLight',
            new Vector3(0, 1, 0),
            this.scene
        );
        hemiLight.intensity = 0.3;
        // Directional light for shadows - positioned at an angle visible from camera
        const dirLight = new DirectionalLight(
            'dirLight',
            new Vector3(-1, -2, 1), // Angled to cast shadows visible from camera position
            this.scene
        );
        dirLight.position = new Vector3(10, 20, -10);
        dirLight.intensity = 0.8;
        // Setup shadow generator
        this.shadowGenerator = new ShadowGenerator(1024, dirLight);
        this.shadowGenerator.useBlurExponentialShadowMap = true;
        this.shadowGenerator.blurKernel = 32;
    }

    public createGround(): Mesh {
        const {ground: groundParams, colors} = arenaParams;

        this.ground = MeshBuilder.CreateGround(
            'ground',
            {width: groundParams.width, height: groundParams.height},
            this.scene
        );
        const groundMat = new StandardMaterial('groundMat', this.scene);
        groundMat.diffuseColor = new Color3(
            colors.ground.r,
            colors.ground.g,
            colors.ground.b
        );
        groundMat.specularColor = new Color3(0.1, 0.1, 0.1);
        groundMat.roughness = 0.9;
        this.ground.material = groundMat;
        this.ground.receiveShadows = true;

        // Create arena elements (visual only - entities created in Game.ts)
        this.createDividerLine();
        this.createWalls();
        this.createFormationGrids();

        this.createDestinationMarker();
        return this.ground;
    }

    /**
     * Create the center divider line at x=0
     */
    private createDividerLine(): void {
        const {ground: groundParams, colors} = arenaParams;
        const halfHeight = groundParams.height / 2;

        const points = [
            new Vector3(0, 0.05, -halfHeight),
            new Vector3(0, 0.05, halfHeight),
        ];

        const dividerLine = MeshBuilder.CreateLines(
            'dividerLine',
            {points},
            this.scene
        );
        dividerLine.color = new Color3(
            colors.divider.r,
            colors.divider.g,
            colors.divider.b
        );
        dividerLine.isPickable = false;
        this.arenaLines.push(dividerLine);
    }

    /**
     * Create walls along top and bottom edges
     */
    private createWalls(): void {
        const {ground: groundParams, walls, colors} = arenaParams;

        const wallMat = new StandardMaterial('wallMat', this.scene);
        wallMat.diffuseColor = new Color3(
            colors.wall.r,
            colors.wall.g,
            colors.wall.b
        );

        // Top wall (z = 30)
        const topWall = MeshBuilder.CreateBox(
            'topWall',
            {
                width: groundParams.width,
                height: walls.height,
                depth: walls.thickness,
            },
            this.scene
        );
        topWall.position = new Vector3(0, walls.height / 2, walls.top.z);
        topWall.material = wallMat;
        topWall.isPickable = false;
        this.arenaMeshes.push(topWall);

        // Bottom wall (z = -30)
        const bottomWall = MeshBuilder.CreateBox(
            'bottomWall',
            {
                width: groundParams.width,
                height: walls.height,
                depth: walls.thickness,
            },
            this.scene
        );
        bottomWall.position = new Vector3(0, walls.height / 2, walls.bottom.z);
        bottomWall.material = wallMat;
        bottomWall.isPickable = false;
        this.arenaMeshes.push(bottomWall);
    }

    /**
     * Create formation grid for unit placement
     */
    private createFormationGrid(
        centerX: number,
        centerZ: number,
        teamColor: Color3
    ): void {
        const {formationGrid, colors} = arenaParams;
        const halfWidth = formationGrid.width / 2;
        const halfHeight = formationGrid.height / 2;
        const spacing = formationGrid.gridSpacing;

        // Create grid lines material
        const gridColor = new Color3(
            (colors.gridLine.r + teamColor.r) / 2,
            (colors.gridLine.g + teamColor.g) / 2,
            (colors.gridLine.b + teamColor.b) / 2
        );

        // Create border rectangle
        const borderPoints = [
            new Vector3(centerX - halfWidth, 0.03, centerZ - halfHeight),
            new Vector3(centerX + halfWidth, 0.03, centerZ - halfHeight),
            new Vector3(centerX + halfWidth, 0.03, centerZ + halfHeight),
            new Vector3(centerX - halfWidth, 0.03, centerZ + halfHeight),
            new Vector3(centerX - halfWidth, 0.03, centerZ - halfHeight), // Close the rectangle
        ];

        const border = MeshBuilder.CreateLines(
            `formationBorder_${centerX}`,
            {points: borderPoints},
            this.scene
        );
        border.color = teamColor;
        border.isPickable = false;
        this.arenaLines.push(border);

        // Create vertical grid lines
        for (
            let x = centerX - halfWidth + spacing;
            x < centerX + halfWidth;
            x += spacing
        ) {
            const linePoints = [
                new Vector3(x, 0.02, centerZ - halfHeight),
                new Vector3(x, 0.02, centerZ + halfHeight),
            ];
            const line = MeshBuilder.CreateLines(
                `gridLineV_${x}`,
                {points: linePoints},
                this.scene
            );
            line.color = gridColor;
            line.isPickable = false;
            this.arenaLines.push(line);
        }

        // Create horizontal grid lines
        for (
            let z = centerZ - halfHeight + spacing;
            z < centerZ + halfHeight;
            z += spacing
        ) {
            const linePoints = [
                new Vector3(centerX - halfWidth, 0.02, z),
                new Vector3(centerX + halfWidth, 0.02, z),
            ];
            const line = MeshBuilder.CreateLines(
                `gridLineH_${z}`,
                {points: linePoints},
                this.scene
            );
            line.color = gridColor;
            line.isPickable = false;
            this.arenaLines.push(line);
        }
    }

    /**
     * Create formation grids for both teams
     */
    private createFormationGrids(): void {
        const {teamA, teamB, colors} = arenaParams;

        const teamAColor = new Color3(
            colors.teamA.r,
            colors.teamA.g,
            colors.teamA.b
        );
        const teamBColor = new Color3(
            colors.teamB.r,
            colors.teamB.g,
            colors.teamB.b
        );

        this.createFormationGrid(
            teamA.formationGridCenter.x,
            teamA.formationGridCenter.z,
            teamAColor
        );
        this.createFormationGrid(
            teamB.formationGridCenter.x,
            teamB.formationGridCenter.z,
            teamBColor
        );
    }

    private createDestinationMarker(): void {
        this.destinationMarker = MeshBuilder.CreateDisc(
            'destMarker',
            {radius: 0.8},
            this.scene
        );
        this.destinationMarker.rotation.x = Math.PI / 2;
        this.destinationMarker.position.y = 0.02;
        this.destinationMarker.isVisible = false;
        const destMat = new StandardMaterial('destMat', this.scene);
        destMat.diffuseColor = new Color3(1, 0.5, 0);
        this.destinationMarker.material = destMat;
    }

    public createPrismaUnit(
        config: PrismaUnitConfig = {},
        position?: Vector3
    ): PrismaUnit {
        const unit = new PrismaUnit(this.scene, config, position);
        const unitMesh = unit.getMesh();
        if (this.shadowGenerator && unitMesh) {
            this.shadowGenerator.addShadowCaster(unitMesh);
        }
        return unit;
    }

    public createLanceUnit(
        config: LanceUnitConfig = {},
        position?: Vector3
    ): LanceUnit {
        const unit = new LanceUnit(this.scene, config, position);
        const unitMesh = unit.getMesh();
        if (this.shadowGenerator && unitMesh) {
            this.shadowGenerator.addShadowCaster(unitMesh);
        }
        return unit;
    }

    public createMutantUnit(
        config: MutantUnitConfig = {},
        position?: Vector3
    ): MutantUnit {
        const unit = new MutantUnit(this.scene, config, position);
        const unitMesh = unit.getMesh();
        if (this.shadowGenerator && unitMesh) {
            this.shadowGenerator.addShadowCaster(unitMesh);
        }
        return unit;
    }

    public createTower(config: TowerConfig, position?: Vector3): Tower {
        const tower = new Tower(this.scene, config, position);
        const towerMesh = tower.getMesh();
        if (this.shadowGenerator && towerMesh) {
            this.shadowGenerator.addShadowCaster(towerMesh);
        }
        return tower;
    }

    public createBase(config: BaseConfig, position?: Vector3): Base {
        const base = new Base(this.scene, config, position);
        const baseMesh = base.getMesh();
        if (this.shadowGenerator && baseMesh) {
            this.shadowGenerator.addShadowCaster(baseMesh);
        }
        return base;
    }

    public getGround(): Mesh | null {
        return this.ground;
    }

    public dispose(): void {
        // Dispose arena meshes
        for (const mesh of this.arenaMeshes) {
            mesh.dispose();
        }
        this.arenaMeshes = [];

        // Dispose arena lines
        for (const line of this.arenaLines) {
            line.dispose();
        }
        this.arenaLines = [];
    }
}
