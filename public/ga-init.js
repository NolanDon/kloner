(function () {
  // Google Analytics init (externalized to avoid CSP inline-script reports)
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  gtag("js", new Date());
  gtag("config", "G-FVKJJK0379", {
    page_path: window.location.pathname,
  });
})();
