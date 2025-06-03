// Browser environment shims for Node.js globals
// This helps libraries designed for Node.js run in a browser environment

// Define global as window to support Node.js modules
window.global = window;

// Define process.env for libraries that expect it
window.process = window.process || {};
window.process.env = window.process.env || {};
window.process.browser = true;
window.process.version = '';
window.process.versions = { node: '' };

// Define Buffer if needed by dependencies
if (typeof window.Buffer === 'undefined') {
  window.Buffer = {
    isBuffer: function() { return false; }
  };
}

// Console polyfill if needed
if (typeof window.console === 'undefined') {
  window.console = {
    log: function() {},
    error: function() {},
    warn: function() {},
    info: function() {},
    debug: function() {}
  };
}

// Make commonjs utilities available
window.module = window.module || { exports: {} };
window.exports = window.module.exports;
window.require = function() { 
  console.warn('require() is not available in browser environment');
  return {};
};

console.log('Browser environment shims loaded successfully');
