// app/api/webcontainer/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { getProcessRegistry } from '../_lib/processRegistry';

const runningProcesses = getProcessRegistry();

export async function POST(request: NextRequest) {
  try {
    const { appId, files } = await request.json();
    console.error('[WebContainer POST] Received request for appId:', appId);
    console.error('[WebContainer POST] Files count:', Object.keys(files || {}).length);

    // Check if already running
    if (runningProcesses.has(appId)) {
      const { port } = runningProcesses.get(appId)!;
      console.error('[WebContainer POST] App already running on port:', port);
      return NextResponse.json({ url: `http://localhost:${port}` });
    }

    // Create temp directory
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kloner-app-'));
    console.error('[WebContainer POST] Created temp directory:', tempDir);

    // Write files
    for (const [filePath, fileData] of Object.entries(files)) {
      const fullPath = path.join(tempDir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, (fileData as { content: string }).content);
    }
    console.error('[WebContainer POST] Files written successfully');

    // Find available port
    const port = await findAvailablePort(3001);
    console.error('[WebContainer POST] Using port:', port);

    // Install dependencies
    console.error('[WebContainer POST] Installing dependencies...');
    await runCommand('npm', ['install'], tempDir);
    console.error('[WebContainer POST] Dependencies installed');

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
    return NextResponse.json({ error: 'Failed to start app' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { appId } = await request.json();

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