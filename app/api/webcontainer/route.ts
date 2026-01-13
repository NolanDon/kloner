// app/api/webcontainer/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { getProcessRegistry } from '../_lib/processRegistry';
import { requireSessionAndMaybeCsrf } from '../_lib/route-guard';
import { assertAppBuilderScope } from '../_lib/appBuilderScope';

const runningProcesses = getProcessRegistry();

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

    // If build mode and a process exists, reuse its tempDir to avoid re-installing into a new folder.
    let tempDir: string | null = null;
    if (runMode === 'build' && runningProcesses.has(appId)) {
      tempDir = runningProcesses.get(appId)!.tempDir;
      console.error('[WebContainer POST] Reusing existing tempDir for build:', tempDir);
    }

    // Create temp directory if needed
    if (!tempDir) {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kloner-app-'));
      console.error('[WebContainer POST] Created temp directory:', tempDir);
    }

    // Write files
    for (const [filePath, fileData] of Object.entries(files)) {
      const fullPath = path.join(tempDir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, (fileData as { content: string }).content);
    }
    console.error('[WebContainer POST] Files written successfully');

    // Install dependencies (needed for both build + dev)
    console.error('[WebContainer POST] Installing dependencies...');
    await runCommand('npm', ['install'], tempDir);
    console.error('[WebContainer POST] Dependencies installed');

    if (runMode === 'build') {
      console.error('[WebContainer POST] Running build...');
      const build = await runCommandCapture('npm', ['run', 'build'], tempDir, 180_000);
      const logs = [build.stdout, build.stderr].filter(Boolean).join('\n');

      // If we created a temp dir just for build, clean it up.
      if (!runningProcesses.has(appId)) {
        try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
      }

      return NextResponse.json({
        ok: build.code === 0,
        exitCode: build.code,
        logs: logs.slice(-60_000),
      });
    }

    // Find available port
    const port = await findAvailablePort(3001);
    console.error('[WebContainer POST] Using port:', port);

    // Start dev server (HTTP to simplify cookie/site handling in dev)
    console.error('[WebContainer POST] Starting dev server...');
    const devProcess = spawn('npm', ['run', 'dev', '--', '--port', port.toString()], {
      cwd: tempDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    devProcess.stdout.on('data', (data) => console.error('[Dev stdout]:', data.toString()));
    devProcess.stderr.on('data', (data) => console.error('[Dev stderr]:', data.toString()));

    console.error('[WebContainer POST] Registering process for appId:', appId, 'on port:', port);
    runningProcesses.set(appId, { process: devProcess, port, tempDir });
    console.error('[WebContainer POST] Process registered. Registry size:', runningProcesses.size);
    console.error('[WebContainer POST] Registry keys:', Array.from(runningProcesses.keys()));

    // Wait for server to be ready
    const maxAttempts = 30;
    const checkInterval = 500;
    let attempts = 0;

    console.error('[WebContainer POST] Waiting for server to be ready...');
    while (attempts < maxAttempts) {
      try {
        const upstream = await fetch(`http://localhost:${port}`, { method: 'HEAD' });
        const ok = upstream.ok || upstream.status === 200;
        if (ok) {
          console.error('[WebContainer POST] Server is ready after', attempts + 1, 'attempts');
          break;
        }
      } catch (error) {
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
    return NextResponse.json({ url: `http://localhost:${port}` });
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
    if (runningProcesses.has(appId)) {
      const { process, tempDir } = runningProcesses.get(appId)!;
      try { process.kill(); } catch {}
      try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
      runningProcesses.delete(appId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Cleanup error:', error);
    return NextResponse.json({ error: 'Failed to cleanup' }, { status: 500 });
  }
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${command} ${args.join(' ')}`));
    });
    proc.on('error', reject);
  });
}

async function runCommandCapture(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

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
      resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr });
    });

    proc.on('error', () => {
      clearTimeout(killTimer);
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