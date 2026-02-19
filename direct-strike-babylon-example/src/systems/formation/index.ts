/**
 * Formation Grid System - Module exports
 *
 * The formation grid system is split into several single-responsibility components:
 *
 * - FormationTypes: Type definitions and interfaces
 * - FormationGridData: Grid state management and coordinate conversions
 * - FormationGridRenderer: Visual rendering of grids and unit previews
 * - FormationHoverPreview: Hover highlight and preview rendering
 * - FormationInputHandler: Mouse/pointer input handling
 * - FormationDeployer: Unit deployment to battlefield
 *
 * The main FormationGridSystem facade is located at ../FormationGridSystem.ts
 */

export * from './FormationTypes';
export { FormationGridData } from './FormationGridData';
export { FormationGridRenderer } from './FormationGridRenderer';
export { FormationHoverPreview } from './FormationHoverPreview';
export { FormationInputHandler } from './FormationInputHandler';
export { FormationDeployer, type DeploymentUnitInfo } from './FormationDeployer';
