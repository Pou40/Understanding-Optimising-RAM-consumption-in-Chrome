// content-script.js
let hasUnsaved = false;
window.addEventListener('beforeunload', e => {
  // if any <form> is dirty, you might set hasUnsaved = true;
  hasUnsaved = true;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'checkUnsaved') {
    sendResponse({ hasUnsaved });
  }
});