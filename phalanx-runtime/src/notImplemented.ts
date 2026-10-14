/**
 * Thrown by skeleton members of the runtime. `task` is the number of the
 * sequential engine task (docs/design/runtime-api.md § Task map) that
 * implements the member.
 */
export class NotImplementedError extends Error {
  public readonly member: string;
  public readonly task: number;

  public constructor(member: string, task: number) {
    super(`not implemented: ${member} (Task ${String(task).padStart(2, '0')})`);
    this.name = 'NotImplementedError';
    this.member = member;
    this.task = task;
  }
}

export function notImplemented(member: string, task: number): never {
  throw new NotImplementedError(member, task);
}
