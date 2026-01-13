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

    // Check if already running
    if (runningProcesses.has(appId)) {
      const { port } = runningProcesses.get(appId)!;
      return NextResponse.json({ url: `http://localhost:${port}` });
    }

    // Create temp directory
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kloner-app-'));

    // Write files
    for (const [filePath, fileData] of Object.entries(files)) {
      const fullPath = path.join(tempDir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, fileData.content);
    }

    // Find available port
    const port = await findAvailablePort(3001);
    console.log('Using port:', port);

    // Install dependencies
    console.log('Installing dependencies...');
    await runCommand('npm', ['install'], tempDir);
    console.log('Dependencies installed');

    // Start dev server (HTTP to simplify cookie/site handling in dev)
    console.log('Starting dev server...');
    const devProcess = spawn('npm', ['run', 'dev', '--', '--port', port.toString()], {
      cwd: tempDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    devProcess.stdout.on('data', (data) => console.log('Dev stdout:', data.toString()));
    devProcess.stderr.on('data', (data) => console.log('Dev stderr:', data.toString()));

    runningProcesses.set(appId, { process: devProcess, port, tempDir });

    // Wait for server to be ready
    const maxAttempts = 30;
    const checkInterval = 500;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const upstream = await fetch(`http://localhost:${port}`, { method: 'HEAD' });
        const ok = upstream.ok || upstream.status === 200;
        if (ok) break;
      } catch (error) {
        // Ignore errors, server not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new Error('Server failed to start');
    }

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
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(startPort + Math.floor(Math.random() * 1000)));
  });
}