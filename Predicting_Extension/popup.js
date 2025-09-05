//Discard Extension

// 1) Define which predicted events should trigger a discard
const DISCARD_PREDICTIONS = new Set([
  'tabRemoved',       // user is likely to close the tab soon
  'windowRemoved'     // the whole window is about to go away
  ]);

// format timestamp
function fmt(ts) {
  return new Date(ts).toLocaleTimeString();
}

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

// 2) Wrapper that logs & then discards
async function discardWithLogging(tabId, source, uiCallback) {
  // a) grab metrics
  const stats = await getTabMemoryStats(tabId);
  // b) send to your logger service
  fetch('http://localhost:12005/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'tabAboutToBeDiscarded',
      tabId,
      source,
      timestamp: Date.now(),
      stats
    })
  }).catch(console.error);
  // c) now actually discard
  chrome.tabs.discard(tabId, uiCallback);
}

function loadAllHistories() {
  const container = document.getElementById('allHistories');
  container.innerHTML = '';

  chrome.runtime.sendMessage({ action: 'getTabs' }, resp => {
    resp.tabs.forEach(tab => {
      const section = document.createElement('div');
      section.className = 'tab-section';

      const header = document.createElement('div');
      header.className = 'tab-header';
      header.textContent = `Tab #${tab.id} — ${tab.title.slice(0,30)}`;
      section.appendChild(header);

      const historyDiv = document.createElement('div');
      historyDiv.className = 'history';
      section.appendChild(historyDiv);
      container.appendChild(section);

      chrome.runtime.sendMessage(
        { action: 'getHistory', tabId: tab.id },
        histResp => {
          // render history...
          historyDiv.innerHTML = '';
          histResp.history.forEach(evt => {
            const el = document.createElement('div');
            el.className = 'event';
            el.innerHTML = `<strong>${evt.type}</strong>
                            <span class="ts">${fmt(evt.ts)}</span>`;
            historyDiv.appendChild(el);
          });

          // build sequences
          const eventSeq = histResp.history.map(h=>h.type);
          const tsSeq    = histResp.history.map(h=>h.ts);
          const timeSeq  = tsSeq.map((t,i) => i===0 ? 0 : (t-tsSeq[i-1])/1000);

          // get prediction
          fetch('http://localhost:1100/predict', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            // body: JSON.stringify({
            //   event_sequence: eventSeq,
            //   time_sequence:  timeSeq,
            //   temperature:    1.0
            // })
          body: JSON.stringify({
           event_sequence:   eventSeq,
           time_sequence:    timeSeq,
           timestamp_sequence: histResp.history.map(h => h.ts),
           temperature:      1.0
         })
          })
          .then(r => r.json())
          .then(data => {
            const p = document.createElement('div');
            p.style.marginTop = '8px';
            p.innerHTML = `<em>Predicted next:</em> <strong>${data.predicted_event}</strong>`;
            section.appendChild(p);

            // 2) If the predicted event is in our discard set, discard the tab
            if (DISCARD_PREDICTIONS.has(data.predicted_event)) {
              chrome.runtime.sendMessage(
                { action: 'shouldDiscard', tabId: tab.id },
                resp => {


                  // if (resp.shouldDiscard) {
                  //   chrome.tabs.discard(tab.id, () => {
                  //     console.log(`✅ Discarded tab ${tab.id}`);
                  //     p.style.color = 'red';
                  //   });



                  if (resp.shouldDiscard) {
                    discardWithLogging(tab.id, 'ml-popup', () => {
                    console.log(`✅ Discarded tab ${tab.id}`);
                    p.style.color = 'red';
                  });

                  } else {
                  
                    console.warn(`Skip discarding tab ${tab.id}:`, resp.reasons);
                    p.style.color = 'gray';
                    const warn = document.createElement('div');
                    warn.className = 'warn';
                    warn.textContent = 'Skipped because: ' + resp.reasons.join(', ');
                    section.appendChild(warn);
                  }
                }
              );
            }
          })
          .catch(console.error);
        }
      );

      const manualBtn = document.createElement('button');
      manualBtn.textContent = 'Manual Discard';
      manualBtn.className = 'manual-discard-btn';
      
      
      manualBtn.addEventListener('click', () => {
        // Ask the background if it’s OK to discard
        chrome.runtime.sendMessage(
          { action: 'shouldDiscard', tabId: tab.id },
          resp => {



            // if (resp.shouldDiscard) {
            //   chrome.tabs.discard(tab.id, () => {
            //     manualBtn.disabled = true;
            //     manualBtn.textContent = 'Discarded';
            //     section.style.opacity = 0.5;
            //   });

            if (resp.shouldDiscard) {
              discardWithLogging(tab.id, 'manual-popup', () => {
              manualBtn.disabled = true;
              manualBtn.textContent = 'Discarded';
              section.style.opacity = 0.5;
              });



            } else {
              alert(
                `Cannot discard Tab ${tab.id}:\n` +
                (resp.reasons || ['Unknown reason']).join('\n')
              );
            }
          }
        );
      });

      section.appendChild(manualBtn);
    });
  });
}


document.addEventListener('DOMContentLoaded', () => {
  // restore last‐used interval
  chrome.storage.local.get('predictInterval', data => {
    const sel = document.getElementById('interval');
    sel.value = data.predictInterval || 'off';
  });

  document.getElementById('setInterval').addEventListener('click', () => {
    const minutes = document.getElementById('interval').value;
    chrome.runtime.sendMessage({ action: 'setPredictInterval', minutes });
  });

  loadAllHistories();
});


// document.addEventListener('DOMContentLoaded', loadAllHistories);
