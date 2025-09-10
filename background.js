// background service worker: periodically fetch FX rates and store them in chrome.storage.sync
// runs every 4 hours using chrome.alarms

// Use the same v1 endpoint variant used elsewhere in the popup code
const FX_API = 'https://api.frankfurter.dev/v1/latest';

async function fetchRates(base = 'INR'){
  try{
    const url = `${FX_API}?base=${encodeURIComponent(base)}`;
    const res = await fetch(url);
    if(!res.ok){
      const text = await res.text().catch(()=>'<no body>');
      throw new Error(`status=${res.status} body=${text}`);
    }
    const data = await res.json();
    const fx = { base: data.base || base, rates: data.rates || {}, date: data.date || new Date().toISOString() };
    chrome.storage.sync.set({ fxRates: fx, fxLastUpdated: fx.date });
  }catch(e){
    // ignore failures; popup already has manual fetch fallback
    console.warn('Smart Converter: failed to refresh FX rates', e);
  }
}

// on installed, start an alarm
chrome.runtime.onInstalled.addListener(() => {
  // default base currency can be read from storage; if absent use INR
  chrome.storage.sync.get({ currency: 'INR' }, (items) => {
    const base = items.currency || 'INR';
    fetchRates(base);
  });
  // create alarm every 4 hours
  chrome.alarms.create('refreshFx', { periodInMinutes: 60 * 4 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if(alarm && alarm.name === 'refreshFx'){
    chrome.storage.sync.get({ currency: 'INR' }, (items) => {
      const base = items.currency || 'INR';
      fetchRates(base);
    });
  }
});

// also allow popup or other parts to message to force-refresh
chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
  if(msg && msg.type === 'forceRefreshFx'){
    const base = msg.base || 'INR';
    fetchRates(base).then(()=>sendResp({ ok:true })).catch(()=>sendResp({ ok:false }));
    return true; // indicate async response
  }
});
