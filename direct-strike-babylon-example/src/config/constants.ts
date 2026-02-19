/**
 * Game constants and server configuration
 */

// Server settings - uses environment variable with fallback to localhost
export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

/**
 * Authentication configuration
 * Google OAuth client ID - must be set via VITE_GOOGLE_CLIENT_ID environment variable
 */
export const authConfig = {
  // Google OAuth Client ID for sign-in
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',

  // Enable/disable auth requirement
  authEnabled: !!import.meta.env.VITE_GOOGLE_CLIENT_ID,

  // Token exchange URL - the server endpoint that exchanges auth code for tokens
  // This keeps the client_secret secure on the server
  tokenExchangeUrl: `${import.meta.env.VITE_SERVER_URL || 'http://localhost:3000'}/auth/token`,
};

/**
 * Network tick configuration for deterministic lockstep simulation
 * All clients simulate the game in lockstep using these settings
 */
export const networkConfig = {
  // Tick rate (ticks per second) - must match server's tickRate
  tickRate: 20,

  // Fixed timestep for simulation (seconds per tick)
  // This is 1/tickRate = 1/20 = 0.05 seconds = 50ms per tick
  tickTimestep: 1 / 20,

  // Number of physics sub-steps per network tick
  // Higher = more accurate physics, but more CPU
  // 3 substeps at 20 ticks/sec = 60 physics updates/sec
  physicsSubsteps: 3,
};

/**
 * Camera configuration for RTS-style top-down camera
 */
export const cameraConfig = {
  // Camera height above ground (increased for larger arena)
  height: 90,

  // How far ahead of camera position to look (creates the angled view)
  lookAheadOffset: 50,

  // Camera movement speed (units per second, increased for larger arena)
  moveSpeed: 80,

  // Padding from arena edges (prevents camera going too far out)
  boundsPadding: 20,

  // Pinch-to-zoom height bounds for mobile
  minHeight: 40,
  maxHeight: 180,

  // Pinch zoom sensitivity
  zoomSensitivity: 0.5,
};

// Game settings
export const UNITS_PER_PLAYER = 3;
export const TOWERS_PER_PLAYER = 1;

/**
 * Resource system configuration
 */
export const resourceConfig = {
  // Starting resources for each player
  initialResources: 200,

  // Base resource generation rate (per second)
  baseGenerationRate: 100,

  // Aggression bonus multiplier when on enemy territory
  aggressionBonusMultiplier: 2.0,

  // Resource bonus for destroying enemy tower
  towerDestructionBonus: 300,
};

/**
 * Unit costs and stats
 * Note: Grid sizes are defined in UnitGridSize (components/UnitTypeComponent.ts)
 */
export const unitConfig = {
  /** @deprecated Use mutant instead */
  sphere: {
    cost: 100,
    health: 50,
    attackDamage: 7,
    attackRange: 18,
    attackCooldown: 0.6,
    moveSpeed: 8,
  },
  prisma: {
    cost: 350,
    health: 180, // Reduced from 200
    attackDamage: 35, // Unchanged
    attackRange: 20,
    attackCooldown: 1,
    moveSpeed: 8,
  },
  lance: {
    cost: 200,
    health: 90, // Reduced from 100
    attackDamage: 18, // Unchanged
    attackRange: 25,
    attackCooldown: 1.2,
    moveSpeed: 8,
  },
  mutant: {
    cost: 100,
    health: 120,
    attackDamage: 18,
    attackRange: 12, // Melee range (increased to reduce stacking)
    detectionRange: 30, // Large detection radius (like tower)
    attackCooldown: 0, // No cooldown - animation length is natural cooldown
    moveSpeed: 8,
  },
};

/**
 * Wave system configuration
 * Units are deployed in waves at regular intervals
 */
export const waveConfig = {
  // Duration of each wave in seconds
  waveDuration: 45,

  // Wave 0 duration - initial preparation time before first deployment
  // Set to same as waveDuration by default, but can be customized
  initialWaveDuration: 15,

  // Whether Wave 0 deploys units (false = preparation wave only)
  deployOnWaveZero: false,

  // Staggered deployment settings
  // Maximum units to spawn per tick to prevent frame drops
  unitsPerTick: 3,

  // Number of ticks to skip between spawn batches
  // 0 = spawn every tick, 1 = spawn every other tick, 2 = spawn every 3rd tick, etc.
  ticksBetweenSpawns: 3,

  // Whether to use staggered deployment (false = spawn all at once like before)
  useStaggeredDeployment: true,
};

/**
 * Arena parameters for the game map
 *
 * Calculations:
 * - Unit move speed: 8 units/second
 * - Arena length traversable in 45 seconds (1.5 waves): 8 * 45 = 360 units combat zone
 * - Formation grid: 10 cells wide x 20 cells tall = 40w x 80h units
 * - Total ground width: combat zone (360) + grids (40*2) + margins = ~480 units
 *
 * Split vertically at x=0
 */
export const arenaParams = {
  // Ground dimensions
  // Width: 360 (combat zone) + 40*2 (grids) + 20*2 (margins) = 480
  // Height: 80 (grid height) + margins
  ground: {
    width: 480,
    height: 100,
  },

  // Formation grid dimensions (spawn area)
  // 10 cells wide x 20 cells tall
  formationGrid: {
    width: 40, // 10 cells * 4 spacing
    height: 80, // 20 cells * 4 spacing
    gridSpacing: 4, // Space between grid lines
  },

  // Team A (Left side, x < 0)
  // Grid width 40, centered at x=-220 means grid spans x=-240 to x=-200
  // Spawn area at x=-180, combat zone spans -180 to +180 = 360 units
  teamA: {
    formationGridCenter: { x: -220, z: 0 }, // Grid spans -240 to -200
    base: { x: -195, z: 0 }, // Right next to grid (grid inner edge is at -200)
    // Spawn area is in front of the base (towards enemy)
    spawnArea: { x: -180, z: 0 }, // Units spawn here and move towards x=0
    // Towers distributed evenly across combat zone (-180 to 0)
    // Divide -180 to 0 into 3 equal parts: -120, -60
    towers: [
      { x: -120, z: 0 }, // First tower - evenly distributed
      { x: -60, z: 0 }, // Second tower - evenly distributed
    ],
  },

  // Team B (Right side, x > 0) - Mirror of Team A
  // Grid width 40, centered at x=220 means grid spans x=200 to x=240
  teamB: {
    formationGridCenter: { x: 220, z: 0 }, // Grid spans 200 to 240
    base: { x: 195, z: 0 }, // Right next to grid (grid inner edge is at 200)
    // Spawn area is in front of the base (towards enemy)
    spawnArea: { x: 180, z: 0 }, // Units spawn here and move towards x=0
    // Towers distributed evenly across combat zone (0 to 180)
    towers: [
      { x: 120, z: 0 }, // First tower - evenly distributed
      { x: 60, z: 0 }, // Second tower - evenly distributed
    ],
  },

  // Walls
  walls: {
    top: { z: 50 },
    bottom: { z: -50 },
    thickness: 1,
    height: 2,
  },

  // Divider line
  divider: {
    x: 0,
  },

  // Visual settings
  colors: {
    ground: { r: 0.15, g: 0.25, b: 0.2 },
    teamA: { r: 0.2, g: 0.4, b: 0.8 }, // Blue
    teamB: { r: 0.8, g: 0.2, b: 0.2 }, // Red
    wall: { r: 0.3, g: 0.3, b: 0.3 },
    divider: { r: 0, g: 0, b: 0 }, // Black
    gridLine: { r: 0.4, g: 0.4, b: 0.4 },
    base: { r: 0.5, g: 0.5, b: 0.5 },
  },
};

// Spawn positions for 1v1 (on formation grids)
export const TEAM1_SPAWN = {
  tower: arenaParams.teamA.base, // Base position for reference
  units: [
    { x: arenaParams.teamA.formationGridCenter.x, z: 0 },
    { x: arenaParams.teamA.formationGridCenter.x - 4, z: 8 },
    { x: arenaParams.teamA.formationGridCenter.x + 4, z: -8 },
  ],
};

export const TEAM2_SPAWN = {
  tower: arenaParams.teamB.base, // Base position for reference
  units: [
    { x: arenaParams.teamB.formationGridCenter.x, z: 0 },
    { x: arenaParams.teamB.formationGridCenter.x + 4, z: 8 },
    { x: arenaParams.teamB.formationGridCenter.x - 4, z: -8 },
  ],
};
