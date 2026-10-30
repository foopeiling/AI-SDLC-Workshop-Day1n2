import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolveClose) => server.close(resolveClose));
    throw new Error('Could not allocate a Playwright port');
  }
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  return address.port;
}

const workspaceRoot = process.cwd();
const runId = randomUUID();
const port = await findAvailablePort();
const databasePath = join(tmpdir(), `todo-app-e2e-${runId}.db`);
const distDir = `.next-playwright-${runId}`;
const playwrightCli = join(workspaceRoot, 'node_modules', '@playwright', 'test', 'cli.js');
const environment = {
  ...process.env,
  DATABASE_PATH: databasePath,
  NEXT_DIST_DIR: distDir,
  PLAYWRIGHT_E2E: 'true',
  PLAYWRIGHT_E2E_PORT: String(port),
  PLAYWRIGHT_E2E_RUN_ID: runId,
};

let exitCode = 1;
try {
  exitCode = await new Promise((resolveExit, rejectExit) => {
    const child = spawn(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
      cwd: workspaceRoot,
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', rejectExit);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
} finally {
  await Promise.all([
    rm(databasePath, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
    rm(`${databasePath}-wal`, { force: true }),
    rm(resolve(workspaceRoot, distDir), { recursive: true, force: true }),
  ]);
}

process.exitCode = exitCode;