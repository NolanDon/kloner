// app/api/webcontainer/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { spawn, type ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { getProcessRegistry } from '../_lib/processRegistry';
import { requireSessionAndMaybeCsrf } from '../_lib/route-guard';
import { assertAppBuilderScope } from '../_lib/appBuilderScope';

const runningProcesses = getProcessRegistry();

type SetupRecord = {
  process: ChildProcess;
  tempDir: string;
};

// Tracks an in-flight install/build command for an appId so it can be cancelled.
const setupProcesses = new Map<string, SetupRecord>();

// Cancellation flag for an appId (best-effort; in-memory).
const cancelledApps = new Set<string>();

// Prevent concurrent starts for the same appId (dev only; in-memory).
const startLocks = new Map<string, Promise<{ url: string }>>();

export async function POST(request: NextRequest) {
  const internal = request.headers.get('x-kloner-internal') || '';
  const internalSecret = process.env.INTERNAL_API_SECRET || '';
  const isInternal = Boolean(internalSecret) && internal === internalSecret;

  if (!isInternal) {
    return requireSessionAndMaybeCsrf(
      request,
      async ({ uid, req: authedReq }) => {
        const body = await request.json();
        const appId = String(body?.appId || '');
        assertAppBuilderScope(authedReq, uid, appId);
        return handleWebcontainerPost(body);
      },
      { csrf: true, methods: ['POST'] }
    );
  }

  try {
    const body = await request.json();
    return await handleWebcontainerPost(body);
  } catch (error) {
    console.error('WebContainer API error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to start app';
    return NextResponse.json({ error: 'Failed to start app', logs: msg }, { status: 500 });
  }
}

async function handleWebcontainerPost(body: any) {
  try {
    const { appId, files, mode } = body || {};
    if (!appId || typeof appId !== 'string' || !files || typeof files !== 'object') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    // A new start/build request clears any prior cancellation.
    cancelledApps.delete(appId);

    // Basic payload limits to reduce abuse.
    const paths = Object.keys(files);
    if (paths.length > 300) {
      return NextResponse.json({ error: 'Too many files' }, { status: 400 });
    }

    let totalBytes = 0;
    for (const p of paths) {
      const content = (files as any)[p]?.content;
      if (typeof content !== 'string') {
        return NextResponse.json({ error: 'Invalid file content' }, { status: 400 });
      }
      totalBytes += Buffer.byteLength(content, 'utf8');
      if (totalBytes > 5_000_000) {
        return NextResponse.json({ error: 'Files too large' }, { status: 400 });
      }
    }

    console.error('[WebContainer POST] Received request for appId:', appId);
    console.error('[WebContainer POST] Files count:', Object.keys(files || {}).length);

    const runMode: 'dev' | 'build' = mode === 'build' ? 'build' : 'dev';

    // If dev server already running and we just need the URL, return quickly.
    if (runMode === 'dev' && runningProcesses.has(appId)) {
      const { port } = runningProcesses.get(appId)!;
      console.error('[WebContainer POST] App already running on port:', port);
      return NextResponse.json({ url: `http://localhost:${port}` });
    }

    // If a start is already in progress for this appId, await it.
    if (runMode === 'dev' && startLocks.has(appId)) {
      console.error('[WebContainer POST] Start already in progress for appId:', appId);
      try {
        const result = await startLocks.get(appId)!;
        return NextResponse.json(result);
      } catch (e) {
        // If the in-flight start failed, fall through and try again.
        startLocks.delete(appId);
      }
    }

    // If build mode and a process exists, reuse its tempDir to avoid re-installing into a new folder.
    let tempDir: string | null = null;
    let createdTempDir = false;
    if (runMode === 'build' && runningProcesses.has(appId)) {
      tempDir = runningProcesses.get(appId)!.tempDir;
      console.error('[WebContainer POST] Reusing existing tempDir for build:', tempDir);
    }

    const ensureTempDir = async (): Promise<string> => {
      if (tempDir) return tempDir;
      createdTempDir = true;
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kloner-app-'));
      console.error('[WebContainer POST] Created temp directory:', tempDir);
      return tempDir;
    };

    const writeFilesAndInstall = async (dir: string) => {
      // Create necessary directories for npm
      await fs.mkdir(path.join(dir, '.npm'), { recursive: true });
      await fs.mkdir(path.join(dir, 'tmp'), { recursive: true });

      // Write files
      for (const [filePath, fileData] of Object.entries(files)) {
        if (cancelledApps.has(appId)) throw new Error('Cancelled');
        const fullPath = path.join(dir, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, (fileData as { content: string }).content);
      }
      console.error('[WebContainer POST] Files written successfully');

      if (cancelledApps.has(appId)) throw new Error('Cancelled');

      // Install dependencies
      console.error('[WebContainer POST] Installing dependencies...');
      await runCommandCancelable('npm', ['install'], dir, appId, dir);
      console.error('[WebContainer POST] Dependencies installed');
    };

    if (runMode === 'build') {
      const dir = await ensureTempDir();
      await writeFilesAndInstall(dir);

      if (cancelledApps.has(appId)) throw new Error('Cancelled');

      console.error('[WebContainer POST] Running build...');
      const build = await runCommandCaptureCancelable('npm', ['run', 'build'], dir, 180_000, appId, dir);
      const logs = [build.stdout, build.stderr].filter(Boolean).join('\n');

      // If we created a temp dir just for build, clean it up.
      if (createdTempDir && dir) {
        try { await fs.rm(dir, { recursive: true, force: true }); } catch {}
      }

      return NextResponse.json({
        ok: build.code === 0,
        exitCode: build.code,
        logs: logs.slice(-60_000),
      });
    }

    // DEV mode: lock the start so we don't spawn multiple dev servers.
    const startPromise = (async (): Promise<{ url: string }> => {
      // Another request may have started it while we were waiting.
      if (runningProcesses.has(appId)) {
        const { port } = runningProcesses.get(appId)!;
        return { url: `http://localhost:${port}` };
      }

      if (cancelledApps.has(appId)) throw new Error('Cancelled');

      const dir = await ensureTempDir();
      await writeFilesAndInstall(dir);

      if (cancelledApps.has(appId)) throw new Error('Cancelled');

      const port = await findAvailablePort(3001);
      console.error('[WebContainer POST] Using port:', port);

      console.error('[WebContainer POST] Starting dev server...');
      const devProcess = spawn('npm', ['run', 'dev', '--', '--port', port.toString()], {
        cwd: dir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HOME: dir,
          npm_config_cache: path.join(dir, '.npm'),
          npm_config_tmp: path.join(dir, 'tmp'),
          npm_config_userconfig: path.join(dir, '.npmrc'),
        },
      });

      devProcess.stdout.on('data', (data) => console.error('[Dev stdout]:', data.toString()));
      devProcess.stderr.on('data', (data) => console.error('[Dev stderr]:', data.toString()));

      console.error('[WebContainer POST] Registering process for appId:', appId, 'on port:', port);
      runningProcesses.set(appId, { process: devProcess, port, tempDir: dir });

      // Wait for server to be ready
      const maxAttempts = 30;
      const checkInterval = 500;
      let attempts = 0;

      console.error('[WebContainer POST] Waiting for server to be ready...');
      while (attempts < maxAttempts) {
        if (cancelledApps.has(appId)) throw new Error('Cancelled');
        try {
          const upstream = await fetch(`http://localhost:${port}`, { method: 'HEAD' });
          const ok = upstream.ok || upstream.status === 200;
          if (ok) {
            console.error('[WebContainer POST] Server is ready after', attempts + 1, 'attempts');
            break;
          }
        } catch {
          // Ignore errors, server not ready yet
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        attempts++;
      }

      if (attempts >= maxAttempts) {
        console.error('[WebContainer POST] Server failed to start after', maxAttempts, 'attempts');
        throw new Error('Server failed to start');
      }

      console.error('[WebContainer POST] Returning success response for appId:', appId);
      return { url: `http://localhost:${port}` };
    })();

    startLocks.set(appId, startPromise.finally(() => startLocks.delete(appId)));
    const result = await startLocks.get(appId)!;
    return NextResponse.json(result);
  } catch (error) {
    console.error('WebContainer API error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to start app';
    return NextResponse.json({ error: 'Failed to start app', logs: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const internal = request.headers.get('x-kloner-internal') || '';
  const internalSecret = process.env.INTERNAL_API_SECRET || '';
  const isInternal = Boolean(internalSecret) && internal === internalSecret;

  if (!isInternal) {
    return requireSessionAndMaybeCsrf(
      request,
      async ({ uid, req: authedReq }) => {
        const { appId } = await request.json();
        assertAppBuilderScope(authedReq, uid, String(appId || ''));
        return handleWebcontainerDelete(String(appId || ''));
      },
      { csrf: true, methods: ['DELETE'] }
    );
  }

  try {
    const { appId } = await request.json();
    return await handleWebcontainerDelete(String(appId || ''));
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json({ error: 'Failed to cleanup' }, { status: 500 });
  }
}

async function handleWebcontainerDelete(appId: string) {
  try {
    // Mark cancelled so any in-flight build/install can abort.
    cancelledApps.add(appId);

    // Kill any in-flight setup process (npm install / npm run build).
    const setup = setupProcesses.get(appId);
    if (setup) {
      try {
        killProcessTree(setup.process);
      } catch {}
      setupProcesses.delete(appId);
      // Best-effort cleanup: if no dev server is running, remove temp dir.
      if (!runningProcesses.has(appId)) {
        try { await fs.rm(setup.tempDir, { recursive: true, force: true }); } catch {}
      }
    }

    if (runningProcesses.has(appId)) {
      const { process, tempDir } = runningProcesses.get(appId)!;
      try { killProcessTree(process); } catch {}
      try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
      runningProcesses.delete(appId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json({ error: 'Failed to cleanup' }, { status: 500 });
  }
}

function killProcessTree(proc: ChildProcess) {
  if (!proc.pid) {
    try { proc.kill('SIGTERM'); } catch {}
    return;
  }

  // Prefer killing the process group on POSIX.
  try {
    process.kill(-proc.pid, 'SIGTERM');
    return;
  } catch {
    // fall back
  }

  try { proc.kill('SIGTERM'); } catch {}
}

async function runCommandCancelable(
  command: string,
  args: string[],
  cwd: string,
  appId: string,
  tempDir: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: {
        ...process.env,
        HOME: tempDir,
        npm_config_cache: path.join(tempDir, '.npm'),
        npm_config_tmp: path.join(tempDir, 'tmp'),
        npm_config_userconfig: path.join(tempDir, '.npmrc'),
      },
    });

    setupProcesses.set(appId, { process: proc, tempDir });

    proc.stdout?.on('data', (d) => console.error(`[Setup stdout ${appId}]:`, d.toString()));
    proc.stderr?.on('data', (d) => console.error(`[Setup stderr ${appId}]:`, d.toString()));

    proc.on('close', (code) => {
      const current = setupProcesses.get(appId);
      if (current?.process === proc) setupProcesses.delete(appId);
      if (cancelledApps.has(appId)) return reject(new Error('Cancelled'));
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${command} ${args.join(' ')}`));
    });

    proc.on('error', (err) => {
      const current = setupProcesses.get(appId);
      if (current?.process === proc) setupProcesses.delete(appId);
      if (cancelledApps.has(appId)) return reject(new Error('Cancelled'));
      reject(err);
    });
  });
}

async function runCommandCaptureCancelable(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  appId: string,
  tempDir: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { 
      cwd, 
      stdio: ['ignore', 'pipe', 'pipe'], 
      detached: true,
      env: {
        ...process.env,
        HOME: tempDir,
        npm_config_cache: path.join(tempDir, '.npm'),
        npm_config_tmp: path.join(tempDir, 'tmp'),
        npm_config_userconfig: path.join(tempDir, '.npmrc'),
      },
    });
    let stdout = '';
    let stderr = '';

    setupProcesses.set(appId, { process: proc, tempDir });

    const killTimer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
    }, timeoutMs);

    proc.stdout?.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > 120_000) stdout = stdout.slice(-120_000);
    });
    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 120_000) stderr = stderr.slice(-120_000);
    });

    proc.on('close', (code) => {
      clearTimeout(killTimer);
      const current = setupProcesses.get(appId);
      if (current?.process === proc) setupProcesses.delete(appId);
      resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr });
    });

    proc.on('error', () => {
      clearTimeout(killTimer);
      const current = setupProcesses.get(appId);
      if (current?.process === proc) setupProcesses.delete(appId);
      resolve({ code: 1, stdout, stderr: stderr || 'Failed to start process' });
    });
  });
}

async function findAvailablePort(startPort: number): Promise<number> {
  const net = await import('net');
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const address = server.address();
      const port = address && typeof address !== 'string' ? address.port : startPort;
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(startPort + Math.floor(Math.random() * 1000)));
  });
}