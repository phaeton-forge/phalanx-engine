# GitHub Copilot Instructions

## General Rules
- You are an expert in TypeScript, Node.js, Game Architecture, and ECS (Entity-Component-System) patterns.
- Use strict TypeScript. No `any`. Use `unknown` with type guards if necessary.
- Prefer Interfaces over Types for public APIs and extensible models.
- All technical decisions must follow ECS best practices and deterministic architecture principles.

## ECS Architecture
- **Entities**: Pure identifiers (IDs). No logic, no data beyond component references.
- **Components**: Data-only classes/structs. No methods, no behavior — just state.
- **Systems**: Stateless processors that operate on entities with specific component queries.
- Keep systems decoupled: systems should not directly call other systems.
- Use queries to filter entities by component composition efficiently.
- Prefer composition over inheritance for entities.

## Game Dev & Performance (Context: Deterministic Lockstep)
- Avoid garbage collection spikes: reuse objects, use pools instead of `new` inside loops.
- Use `const` assertions for enums/config objects to ensure immutability.
- Math operations: use optimized libraries (e.g., custom vector libs) instead of creating new objects.

## Testing & Networking
- When writing network code, assume deterministic lockstep constraints (no floating point non-determinism).
- Prefer isolating side-effects for easier unit testing.

## Style
- Naming: camelCase for variables/functions, PascalCase for classes/interfaces.
- File structure: Colocate tests with implementation (`foo.ts`, `foo.test.ts`).

