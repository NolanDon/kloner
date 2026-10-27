// Also shipped in the backend preview proxy. Keep both runtime assets identical.
(function () {
  if (window.__klonerPaletteBridge) return;
  window.__klonerPaletteBridge = true;
  var styleId = 'kloner-color-preview';
  function rgb(value) {
    var match = String(value).match(/rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/);
    if (!match || (match[4] !== undefined && Number(match[4]) < .08)) return null;
    var channels = [Number(match[1]), Number(match[2]), Number(match[3])];
    return { light: (channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722) / 255, chroma: (Math.max.apply(null, channels) - Math.min.apply(null, channels)) / 255 };
  }
  function selector(element) {
    if (element === document.documentElement) return 'html';
    if (element === document.body) return 'body';
    if (element.id && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) return '#' + CSS.escape(element.id);
    var parts = [], current = element;
    while (current && current !== document.body && parts.length < 10) {
      var tag = current.tagName.toLowerCase(), index = 1, sibling = current.previousElementSibling;
      while (sibling) { if (sibling.tagName === current.tagName) index++; sibling = sibling.previousElementSibling; }
      parts.unshift(tag + ':nth-of-type(' + index + ')'); current = current.parentElement;
    }
    return 'body > ' + parts.join(' > ');
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || !event.data || !/^kloner:palette-(preview|reset)$/.test(event.data.type)) return;
    var data = event.data, old = document.getElementById(styleId); if (old) old.remove();
    if (data.type === 'kloner:palette-reset') return;
    var tokens = data.tokens || {}, names = ['background','surface','text','muted','primary','primaryText','accent','border'];
    if (!names.every(function (key) { return /^#[0-9a-f]{6}$/i.test(tokens[key]); })) return;
    var changes = [], rootText = rgb(getComputedStyle(document.body).color), rootBg = rgb(getComputedStyle(document.body).backgroundColor);
    var elements = [document.documentElement, document.body].concat(Array.from(document.body.querySelectorAll('*')).filter(function (el) { return !/^(SCRIPT|STYLE|LINK|META|IMG|VIDEO|CANVAS|SVG|PATH|USE|IFRAME)$/.test(el.tagName) && !el.closest('svg'); }).slice(0, 1800));
    function add(sel, property, value) { if (changes.length < 1500) changes.push({ selector: sel, property: property, value: value }); }
    elements.forEach(function (element) {
      var computed = getComputedStyle(element); if (computed.display === 'none' || computed.visibility === 'hidden') return;
      var sel = selector(element), bg = rgb(computed.backgroundColor), text = rgb(computed.color);
      var button = element.matches('button, input[type=submit], [role=button]') || (element.tagName === 'A' && bg && bg.chroma > .12);
      var strongButton = button && bg && (bg.chroma > .12 || rootBg && Math.abs(bg.light - rootBg.light) > .3);
      var parentButton = element.closest('button,[role=button],a');
      var parentBg = parentButton && rgb(getComputedStyle(parentButton).backgroundColor);
      var onPrimary = parentBg && (parentBg.chroma > .12 || rootBg && Math.abs(parentBg.light - rootBg.light) > .3);
      if (element === document.body || element === document.documentElement) add(sel, 'background-color', tokens.background);
      else if (bg) add(sel, 'background-color', strongButton ? tokens.primary : bg.chroma > .12 ? tokens.surface : (parseFloat(computed.borderRadius) > 6 || !rootBg || Math.abs(bg.light - rootBg.light) > .08 ? tokens.surface : tokens.background));
      if (text && element.textContent.trim()) add(sel, 'color', strongButton || onPrimary ? tokens.primaryText : text.chroma > .16 ? tokens.accent : rootText && Math.abs(text.light - rootText.light) > .19 ? tokens.muted : tokens.text);
      if (/gradient\(/.test(computed.backgroundImage)) add(sel, 'background-image', 'linear-gradient(135deg, ' + tokens.primary + ', ' + tokens.accent + ')');
      if (parseFloat(computed.borderTopWidth) > 0 && rgb(computed.borderTopColor)) add(sel, 'border-color', tokens.border);
    });
    var style = document.createElement('style'); style.id = styleId; style.setAttribute('data-kloner-ui', 'palette-preview');
    style.textContent = changes.map(function (change) { return change.selector + '{' + change.property + ':' + change.value + '!important}'; }).join('\n');
    document.head.appendChild(style);
    window.parent.postMessage({ type: 'kloner:palette-result', requestId: data.requestId, changes: changes, count: changes.length }, event.origin);
  });
})();
