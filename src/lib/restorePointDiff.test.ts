import { summarizeRestorePointDiff, buildRestorePointDiffPreview } from './restorePointDiff';
test('an unavailable after snapshot is not displayed as deletion of the whole HTML file', () => {
    const history = { paths: ['public/index.html'], before: { 'public/index.html': '<html><body>Moqup</body></html>' } };
    expect(summarizeRestorePointDiff(history)).toEqual([]);
    expect(buildRestorePointDiffPreview(history, 'public/index.html')).toBeNull();
});
test('a known rename compares the real before and after content', () => {
    const history = { before: { 'index.html': '<h1>Moqup</h1>' }, after: { 'index.html': '<h1>Greenleaf</h1>' } };
    expect(buildRestorePointDiffPreview(history, 'index.html')).toEqual({ before: '<h1>Moqup</h1>', after: '<h1>Greenleaf</h1>' });
    expect(summarizeRestorePointDiff(history)[0]).toMatchObject({ added: 1, removed: 1 });
});
test('explicit deletions remain distinguishable from missing history', () => {
    expect(buildRestorePointDiffPreview({ before: { 'a.js': 'old' }, after: { 'a.js': null } }, 'a.js')).toEqual({ before: 'old', after: '' });
});
test('a rename in minified HTML shows changed context rather than hundreds of kilobytes', () => {
    const prefix = '<html><head>' + 'x'.repeat(100000) + '</head><body><h1>';
    const suffix = '</h1>' + 'y'.repeat(100000) + '</body></html>';
    const preview = buildRestorePointDiffPreview({ before: { 'index.html': prefix + 'Moqup' + suffix }, after: { 'index.html': prefix + 'Greenleaf' + suffix } }, 'index.html');
    expect(preview?.before).toContain('Moqup');
    expect(preview?.after).toContain('Greenleaf');
    expect(preview!.after.length).toBeLessThan(4000);
});
