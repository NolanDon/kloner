import { PREVIEW_RUNTIME_OBSERVER_SOURCE } from './previewRuntimeObserverSource';

export function removeLocalPreviewObserver(html: string): string {
  return html.replace(/<script\b[^>]*\bid=["']kloner-local-runtime["'][^>]*>[\s\S]*?<\/script>/gi, '');
}

export function instrumentLocalPreview(html: string, parentOrigin: string, pageId: string): string {
  if (!html) return html;
  const config = JSON.stringify({ parentOrigin, correlation: { app_id: pageId, preview_code: 'local-editor' } }).replace(/</g, '\\u003c');
  const script = `<script id="kloner-local-runtime" data-kloner-ui="runtime-observer">;(function(){var config=${config};try{if(!config.parentOrigin)config.parentOrigin=window.parent.location.origin;}catch(_){}(${PREVIEW_RUNTIME_OBSERVER_SOURCE})(config);})();</script>`;
  const clean = removeLocalPreviewObserver(html);
  if (/<head\b[^>]*>/i.test(clean)) return clean.replace(/<head\b[^>]*>/i, head => `${head}${script}`);
  if (/<body\b[^>]*>/i.test(clean)) return clean.replace(/<body\b[^>]*>/i, body => `${body}${script}`);
  if (/<!doctype[^>]*>/i.test(clean)) return clean.replace(/<!doctype[^>]*>/i, doctype => `${doctype}${script}`);
  return script + clean;
}
