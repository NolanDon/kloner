(function () {
  // Override createInitialRouterState globally before Next.js loads.
  // This file is referenced by the webcontainer proxy HTML rewriter.

  Object.defineProperty(window, "createInitialRouterState", {
    get: function () {
      return function (options) {
        try {
          if (!options) options = {};

          // Safe defaults for router state
          options.initialCanonicalUrl = options.initialCanonicalUrl || "/";
          options.initialTree =
            options.initialTree ||
            ["", {}, { children: ["page", {}, { children: ["", {}, {}] }] }];
          options.initialParallelRoutes = options.initialParallelRoutes || {};
          options.initialSeedData = options.initialSeedData || {};

          // Normalize canonical URL
          if (typeof options.initialCanonicalUrl === "string") {
            try {
              var url = new URL(options.initialCanonicalUrl, "http://localhost:3000");
              options.initialCanonicalUrl = url.pathname || "/";
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
})();
