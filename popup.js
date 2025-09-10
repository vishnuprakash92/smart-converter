// Default preferences
const DEFAULTS = {
  currency: 'INR',
  temperature: 'C',
  timezone: 'IST',
  showFormula: true
};

function $(id) { return document.getElementById(id); }

async function loadPrefs() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (items) => resolve(items));
  });
}

function savePrefs(prefs) {
  chrome.storage.sync.set(prefs);
}

function convertCurrencySample(target) {
  // 100 USD sample
  const base = { amount: 100, unit: 'USD' };
  // hardcoded rates to INR for MVP (approx)
  const ratesToINR = { USD:83, EUR:90, GBP:100, INR:1, JPY:0.55, AUD:55, CAD:60, CNY:12, SGD:62 };
  // convert base to INR then to target
  const inr = base.amount * ratesToINR[base.unit];
  if (target === 'INR') return '₹' + Math.round(inr);
  // for USD/EUR/GBP, convert INR -> target
  const back = {};
  Object.keys(ratesToINR).forEach(k => back[k] = 1 / ratesToINR[k]);
  const val = inr * (back[target] || 1);
  const symbol = { USD:'$', EUR:'€', GBP:'£', INR:'₹', JPY:'¥', AUD:'A$', CAD:'C$', CNY:'¥', SGD:'S$' }[target] || target + ' ';
  return symbol + val.toFixed(2);
}

// Fetch latest rates from frankfurter.dev using user's preferred base and store as fxRates
async function fetchAndStoreRates(base){
  const fallback = { base: 'INR', rates: { USD:0.01135, EUR:0.00969, GBP:0.00839, JPY:1.6738, AUD:0.01718, CAD:0.01573, CNY:0.08083, SGD:0.01456 } };
  try{
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=' + encodeURIComponent(base));
    if(!res.ok) throw new Error('bad');
    const data = await res.json();
    // frankfurter returns { amount:1, base: base, date:..., rates: {...} }
    const fx = { base: data.base || base, rates: data.rates || {} };
    // store fxRates for content script to use
    chrome.storage.sync.set({ fxRates: fx, fxLastUpdated: data.date || new Date().toISOString() });
    return fx;
  }catch(e){
    chrome.storage.sync.set({ fxRates: fallback, fxLastUpdated: new Date().toISOString() });
    return fallback;
  }
}

function convertTempSample(target) {
  const f = 72; // 72°F sample from task
  let c = (f - 32) * 5/9;
  if (target === 'C') return c.toFixed(1) + ' °C';
  if (target === 'F') return f + ' °F';
  if (target === 'K') return (c + 273.15).toFixed(1) + ' K';
}

function convertTimeSample(targetTZ) {
  // sample: 9:00 AM PST -> target
  const sample = { hh:9, mm:0, ampm:'AM', tz:'PST' };
  const offsets = { PST:-8, EST:-5, CET:1, UTC:0, IST:5.5 };
  const src = offsets[sample.tz];
  const dst = offsets[targetTZ];
  // construct a Date in UTC from source
  const utcHours = (sample.ampm === 'PM' && sample.hh !== 12) ? sample.hh + 12 : (sample.ampm === 'AM' && sample.hh === 12) ? 0 : sample.hh;
  // compute UTC time as hours - src
  const utc = (utcHours - src) + sample.mm/60;
  const dstH = utc + dst;
  const h = Math.floor((dstH + 24) % 24);
  const m = Math.round((dstH - Math.floor(dstH)) * 60);
  const pad = (n)=>String(n).padStart(2,'0');
  // show in 12h format
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${pad(m)} ${ampm} ${targetTZ}`;
}

document.addEventListener('DOMContentLoaded', async () => {
  // attempt to fetch rates using the user's preferred base on popup open
  const prefsForFetch = await loadPrefs();
  fetchAndStoreRates(prefsForFetch.currency).catch(()=>{});
  const settingsTab = $('tab-settings');
  const previewTab = $('tab-preview');
  const settingsPanel = $('settings');
  const previewPanel = $('preview');

  settingsTab.addEventListener('click', ()=>{
    settingsTab.classList.add('active'); previewTab.classList.remove('active');
    settingsPanel.classList.remove('hidden'); previewPanel.classList.add('hidden');
  });
  previewTab.addEventListener('click', ()=>{
    previewTab.classList.add('active'); settingsTab.classList.remove('active');
    previewPanel.classList.remove('hidden'); settingsPanel.classList.add('hidden');
    renderPreview();
  });

  const prefs = await loadPrefs();
  $('pref-currency').value = prefs.currency;
  $('pref-temperature').value = prefs.temperature;
  $('pref-timezone').value = prefs.timezone;
  // showFormula checkbox
  const cb = document.getElementById('pref-show-formula');
  if(cb) cb.checked = (prefs.showFormula !== undefined) ? prefs.showFormula : true;

  $('save').addEventListener('click', ()=>{
    const toSave = {
      currency: $('pref-currency').value,
      temperature: $('pref-temperature').value,
  timezone: $('pref-timezone').value,
  showFormula: (document.getElementById('pref-show-formula') ? document.getElementById('pref-show-formula').checked : true)
    };
    savePrefs(toSave);
    // brief feedback
    $('save').textContent = 'Saved';
    setTimeout(()=> $('save').textContent = 'Save', 1000);
  });

  // refresh rates button -> message background service worker to force-refresh
  const refreshBtn = document.getElementById('refresh-rates');
  refreshBtn.addEventListener('click', async () => {
    const orig = refreshBtn.textContent;
    refreshBtn.textContent = 'Refreshing...';
    refreshBtn.disabled = true;
    const prefsNow = await loadPrefs();
    chrome.runtime.sendMessage({ type: 'forceRefreshFx', base: prefsNow.currency }, (resp) => {
      if(resp && resp.ok){
        // update displayed last-updated time from storage
        chrome.storage.sync.get({ fxLastUpdated: null }, items => {
          const el = document.getElementById('fx-updated');
          if(items && items.fxLastUpdated){ const dt = new Date(items.fxLastUpdated); el.textContent = dt.toLocaleString(); }
        });
        refreshBtn.textContent = 'Refreshed';
      } else {
        refreshBtn.textContent = 'Failed';
      }
      setTimeout(()=>{ refreshBtn.textContent = orig; refreshBtn.disabled = false; }, 1500);
    });
  });

  function renderPreview(){
    loadPrefs().then(p=>{
  $('preview-currency').textContent = convertCurrencySample(p.currency);
  // extra currency previews
  $('preview-jpy').textContent = convertCurrencySample('JPY');
  $('preview-aud').textContent = convertCurrencySample('AUD');
  $('preview-cad').textContent = convertCurrencySample('CAD');
  $('preview-cny').textContent = convertCurrencySample('CNY');
  $('preview-sgd').textContent = convertCurrencySample('SGD');
  $('preview-temp').textContent = convertTempSample(p.temperature);
  $('preview-time').textContent = convertTimeSample(p.timezone);
      // show last updated
      chrome.storage.sync.get({ fxLastUpdated: null }, items => {
        const el = document.getElementById('fx-updated');
        if(items && items.fxLastUpdated){
          const dt = new Date(items.fxLastUpdated);
          el.textContent = dt.toLocaleString();
        } else el.textContent = 'n/a';
      });
    });
  }

  function buildConversionTable(target){
    const ratesToINR = { USD:83, EUR:90, GBP:100, INR:1, JPY:0.55, AUD:55, CAD:60, CNY:12, SGD:62 };
    const symbols = { USD:'$', EUR:'€', GBP:'£', INR:'₹', JPY:'¥', AUD:'A$', CAD:'C$', CNY:'¥', SGD:'S$' };
    const keys = Object.keys(ratesToINR);
    const tbody = document.querySelector('#conversion-table tbody');
    tbody.innerHTML = '';
    // convert 1 unit of each key into target
    keys.forEach(k => {
      const from = k;
      const inr = 1 * ratesToINR[from];
      const back = 1 / ratesToINR[target];
      const val = inr * back;
      const tr = document.createElement('tr');
      const tdFrom = document.createElement('td'); tdFrom.textContent = from;
      const tdTo = document.createElement('td'); tdTo.textContent = target;
      const tdVal = document.createElement('td'); tdVal.textContent = (symbols[target]||'') + Number(val.toFixed(4));
      tr.appendChild(tdFrom); tr.appendChild(tdTo); tr.appendChild(tdVal);
      tbody.appendChild(tr);
    });
  }

  // update table when preview is shown or preferences change
  document.getElementById('tab-preview').addEventListener('click', ()=>{ loadPrefs().then(p=> buildConversionTable(p.currency)); });

});
