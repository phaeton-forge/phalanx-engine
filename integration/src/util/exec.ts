import { spawn } from 'node:child_process';

export function exec(
  command: string,
  args: readonly string[],
  cwd: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err.push(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} exited ${String(code)}\n${stderr || stdout}`
        )
      );
    });
  });
}
