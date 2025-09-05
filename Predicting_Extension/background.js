// Discard Extension
// --------------------------
// background.js
// --------------------------
// Which model‐predicted events should trigger a discard
const DISCARD_PREDICTIONS = new Set([
  'tabRemoved',    // user likely to close soon
  'windowRemoved'  // entire window is about to go away
]);

// --------------------------
// CONFIG & STATE
// --------------------------

const MAX_HISTORY = 20;
const PREDICT_ALARM = 'mlPredictAlarm';
// Map<tabId, Array<{ type, payload, ts }>>
const tabHistories = new Map();

// On startup/reload: rehydrate from storage
(async function rehydrateHistories() {
  const data = await chrome.storage.local.get('tabHistories');
  if (data.tabHistories) {
    for (const [tabId, history] of Object.entries(data.tabHistories)) {
      // keys in storage are strings
      tabHistories.set(Number(tabId), history);
    }
  }
})();

// total number of open tabs right now
let totalTabs = 0;

// for tracking current active tab duration
let currentTabId = null;
let tabStartTime = null;

// --------------------------
// UTILITIES
// --------------------------


// get current timestamp
function now() {
  return Date.now();
}

// record one action into a tab’s history queue
function recordTabAction(tabId, type, payload = {}) {
  // In‐memory update
  let history = tabHistories.get(tabId) || [];
  history.push({ type, payload, ts: Date.now() });
  if (history.length > MAX_HISTORY) history.shift();
  tabHistories.set(tabId, history);

  // Persist the entire map
  // Convert Map to plain object: { [tabId]: historyArray, … }
  const plain = Object.fromEntries(tabHistories);
  chrome.storage.local.set({ tabHistories: plain });
}

// getters for UI queries
function getTabHistory(tabId) {
  return tabHistories.get(tabId) || [];
}
function getTotalTabCount() {
  return totalTabs;
}

// --------------------------
// INITIALIZE TAB COUNT
// --------------------------

function initTabCount() {
  chrome.tabs.query({}, tabs => {
    totalTabs = tabs.length;
    console.log('Initialized totalTabs =', totalTabs);
  });
}

chrome.runtime.onStartup.addListener(initTabCount);
initTabCount(); // also run when the service worker starts

// --------------------------
// TAB & WINDOW LOGGING
// --------------------------

// Tab activation → measure previous tab duration + log switch
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (currentTabId !== null && tabStartTime !== null) {
    const duration = now() - tabStartTime;
    recordTabAction(currentTabId, 'tabDuration', { duration });
  }

  recordTabAction(tabId, 'tabSwitched', { from: currentTabId });
  currentTabId = tabId;
  tabStartTime = now();
});


// New tab created
chrome.tabs.onCreated.addListener(tab => {
  totalTabs++;
  recordTabAction(tab.id, 'tabCreated', { url: tab.url, windowId: tab.windowId });

});

// Tab URL/title updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    recordTabAction(tabId, 'tabUpdated', { newUrl: changeInfo.url });

  }
  if (changeInfo.title) {
    recordTabAction(tabId, 'tabTitleChanged', { newTitle: changeInfo.title });

  }
});

// Tab closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  totalTabs = Math.max(0, totalTabs - 1);
  recordTabAction(tabId, 'tabRemoved', {
    windowId: removeInfo.windowId,
    isWindowClosing: removeInfo.isWindowClosing
  });
  tabHistories.delete(tabId);

});

// Other tab events
chrome.tabs.onHighlighted.addListener(info => {
  info.tabIds.forEach(id =>
    recordTabAction(id, 'tabHighlighted', { windowId: info.windowId })
  );

});
chrome.tabs.onDetached.addListener((tabId, info) => {
  recordTabAction(tabId, 'tabDetached', { oldWindowId: info.oldWindowId });

});
chrome.tabs.onAttached.addListener((tabId, info) => {
  recordTabAction(tabId, 'tabAttached', { newWindowId: info.newWindowId });

});
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  recordTabAction(removedTabId, 'replaced', { addedTabId });
  recordTabAction(addedTabId, 'replacedBy', { removedTabId });
 
});

// --------------------------
// AUTOMATIC DISCARD LISTENER
// --------------------------

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Chrome has unloaded this tab from memory
  if (changeInfo.discarded === true) {
    recordTabAction(tabId, 'tabAutoDiscarded', {});
  }
  // Chrome has reloaded this tab (either because it was activated, or memory
  // was sufficient again)
  else if (changeInfo.discarded === false && tab.discarded === false) {
    recordTabAction(tabId, 'tabAutoReloaded', {});
  }
});


// --------------------------
// DISCARD ELIGIBILITY CHECKS
// --------------------------

/**
 * Check each pre-discard condition; returns { ok: boolean, reasons: string[] }.
 */
async function shouldDiscard(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const reasons = [];

  // 1) don’t discard pinned tabs
  if (tab.pinned) reasons.push('Tab is pinned');

  // 2) don’t discard if audible
  if (tab.audible) reasons.push('Tab is playing audio');

  // 3) don’t discard if recently active (within last 10 minutes)
  const hist = tabHistories.get(tabId) || [];
  const lastSwitch = [...hist].reverse().find(e => e.type === 'tabSwitched');
  if (lastSwitch && (Date.now() - lastSwitch.ts) < 600000) {
    reasons.push('Tab was recently active');
  }

  // 4) don’t discard if whitelisted origin
  try {
    const origin = new URL(tab.url).origin;
    const whitelist = ['https://mail.google.com'];
    if (whitelist.includes(origin)) reasons.push('Whitelisted origin');
  } catch (e) {
    // ignore URL parse errors
  }
  // 'https://docs.google.com'

  // 5) don’t discard if it has unsubmitted form data (via content-script)
  try {
    const { hasUnsaved } = await chrome.tabs.sendMessage(
      tabId,
      { action: 'checkUnsaved' }
    );
    if (hasUnsaved) reasons.push('Unsaved form data');
  } catch (e) {
    // no response or error -> assume no unsaved data
  }

  // You can add more checks here...

  const ok = reasons.length === 0;
  recordTabAction(tabId, ok ? 'discardAllowed' : 'discardSkipped', { reasons });
  return { ok, reasons };
}


// --------------------------
// Discarding Function
// --------------------------
async function getTabMemoryStats(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const memoryInfo = performance.memory ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
        } : null;

        return {
          memoryInfo,
          url: window.location.href,
          title: document.title,
          timestamp: Date.now()
        };
      }
    });
    
    return results[0]?.result || null;
  } catch (error) {
    console.warn("Could not get memory stats for tab", tabId, error);
    return null;
  }
}

async function discardWithLog(tabId, source) {
  // 1) collect metrics
  const stats = await getTabMemoryStats(tabId);

  // 2) send to your activity-logger server
  fetch('http://localhost:12005/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type:   'tabAboutToBeDiscarded',
      tabId,
      source,
      timestamp: Date.now(),
      stats
    })
  }).catch(console.error);

  // 3) now actually discard
  chrome.tabs.discard(tabId);
}



// --------------------------
// MESSAGE HANDLER FOR POPUP
// --------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'setPredictInterval') {
    // persist choice
    chrome.storage.local.set({ predictInterval: msg.minutes });

    // clear any existing alarm
    chrome.alarms.clear(PREDICT_ALARM, () => {
      if (msg.minutes !== 'off') {
        chrome.alarms.create(PREDICT_ALARM, {
          periodInMinutes: Number(msg.minutes),
          delayInMinutes: Number(msg.minutes)
        });
      }
    });
  }
  if (msg.action === 'getTotalTabs') {
    sendResponse({ totalTabs: getTotalTabCount() });
  } else if (msg.action === 'getTabs') {
    chrome.tabs.query({}, tabs =>
      sendResponse({ tabs: tabs.map(t => ({ id: t.id, title: t.title || '' })) })
    );
    return true;
  } else if (msg.action === 'getHistory') {
    sendResponse({ history: getTabHistory(msg.tabId) });
  } else if (msg.action === 'shouldDiscard') {
    shouldDiscard(msg.tabId)
      .then(({ ok, reasons }) => sendResponse({ shouldDiscard: ok, reasons }))
      .catch(() => sendResponse({ shouldDiscard: false, reasons: ['Error checking eligibility'] }));
    return true; // async
  }
});


// == Here is the timer implementation for ML predictions ==

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== PREDICT_ALARM) return;
  console.log(`[Alarm:${new Date().toLocaleTimeString()}] running predictions for all tabs`);
  // Re-run your ML-based predict+discard for every tab
  chrome.tabs.query({}, tabs => {
    tabs.forEach(tab => {
      // build sequences from tabHistories
      const hist = tabHistories.get(tab.id) || [];
      const events = hist.map(e => e.type);
      const times  = hist.map((e,i) => i===0 ? 0 : (e.ts - hist[i-1].ts)/1000);

      fetch('http://localhost:1100/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
           event_sequence:   events,
           time_sequence:    times,
           timestamp_sequence: hist.map(h => h.ts),
           temperature:      1.0
         })
      })
      .then(r => r.json())
      .then(data => {
        console.log(
          `[Alarm:${new Date().toLocaleTimeString()}] ------- ` +
          `Tab ${tab.id} predicted → ${data.predicted_event}` +
          ` ------- Tab Title: ${tab.title.slice(0, 30)}`
        );
        if (DISCARD_PREDICTIONS.has(data.predicted_event)) {
          shouldDiscard(tab.id).then(({ ok }) => {
            if (ok) discardWithLog(tab.id, 'ml-extension');
            // if (ok) chrome.tabs.discard(tab.id);
          });
        }
      })
      .catch(console.error);
    });
  });
});