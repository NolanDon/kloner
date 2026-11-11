import { instrumentLocalPreview, removeLocalPreviewObserver } from './localPreviewRuntime';
import { PREVIEW_RUNTIME_OBSERVER_SOURCE } from './previewRuntimeObserverSource';

describe('local editor runtime observation', () => {
  const html = '<!doctype html><html><head><script src="/bootstrap.js"></script></head><body><h1>Content</h1><script type="application/json" id="__NUXT_DATA__">{"cookieConsent":null}</script></body></html>';
  it('installs before application scripts without altering site scripts, data, or doctype', () => {
    const instrumented = instrumentLocalPreview(html, 'https://kloner.app', 'project-1');
    expect(instrumented.startsWith('<!doctype html>')).toBe(true);
    expect(instrumented.indexOf('id="kloner-local-runtime"')).toBeLessThan(instrumented.indexOf('src="/bootstrap.js"'));
    expect(removeLocalPreviewObserver(instrumented)).toBe(html);
    expect(removeLocalPreviewObserver(instrumentLocalPreview(instrumented, 'https://kloner.app', 'project-1'))).toBe(html);
    expect(() => new Function(`return (${PREVIEW_RUNTIME_OBSERVER_SOURCE})`)).not.toThrow();
  });
  it('escapes page identifiers and resolves the local parent origin at runtime for stable server rendering', () => {
    expect(instrumentLocalPreview(html, '', 'project')).toContain('config.parentOrigin=window.parent.location.origin');
    expect(removeLocalPreviewObserver(instrumentLocalPreview(html, '', 'project'))).toBe(html);
    const instrumented = instrumentLocalPreview(html, 'https://kloner.app', '</script><script>untrusted()</script>');
    expect(instrumented).not.toContain('"app_id":"</script>');
    expect(removeLocalPreviewObserver(instrumented)).toBe(html);
  });
});
