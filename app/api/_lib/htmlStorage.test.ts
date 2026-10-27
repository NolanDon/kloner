const mockDownload = jest.fn();
jest.mock('firebase-admin', () => ({ __esModule: true, default: { apps: [{}], storage: () => ({ bucket: () => ({ file: (path: string) => ({ download: () => mockDownload(path) }) }) }) } }));
import { hydrateAppBuilderFiles } from './htmlStorage';

test('hydrates all stored source files with bounded parallel reads and no stale cross-load cache', async () => {
 let active=0, peak=0;
 mockDownload.mockImplementation(async (path: string) => { active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return [Buffer.from(`source:${path}`)]; });
 const files=Object.fromEntries(Array.from({length:24},(_,i)=>[`public/page-${i}.html`,{storagePath:`source-${i}`,lastModified:123}]));
 const manifest={files:Object.entries(files).map(([path,value])=>({path,...value,inline:false}))};
 const result=await hydrateAppBuilderFiles({files,fileManifest:manifest});
 expect(Object.keys(result)).toHaveLength(24);
 expect(result['public/page-23.html'].content).toBe('source:source-23');
 expect(peak).toBeGreaterThan(1);expect(peak).toBeLessThanOrEqual(8);
 expect(mockDownload).toHaveBeenCalledTimes(24);
 mockDownload.mockResolvedValue([Buffer.from('updated after restore')]);
 const refreshed=await hydrateAppBuilderFiles({files});
 expect(refreshed['public/page-0.html'].content).toBe('updated after restore');
 expect(mockDownload).toHaveBeenCalledTimes(48);
});

test('keeps authoritative inline source and does not download its manifest fallback', async () => {
 mockDownload.mockClear();
 const result=await hydrateAppBuilderFiles({files:{'index.html':{content:'<h1>Keep my edit</h1>',lastModified:1}},fileManifest:{files:[{path:'index.html',inline:true,storagePath:'old-source'}]}});
 expect(result['index.html'].content).toBe('<h1>Keep my edit</h1>');expect(mockDownload).not.toHaveBeenCalled();
});
