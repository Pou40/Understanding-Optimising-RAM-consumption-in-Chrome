// Activity Logger
let currentTabId = null;
let tabStartTime = null;

// Function to send data to the external application
function sendData(data) {
  fetch('http://localhost:12005/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).catch(err => console.error("Error sending data: ", err));
}

// Helper to get current timestamp in milliseconds
function now() {
  return Date.now();
}


// Enhanced function to log tab stats before discard
async function logTabProcessStats(tabId, source) {
  try {
    // Get tab info
    const tab = await chrome.tabs.get(tabId);
    
    
    const logData = {
      type: 'tabDiscarded',
      tabId,
      source,
      url: tab.url,
      title: tab.title,
      timestamp: now()
    };

    sendData(logData);
  } catch (error) {
    console.error("Error logging tab process stats:", error);
    // Send basic discard info even if we can't get memory stats
    sendData({
      type: 'tabDiscarded',
      tabId,
      source,
      error: error.message,
      timestamp: now()
    });
  }
}

/* -------------------------- TAB & WINDOW LOGGING -------------------------- */

// Listen for tab activation events (when the user switches tabs)
chrome.tabs.onActivated.addListener((activeInfo) => {
  // If a tab was previously active, log how long it was used
  if (currentTabId && tabStartTime) {
    let duration = now() - tabStartTime;
    sendData({
      type: "tabDuration",
      tabId: currentTabId,
      duration: duration,
      timestamp: now()
    });
  }

  // Log the tab switch event
  sendData({
    type: "tabSwitched",
    fromTab: currentTabId,
    toTab: activeInfo.tabId,
    timestamp: now()
  });

  // Update current tab info
  currentTabId = activeInfo.tabId;
  tabStartTime = now();
});

// Listen for window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    if (currentTabId && tabStartTime) {
      let duration = now() - tabStartTime;
      sendData({
        type: "tabDuration",
        tabId: currentTabId,
        duration: duration,
        timestamp: now()
      });
    }
    currentTabId = null;
    tabStartTime = null;
  } else {
    tabStartTime = now();
    sendData({
      type: "windowFocused",
      windowId: windowId,
      timestamp: now()
    });
  }
});

// Track when new tabs are created
chrome.tabs.onCreated.addListener((tab) => {
  sendData({
    type: "tabCreated",
    tabId: tab.id,
    url: tab.url || "unknown",
    windowId: tab.windowId,
    timestamp: now()
  });
});

// Updated tab listener with better error handling
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    sendData({
      type: "tabUpdated",
      tabId,
      url: changeInfo.url,
      windowId: tab.windowId,
      timestamp: now()
    });
  }

  if (changeInfo.title) {
    sendData({
      type: "tabTitleChanged",
      tabId,
      title: changeInfo.title,
      windowId: tab.windowId,
      timestamp: now()
    });
  }
  
  if (changeInfo.discarded === true) {
    // Tab is being discarded - log stats
    await logTabProcessStats(tabId, 'chrome');
  }
  else if (changeInfo.discarded === false && tab.discarded === false) {
    sendData({ type:'tabReloaded', tabId, timestamp: now() });
  }
});

// Handle manual discard requests
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.action === 'manualDiscard') {
    // Get stats before discarding
    logTabProcessStats(msg.tabId, 'extension').then(() => {
      chrome.tabs.discard(msg.tabId, () => {
        respond({ success: true });
      });
    });
    return true;
  }
});

// Track when tabs are removed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  sendData({
    type: "tabRemoved",
    tabId: tabId,
    windowId: removeInfo.windowId,
    isWindowClosing: removeInfo.isWindowClosing,
    timestamp: now()
  });
});

chrome.tabs.onHighlighted.addListener((highlightInfo) => {
  sendData({
    type: "tabHighlighted",
    windowId: highlightInfo.windowId,
    tabIds: highlightInfo.tabIds,
    timestamp: Date.now()
  });
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  sendData({
    type: "tabDetached",
    tabId: tabId,
    oldWindowId: detachInfo.oldWindowId,
    timestamp: Date.now()
  });
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  sendData({
    type: "tabAttached",
    tabId: tabId,
    newWindowId: attachInfo.newWindowId,
    timestamp: Date.now()
  });
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  sendData({
    type: "tabReplaced",
    addedTabId: addedTabId,
    removedTabId: removedTabId,
    timestamp: Date.now()
  });
});

/* -------------------------- WINDOW EVENTS -------------------------- */

chrome.windows.onCreated.addListener((window) => {
  sendData({
    type: "windowCreated",
    windowId: window.id,
    focused: window.focused,
    state: window.state,
    timestamp: now()
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  sendData({
    type: "windowRemoved",
    windowId: windowId,
    timestamp: now()
  });
});

/* -------------------------- USER IDLE / ACTIVITY -------------------------- */

chrome.idle.onStateChanged.addListener((newState) => {
  sendData({
    type: "userIdleStateChanged",
    newState: newState,
    timestamp: now()
  });
});

/* -------------------------- PERIODIC STATS -------------------------- */

setInterval(() => {
  chrome.windows.getAll({populate: true}, (windows) => {
    let windowCount = windows.length;
    let tabCount = 0;
    windows.forEach(w => { tabCount += w.tabs ? w.tabs.length : 0; });

    sendData({
      type: "periodicBrowserStats",
      windowCount: windowCount,
      tabCount: tabCount,
      timestamp: now()
    });
  });
}, 30000);