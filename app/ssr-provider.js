// This file can be imported to silence hydration errors in Next.js if needed.
// Usage: import './ssr-provider';
if (typeof window !== 'undefined') {
  // Patch console.error to silence hydration mismatch warnings
  const origError = console.error;
  console.error = function (...args) {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Text content does not match server-rendered HTML')
    ) {
      return;
    }
    origError.apply(console, args);
  };
}