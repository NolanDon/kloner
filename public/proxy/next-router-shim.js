(function () {
  // Override createInitialRouterState globally before Next.js loads.
  // This file is referenced by the webcontainer proxy HTML rewriter.

  function normalizePath(path) {
    var value = String(path || "").trim();
    if (!value) return "/";
    if (value.length > 1 && value.endsWith("/")) {
      value = value.slice(0, -1);
    }
    return value || "/";
  }

  function deriveAppRouteFromLocation() {
    try {
      var pathname = normalizePath(window.location.pathname || "/");
      var parts = pathname.split("/").filter(Boolean);

      if (parts.length >= 2 && parts[0] === "preview") {
        return normalizePath("/" + parts.slice(2).join("/"));
      }

      if (parts.length >= 4 && parts[0] === "api" && parts[1] === "webcontainer" && parts[3] === "proxy") {
        return normalizePath("/" + parts.slice(4).join("/"));
      }

      return pathname;
    } catch (error) {
      return "/";
    }
  }

  function derivePreviewBasePath() {
    try {
      var pathname = normalizePath(window.location.pathname || "/");
      var parts = pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && parts[0] === "preview") {
        return "/" + parts.slice(0, 2).join("/");
      }
      return "/";
    } catch (error) {
      return "/";
    }
  }

  function navigateWithinPreview(pathname) {
    try {
      var route = normalizePath(pathname);
      var previewBase = derivePreviewBasePath();
      var nextUrl = route === "/" ? previewBase : normalizePath(previewBase + route);
      if (normalizePath(window.location.pathname || "/") === normalizePath(nextUrl)) {
        return;
      }
      window.history.pushState({}, "", nextUrl);
      broadcastRouteChange();
    } catch (error) {
      // ignore
    }
  }

  function broadcastRouteChange() {
    try {
      var route = deriveAppRouteFromLocation();
      var payload = {
        type: "kloner:preview-route",
        pathname: route,
        href: window.location.href,
      };

      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, "*");
      }
    } catch (error) {
      // ignore
    }
  }

  function wrapHistoryMethod(methodName) {
    var original = window.history[methodName];
    if (typeof original !== "function") return;

    window.history[methodName] = function () {
      var result = original.apply(this, arguments);
      broadcastRouteChange();
      return result;
    };
  }

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");

  window.addEventListener("popstate", broadcastRouteChange);
  window.addEventListener("hashchange", broadcastRouteChange);
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== "kloner:preview-navigate") return;
    if (typeof data.pathname !== "string") return;
    navigateWithinPreview(data.pathname);
  });

  Object.defineProperty(window, "createInitialRouterState", {
    get: function () {
      return function (options) {
        try {
          if (!options) options = {};

          // Safe defaults for router state
          options.initialCanonicalUrl = deriveAppRouteFromLocation();
          options.initialTree =
            options.initialTree ||
            ["", {}, { children: ["page", {}, { children: ["", {}, {}] }] }];
          options.initialParallelRoutes = options.initialParallelRoutes || {};
          options.initialSeedData = options.initialSeedData || {};

          // Normalize canonical URL
          if (typeof options.initialCanonicalUrl === "string") {
            try {
              var url = new URL(options.initialCanonicalUrl, "http://localhost:3000");
              options.initialCanonicalUrl = normalizePath(url.pathname || "/");
            } catch (e) {
              options.initialCanonicalUrl = "/";
            }
          }

          return {
            tree: options.initialTree,
            canonicalUrl: options.initialCanonicalUrl,
            parallelRoutes: options.initialParallelRoutes,
            seedData: options.initialSeedData,
          };
        } catch (error) {
          return {
            tree: ["", {}, { children: ["page", {}, { children: ["", {}, {}] }] }],
            canonicalUrl: "/",
            parallelRoutes: {},
            seedData: {},
          };
        }
      };
    },
    set: function (_value) {
      // Intentionally ignore assignments; our getter provides the implementation.
    },
    configurable: true,
  });

  broadcastRouteChange();
})();
