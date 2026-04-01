/**
 * Physics event type constants for EventBus communication.
 */
export const PhysicsEvents = {
  COLLISION: 'physics:collision',
  TRIGGER_ENTER: 'physics:trigger:enter',
  TRIGGER_EXIT: 'physics:trigger:exit',
} as const;
