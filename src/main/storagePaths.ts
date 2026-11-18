import { existsSync, mkdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';

const configuredRoot = process.env.MULTI_AGENT_ROOT?.trim();
export const MULTI_AGENT_ROOT = configuredRoot && /^[Dd]:[\\/]/.test(configuredRoot)
  ? resolve(configuredRoot)
  : 'D:\\Multi-Agent';

export const RUNTIME_ROOT = join(MULTI_AGENT_ROOT, '_runtime');
export const PROJECTS_ROOT = MULTI_AGENT_ROOT;
export const DEFAULT_PROJECT_ROOT = join(MULTI_AGENT_ROOT, 'Project1');

/** Apply every Electron-controlled path before any config or window is created. */
export function configureDDriveStorage(): void {
  // Resolve Electron lazily so this module's path calculations remain usable
  // by node-based persistence tests without starting Electron.
  const { app } = require('electron') as typeof import('electron');
  const paths = {
    appData: join(RUNTIME_ROOT, 'appData'),
    userData: join(RUNTIME_ROOT, 'userData'),
    sessionData: join(RUNTIME_ROOT, 'sessionData'),
    logs: join(RUNTIME_ROOT, 'logs'),
    crashDumps: join(RUNTIME_ROOT, 'crashDumps'),
    temp: join(RUNTIME_ROOT, 'temp'),
    cache: join(RUNTIME_ROOT, 'chromium-cache')
  };
  for (const value of Object.values(paths)) mkdirSync(value, { recursive: true });

  app.setPath('appData', paths.appData);
  app.setPath('userData', paths.userData);
  app.setPath('sessionData', paths.sessionData);
  app.setPath('logs', paths.logs);
  app.setPath('crashDumps', paths.crashDumps);
  app.setPath('temp', paths.temp);
  app.commandLine.appendSwitch('disk-cache-dir', paths.cache);

  // Child processes launched by the app inherit these paths. This does not move
  // Windows system caches, but keeps our own temporary files on D:.
  process.env.MULTI_AGENT_ROOT = MULTI_AGENT_ROOT;
  process.env.TEMP = paths.temp;
  process.env.TMP = paths.temp;
  process.env.ELECTRON_CACHE = join(RUNTIME_ROOT, 'electron-cache');
  process.env.ELECTRON_GET_CACHE = join(RUNTIME_ROOT, 'electron-cache');
  process.env.ELECTRON_BUILDER_CACHE = join(RUNTIME_ROOT, 'electron-builder-cache');
  process.env.npm_config_cache = join(RUNTIME_ROOT, 'npm-cache');
  process.env.npm_config_tmp = paths.temp;
  process.env.TMPDIR = paths.temp;
  process.env.XDG_CACHE_HOME = join(RUNTIME_ROOT, 'xdg-cache');
  process.env.XDG_CONFIG_HOME = join(RUNTIME_ROOT, 'xdg-config');
}

export function ensureProjectLayout(projectRoot = DEFAULT_PROJECT_ROOT): string {
  const dirs = [
    projectRoot,
    join(projectRoot, 'WorkGroup'),
    join(projectRoot, 'WorkGroup', 'shared_context'),
    join(projectRoot, 'WorkGroup', 'artifacts'),
    join(projectRoot, 'WorkGroup', 'code'),
    join(projectRoot, 'WorkGroup', 'data'),
    join(projectRoot, 'WorkGroup', 'reports'),
    join(projectRoot, 'WorkGroup', 'approved_memory'),
    join(projectRoot, 'AgentChats'),
    join(projectRoot, 'tasks'),
    join(projectRoot, 'runs')
  ];
  for (const dir of dirs) {
    if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw new Error('项目目录不能是链接');
    mkdirSync(dir, { recursive: true });
  }
  return projectRoot;
}

export function isDDrivePath(value: string): boolean {
  return /^[Dd]:[\\/]/.test(resolve(value));
}

export function pathExists(value: string): boolean {
  return existsSync(value);
}
