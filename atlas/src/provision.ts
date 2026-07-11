import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

export interface Provisioned {
  baseUrl: string;
  port: number;
  proc: ChildProcess;
  logs: string[];
  stop: () => Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export async function provision(opts: {
  command: string;
  cwd: string;
  health: string;
  env: Record<string, string>;
  timeoutMs?: number;
}): Promise<Provisioned> {
  const port = await freePort();
  const baseUrl = `http://localhost:${port}`;
  const [cmd, ...args] = opts.command.split(' ');
  const logs: string[] = [];

  const proc = spawn(cmd, args, {
    cwd: path.resolve(opts.cwd),
    env: { ...process.env, ...opts.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (d) => logs.push(d.toString()));
  proc.stderr?.on('data', (d) => logs.push(d.toString()));

  const deadline = Date.now() + (opts.timeoutMs ?? 15000);
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Target process exited early (code ${proc.exitCode}):\n${logs.join('')}`);
    }
    try {
      const res = await fetch(baseUrl + opts.health);
      if (res.ok) {
        return {
          baseUrl,
          port,
          proc,
          logs,
          stop: async () => {
            proc.kill('SIGTERM');
            await new Promise((r) => setTimeout(r, 200));
            if (proc.exitCode === null) proc.kill('SIGKILL');
          },
        };
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill('SIGKILL');
  throw new Error(`Target failed health check at ${baseUrl}${opts.health} within timeout.\n${logs.join('')}`);
}
