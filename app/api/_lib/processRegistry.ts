// app/api/_lib/processRegistry.ts
type ProcInfo = { process: any; port: number; tempDir: string };

declare global {
  // eslint-disable-next-line no-var
  var __klonerProcessRegistry: Map<string, ProcInfo> | undefined;
}

export function getProcessRegistry(): Map<string, ProcInfo> {
  if (!global.__klonerProcessRegistry) {
    global.__klonerProcessRegistry = new Map<string, ProcInfo>();
  }
  return global.__klonerProcessRegistry;
}

export type { ProcInfo };
