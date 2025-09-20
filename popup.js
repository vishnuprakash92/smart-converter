// Default preferences
const DEFAULTS = {
  currency: 'INR',
  temperature: 'C',
  timezone: 'IST',
  showFormula: true,
  measurement: 'Metric',
  numberLocale: 'auto'
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
  // measurement system
  const msel = document.getElementById('pref-measurement'); if(msel) msel.value = prefs.measurement || 'Metric';
  const nloc = document.getElementById('pref-number-locale'); if(nloc) nloc.value = prefs.numberLocale || 'auto';

  $('save').addEventListener('click', ()=>{
    const toSave = {
      currency: $('pref-currency').value,
      temperature: $('pref-temperature').value,
  timezone: $('pref-timezone').value,
  showFormula: (document.getElementById('pref-show-formula') ? document.getElementById('pref-show-formula').checked : true),
  measurement: (document.getElementById('pref-measurement') ? document.getElementById('pref-measurement').value : 'Metric'),
  numberLocale: (document.getElementById('pref-number-locale') ? document.getElementById('pref-number-locale').value : 'auto')
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
      // measurement previews
      const locale = (p.numberLocale && p.numberLocale !== 'auto') ? p.numberLocale : (navigator && navigator.language) ? navigator.language : undefined;
      const nf = (n, opts={ maximumFractionDigits: 4 }) => new Intl.NumberFormat(locale, opts).format(n);
      // 12 in -> cm or ft depending on metric/imperial target
      if(p.measurement === 'Metric'){
        const cm = 12 * 2.54; $('preview-meas-in').textContent = nf(cm) + ' cm';
        const kgVal = 2.5; $('preview-meas-kg').textContent = nf(kgVal) + ' kg';
        const l = 1 * 3.78541; $('preview-meas-gal').textContent = nf(l) + ' l';
      } else {
        const inchesToFt = (12/12); $('preview-meas-in').textContent = '1 ft';
        const lb = 2.5 * 2.20462; $('preview-meas-kg').textContent = nf(lb) + ' lb';
        const gal = 1; $('preview-meas-gal').textContent = nf(gal) + ' gal';
      }
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

  // number-format preview wiring
  const numInput = document.getElementById('pref-number-input');
  const numFormatted = document.getElementById('pref-number-formatted');
  function updateNumberPreview(){
    loadPrefs().then(p=>{
      const locale = (p.numberLocale && p.numberLocale !== 'auto') ? p.numberLocale : (navigator && navigator.language) ? navigator.language : undefined;
      const v = (numInput && numInput.value) ? Number(numInput.value.replace(/,/g,'')) : NaN;
      if(!isFinite(v)) { if(numFormatted) numFormatted.textContent = 'Invalid number'; return; }
      try{ numFormatted.textContent = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(v); }catch(e){ numFormatted.textContent = String(v); }
    });
  }
  if(numInput){ numInput.addEventListener('input', updateNumberPreview); }
  // initialize preview with empty value
  if(numInput) numInput.value = '';

  // measurement preview wiring
  const measInput = document.getElementById('pref-meas-input');
  const measOutput = document.getElementById('pref-meas-output');
  function parseMeasurementInput(txt){
    if(!txt) return null;
    let s = String(txt).trim().toLowerCase();
    // map some unicode fractions to decimals
    s = s.replace(/[\u00BC\u2153]/g, '1/4').replace(/[\u00BD\u00BD]/g, '1/2').replace(/\u00BE/g, '3/4');
    s = s.replace(/,/g, '');

    // helper: parse numeric token including simple fraction like 1/2
    function parseNumericToken(tok){
      if(!tok) return NaN;
      tok = tok.trim();
      if(/^[-+]?\d+\/\d+$/.test(tok)){
        const parts = tok.split('/'); return Number(parts[0]) / Number(parts[1]);
      }
      const n = Number(tok);
      if(isFinite(n)) return n;
      return NaN;
    }

    // simple words -> numbers mapping (supports phrases like "one and a half")
    const WORD_NUMBERS = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19, twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90, hundred:100, thousand:1000, half:0.5, quarter:0.25 };
    function wordsToNumber(str){
      if(!str) return NaN;
      str = str.replace(/[^a-z\s-]/g,' ').replace(/\s+/g,' ').trim();
      // handle 'and a half' or 'and a quarter'
      if(/and a half/.test(str)){
        const head = str.replace(/and a half/,'').trim();
        const base = wordsToNumber(head);
        return isFinite(base) ? base + 0.5 : NaN;
      }
      const tokens = str.split(/[\s-]+/);
      let total = 0; let current = 0;
      for(const t of tokens){
        if(!t) continue;
        if(WORD_NUMBERS[t] !== undefined){
          const v = WORD_NUMBERS[t];
          if(v === 100 || v === 1000){ current = (current || 1) * v; }
          else current += v;
        } else {
          // unknown token
          return NaN;
        }
      }
      total += current;
      return total;
    }

    // Try several patterns in order:
    // 1) numeric at start (e.g., '12 in', '12in', '12.5kg', '1/2 cup')
    let m = s.match(/^([+-]?\d+(?:\.\d+)?(?:\/\d+)?)(?:\s*)([\w\^\d\.\s%°]+)?$/i);
    if(m){
      const val = parseNumericToken(m[1]);
      let unit = (m[2]||'').trim();
      if(!unit) return { val, unit: '' };
      unit = unit.replace(/\.+$/,'').replace(/^\s+|\s+$/g,'');
      // strip trailing punctuation
      unit = unit.replace(/[.,]$/,'');
      // normalize
      unit = unit.replace(/\s+/g,' ');
      return { val, unit };
    }

    // 2) word-number then unit (e.g., 'one cup', 'one and a half cup')
    const idx = s.lastIndexOf(' ');
    if(idx > 0){
      const numPart = s.slice(0, idx).trim();
      const unitPart = s.slice(idx + 1).trim();
      const val = wordsToNumber(numPart);
      if(!isNaN(val)) return { val, unit: unitPart };
    }

    // 3) fallback: try to split number + letters inside (e.g., '12inches' where no space)
    m = s.match(/^([+-]?\d+(?:\.\d+)?)([a-z%°]+.*)$/i);
    if(m){ const val = parseNumericToken(m[1]); let unit = (m[2]||'').trim(); unit = unit.replace(/\.+$/,''); return { val, unit }; }

    return null;
  }

  function convertMeasurementForPopup(val, unit, targetSystem){
    // reuse same conversion factors as content script
    const lengthToM = { mm:0.001, cm: 0.01, m:1, km:1000, in:0.0254, ft:0.3048, yd:0.9144, mi:1609.34 };
    const weightToG = { mcg:0.000001, ug:0.000001, mg:0.001, g:1, kg:1000, t:1000000, ton:907185, lb:453.592, oz:28.3495 };
    const volToL = { ml:0.001, l:1, m3:1000, gal:3.78541, pt:0.473176, cup:0.24, tsp:0.00492892, tbsp:0.0147868 };
    unit = unit.toLowerCase();
    if(lengthToM[unit] !== undefined){
      const meters = val * lengthToM[unit];
      if(targetSystem === 'Metric'){
        if(meters >= 1) return { val: meters, unit: 'm' };
        if(meters >= 0.01) return { val: meters*100, unit: 'cm' };
        return { val: meters*1000, unit: 'mm' };
      } else {
        const feet = meters / 0.3048;
        if(feet >= 5280) return { val: meters / 1609.34, unit: 'mi' };
        if(feet >= 1) return { val: feet, unit: 'ft' };
        return { val: meters / 0.0254, unit: 'in' };
      }
    }
    if(weightToG[unit] !== undefined){
      const grams = val * weightToG[unit];
      if(targetSystem === 'Metric'){
        if(grams >= 1000000) return { val: grams/1000000, unit: 't' };
        if(grams >= 1000) return { val: grams/1000, unit: 'kg' };
        return { val: grams, unit: 'g' };
      } else {
        const lbs = grams / 453.592;
        if(lbs >= 1) return { val: lbs, unit: 'lb' };
        return { val: grams / 28.3495, unit: 'oz' };
      }
    }
    if(volToL[unit] !== undefined){
      const liters = val * volToL[unit];
      if(targetSystem === 'Metric'){
        if(liters >= 1) return { val: liters, unit: 'l' };
        if(liters >= 0.001) return { val: liters*1000, unit: 'ml' };
        return { val: liters*1000000, unit: 'ml' };
      } else {
        const gals = liters / 3.78541;
        if(gals >= 0.5) return { val: gals, unit: 'gal' };
        const pints = liters / 0.473176;
        if(pints >= 1) return { val: pints, unit: 'pt' };
        const cups = liters / 0.24;
        if(cups >= 1) return { val: cups, unit: 'cup' };
        const tsps = liters / 0.00492892;
        return { val: tsps, unit: 'tsp' };
      }
    }
    return null;
  }

  function updateMeasurementPreview(){
    loadPrefs().then(p=>{
      const parsed = parseMeasurementInput(measInput ? measInput.value : '');
      if(!parsed){ if(measOutput) measOutput.textContent = 'Invalid input'; return; }
      const conv = convertMeasurementForPopup(parsed.val, parsed.unit, p.measurement || 'Metric');
      if(!conv){ if(measOutput) measOutput.textContent = 'Unknown unit'; return; }
      const locale = (p.numberLocale && p.numberLocale !== 'auto') ? p.numberLocale : (navigator && navigator.language) ? navigator.language : undefined;
      try{ measOutput.textContent = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(conv.val) + ' ' + conv.unit; }catch(e){ measOutput.textContent = conv.val + ' ' + conv.unit; }
    });
  }
  if(measInput){ measInput.addEventListener('input', updateMeasurementPreview); }
  if(measInput) measInput.value = '';

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
