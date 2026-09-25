const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const card = {
  querySelectorAll(selector) {
    assert.equal(selector, 'a[href*="/watch?"]');
    return [{ href: "https://www.youtube.com/watch?v=TADpQcPiFVM" }];
  }
};

const context = vm.createContext({
  URL,
  MutationObserver: class { observe() {} },
  setTimeout() {},
  clearTimeout() {},
  window: { addEventListener() {} },
  location: { hostname: "www.youtube.com", origin: "https://www.youtube.com" },
  document: {
    documentElement: {},
    querySelectorAll(selector) {
      return selector === "#related yt-lockup-view-model" ? [card] : [];
    }
  },
  chrome: { storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } } }
});

const source = fs.readFileSync(path.join(__dirname, "../extension/content.js"), "utf8");
vm.runInContext(source, context);
const items = vm.runInContext("collectItems()", context);

assert.equal(items.length, 1, "watch page should collect the new recommendation card");
assert.equal(items[0].videoId, "TADpQcPiFVM");
console.log("watch-page recommendation detected");
