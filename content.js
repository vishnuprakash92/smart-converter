// Content script: detect currency, temperature, time in page text nodes and attach hover tooltip

(function(){
  // New: process element-level textContent to find matches that may span multiple text nodes
  const CURRENCY_REGEX = /\b\d+(?:\.\d+)?\s?(USD|EUR|GBP|INR|JPY|AUD|CAD|CNY|SGD)\b/g;
  const CURRENCY_SYMBOL_REGEX = /(?:\$|₹|€|£|¥|A\$|C\$|S\$|元)\s?[\d,]+(?:\.\d+)?/g;
  // more robust temperature regex:
  // - supports optional sign and decimals
  // - allows optional degree symbol or the word 'degrees'
  // - matches unit names and words (C, F, K, Celsius, Fahrenheit)
  const TEMP_REGEX = /(-?\d+(?:\.\d+)?)(?:\s*(?:°|\u00b0)?\s*(?:deg(?:rees)?)?)?\s*(?:°|\u00b0)?\s*(C|F|K|Celsius|Fahrenheit)\b/gi;
  const TIME_REGEX = /\b\d{1,2}:\d{2}\s?(AM|PM)?\s?(PST|EST|CET|IST)\b/gi;
  // detection for common measurement units (length, weight, volume)
  const MEASUREMENT_REGEX = /\b(-?\d+(?:\.\d+)?)(?:\s*)(mm|cm|m|km|in|ft|yd|mi|mcg|ug|mg|g|kg|t|ton|tonne|lb|oz|ml|l|m3|m\^3|cubic\s*m|cubic\s*meter|cubic\s*metre|gal|pt|cup|tsp|teaspoon|tbsp|tablespoon)\b/gi;

  // default hardcoded rates (fallback)
  let ratesToINR = { USD:83, EUR:90, GBP:100, INR:1, JPY:0.55, AUD:55, CAD:60, CNY:12, SGD:62 };

  // try to load stored rates from chrome.storage.sync
  let fxRates = null; // { base: 'INR', rates: { USD:0.01135, ... } }
  // preference: whether to show the formula line in the tooltip
  let SHOW_FORMULA = true;
  // unit tokens loaded from external config (populated below). We'll build unitRegex from this list.
  let UNIT_TOKENS = [ 'c','celsius','f','fahrenheit','k','kelvin','°c','°f' ];
  let unitRegex = new RegExp('(?:' + UNIT_TOKENS.map(u => u.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')).join('|') + ')', 'i');
  // measurement preferences
  let MEASUREMENT_PREF = 'Metric';
  let NUMBER_LOCALE = 'auto';
  // safe wrapper for chrome.storage access to avoid exceptions when extension context is invalidated
  function safeGetStorage(defaults, cb){
    try{
      if(window.chrome && chrome.storage && chrome.storage.sync && typeof chrome.storage.sync.get === 'function'){
        chrome.storage.sync.get(defaults, (items)=>{ try{ cb(items); }catch(e){} });
      } else {
        // fallback: call callback with defaults
        try{ cb(defaults); }catch(e){}
      }
    }catch(e){
      console.warn('Smart Converter: safeGetStorage failed', e);
      try{ cb(defaults); }catch(err){}
    }
  }

  // debug flag: can be enabled by adding `?sc_debug=1` to the page URL or by storing { sc_debug: true } in chrome.storage.sync
  let SC_DEBUG = false;
  function debugLog(...args){ if(!SC_DEBUG) return; try{ console.debug('SmartConverter[debug]:', ...args); }catch(e){} }

  safeGetStorage({ ratesToINR: ratesToINR, fxRates: null, sc_debug: false, showFormula: true }, (items)=>{ if(items){ if(items.ratesToINR) ratesToINR = items.ratesToINR; if(items.fxRates) fxRates = items.fxRates; if(items.sc_debug) SC_DEBUG = true; if(typeof items.showFormula !== 'undefined') SHOW_FORMULA = items.showFormula; }
    // also allow URL override
    try{ if(!SC_DEBUG && typeof location !== 'undefined' && location.search && location.search.indexOf('sc_debug=1') !== -1) SC_DEBUG = true; }catch(e){}
    debugLog('initialized', { fxRatesLoaded: !!fxRates, ratesToINRLoaded: !!ratesToINR, sc_debug: SC_DEBUG });
  });
  // also fetch measurement prefs
  safeGetStorage({ measurement: 'Metric', numberLocale: 'auto' }, (items)=>{ if(items){ if(items.measurement) MEASUREMENT_PREF = items.measurement; if(items.numberLocale) NUMBER_LOCALE = items.numberLocale; } });

  function formatCurrencyValue(val, code){
    const symbols = { USD:'$', EUR:'€', GBP:'£', INR:'₹', JPY:'¥', AUD:'A$', CAD:'C$', CNY:'¥', SGD:'S$' };
    const symbol = symbols[code] || code + ' ';
    // avoid showing cents for JPY
    if(code === 'JPY') return symbol + Math.round(val);
    return symbol + Number(val.toFixed(2));
  }

  function convertCurrency(amount, from, to){
    if(!from || !to) return null;
    from = from.toUpperCase(); to = to.toUpperCase();
    if(from === to) return formatCurrencyValue(amount, to);

    // prefer fxRates if available
    if(fxRates && fxRates.rates){
      const R = fxRates.rates; const B = fxRates.base;
      try{
        if(from === B){
          if(R[to] !== undefined) return formatCurrencyValue(amount * R[to], to);
        } else if(to === B){
          if(R[from] !== undefined) return formatCurrencyValue(amount / R[from], to);
        } else if(R[from] !== undefined && R[to] !== undefined){
          return formatCurrencyValue(amount * (R[to] / R[from]), to);
        }
      }catch(e){ /* fallthrough to fallback */ }
    }

    // fallback: use ratesToINR map (1 unit -> INR)
    const toINR = (ratesToINR[from] !== undefined) ? (amount * ratesToINR[from]) : null;
    if(toINR === null) return null;
    if(to === 'INR') return '₹' + Math.round(toINR);
    if(!ratesToINR[to]) return null;
    const out = toINR / ratesToINR[to];
    return formatCurrencyValue(out, to);
  }

  // return both formatted value and a human-readable formula string
  function currencyConversionDetails(amount, from, to){
    const formatted = convertCurrency(amount, from, to);
    if(!from || !to) return { formatted, formula: '' };
    from = from.toUpperCase(); to = to.toUpperCase();
    // prefer fxRates
    if(fxRates && fxRates.rates){
      const R = fxRates.rates; const B = fxRates.base;
      try{
        if(from === to) return { formatted, formula: `${amount} ${from} = ${formatted}` };
        if(from === B && R[to] !== undefined){
          const factor = R[to];
          const out = amount * factor;
          return { formatted, formula: `${amount} ${from} × ${factor} = ${out.toFixed(4)} ${to}` };
        }
        if(to === B && R[from] !== undefined){
          const factor = R[from];
          const out = amount / factor;
          return { formatted, formula: `${amount} ${from} ÷ ${factor} = ${out.toFixed(4)} ${to}` };
        }
        if(R[from] !== undefined && R[to] !== undefined){
          const outFactor = R[to] / R[from];
          const out = amount * outFactor;
          return { formatted, formula: `${amount} ${from} × (${R[to]} / ${R[from]}) = ${out.toFixed(4)} ${to}` };
        }
      }catch(e){}
    }
    // fallback path using ratesToINR (1 unit -> INR)
    if(ratesToINR[from] === undefined) return { formatted, formula: '' };
    const inr = amount * ratesToINR[from];
    if(to === 'INR') return { formatted, formula: `${amount} ${from} × ${ratesToINR[from]} (INR/${from}) = ₹${Math.round(inr)}` };
    if(!ratesToINR[to]) return { formatted, formula: '' };
    const out = inr / ratesToINR[to];
    return { formatted, formula: `${amount} ${from} × ${ratesToINR[from]} (INR/${from}) ÷ ${ratesToINR[to]} (INR/${to}) = ${out.toFixed(4)} ${to}` };
  }

  // remove existing annotated spans (class smart-detect) and unwrap them to original text nodes
  function clearAnnotations(){
    try{
      const nodes = Array.from(document.querySelectorAll('span.smart-detect'));
      nodes.forEach(n=>{
        const parent = n.parentNode;
        if(!parent) return;
        const txt = document.createTextNode(n.textContent || '');
        parent.replaceChild(txt, n);
      });
      debugLog('clearAnnotations: removed', nodes.length);
    }catch(e){ debugLog('clearAnnotations error', e); }
  }

  function convertTemp(val, from, to){
    if(!from || !to) return null;
    from = from.toUpperCase(); to = to.toUpperCase();
    let c = val;
    let formula = '';
    if(from === '°F' || from === 'F'){
      c = (val - 32) * 5/9; formula = `(${val} - 32) × 5/9 = ${c.toFixed(4)} °C`;
    } else if(from === 'K'){
      c = val - 273.15; formula = `${val} K - 273.15 = ${c.toFixed(4)} °C`;
    } else { // assumed C
      formula = `${val} °C`;
    }
    if(to === 'C') return { formatted: c.toFixed(1) + ' °C', formula };
    if(to === 'F'){ const f = (c * 9/5) + 32; return { formatted: f.toFixed(1) + ' °F', formula: `${formula} → ${f.toFixed(4)} °F` }; }
    if(to === 'K'){ const k = c + 273.15; return { formatted: k.toFixed(1) + ' K', formula: `${formula} → ${k.toFixed(4)} K` }; }
    return { formatted: c.toFixed(1) + ' °C', formula };
  }

  // Measurement conversion helpers
  function convertMeasurement(val, unit, targetSystem){
    // normalize
    unit = unit.toLowerCase();
    const n = Number(val);
    if(isNaN(n)) return null;
      // length: convert everything to meters as intermediate
    const lengthToM = { mm:0.001, cm: 0.01, m:1, km:1000, in:0.0254, ft:0.3048, yd:0.9144, mi:1609.34 };
    // weights: grams as intermediate (include tonne/tonne variants)
    const weightToG = { mcg:0.000001, ug:0.001, mg:0.001, g:1, kg:1000, t:1000000, ton:907185, lb:453.592, oz:28.3495 };
    // volumes: liters as intermediate, include cubic meters, teaspoons, tablespoons
    const volToL = { ml:0.001, l:1, 'm3':1000, 'm^3':1000, 'cubic m':1000, gal:3.78541, pt:0.473176, cup:0.24, tsp:0.00492892, tbsp:0.0147868 };
    if(lengthToM[unit] !== undefined){
      const meters = n * lengthToM[unit];
      if(targetSystem === 'Metric'){
          // prefer m for >= 1 m, cm for < 1 m, mm for very small
          if(meters >= 1) return { val: meters, unit: 'm' };
          if(meters >= 0.01) return { val: meters*100, unit: 'cm' };
          return { val: meters*1000, unit: 'mm' };
      } else {
        // convert to feet/inches/miles depending
          const feet = meters / 0.3048;
          if(feet >= 5280) return { val: meters / 1609.34, unit: 'mi' };
          if(feet >= 1) return { val: feet, unit: 'ft' };
          return { val: meters / 0.0254, unit: 'in' };
      }
    }
    if(weightToG[unit] !== undefined){
      const grams = n * weightToG[unit];
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
      const liters = n * volToL[unit];
      if(targetSystem === 'Metric'){
          if(liters >= 1) return { val: liters, unit: 'l' };
          if(liters >= 0.001) return { val: liters*1000, unit: 'ml' };
          return { val: liters*1000000, unit: 'ml' };
      } else {
          // prefer gallons for >= 0.5 gal, else show pt/cup/tsp
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

  function formatNumberForLocale(n){
    try{
      const locale = (NUMBER_LOCALE && NUMBER_LOCALE !== 'auto') ? NUMBER_LOCALE : (navigator && navigator.language) ? navigator.language : undefined;
      const opts = { maximumFractionDigits: 4 };
      return new Intl.NumberFormat(locale, opts).format(n);
    }catch(e){ return String(n); }
  }

  function convertTime(hh, mm, ampm, fromTZ, toTZ){
    const offsets = { PST:-8, EST:-5, CET:1, UTC:0, IST:5.5 };
    const src = offsets[fromTZ] !== undefined ? offsets[fromTZ] : 0;
    const dst = offsets[toTZ] !== undefined ? offsets[toTZ] : 0;
    // normalize hours
    let h = hh;
    if(ampm){ const up = (ampm.toUpperCase() === 'PM'); if(up && h !== 12) h += 12; if(!up && h === 12) h = 0; }
    const utc = h - src + mm/60;
    const dstH = utc + dst;
    const resH = Math.floor((dstH + 24) % 24);
    const resM = Math.round((dstH - Math.floor(dstH)) * 60);
    const pad = (n)=>String(n).padStart(2,'0');
    const am = resH >= 12 ? 'PM' : 'AM';
    const outH = ((resH + 11) % 12) + 1;
    const formatted = `${outH}:${pad(resM)} ${am} ${toTZ}`;
    const formula = `${hh}:${pad(mm)} ${ampm || ''} (${fromTZ} UTC${src>=0?'+':''}${src}) → UTC → ${toTZ} UTC${dst>=0?'+':''}${dst} = ${formatted}`;
    return { formatted, formula };
  }

  // tooltip creation and hover wiring
  let tooltipEl = null;
  function createTooltip(){
    if(tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'smart-tooltip hidden';
  tooltipEl.style.position = 'fixed'; tooltipEl.style.zIndex = 2147483647; tooltipEl.style.pointerEvents = 'none';
    document.documentElement.appendChild(tooltipEl);
  debugLog('createTooltip: created tooltip element');
    return tooltipEl;
  }

  function attachHover(node, data, compute){
  if(!node) return;
  debugLog('attachHover: attaching to node', node && node.textContent && node.textContent.slice(0,80));
  node.addEventListener('mouseenter', (e)=>{
      const tEl = createTooltip();
      // compute value and formula depending on type
      let details = { formatted: '', formula: '' };
      if(data.type === 'currency') details = currencyConversionDetails(data.amt, data.unit, data.target || data.unit);
      if(data.type === 'temp') details = convertTemp(data.val, data.unit, data.target || data.unit);
      if(data.type === 'time') details = convertTime(data.hh, data.mm, data.ampm, data.tz, data.target || data.tz);
      // fallback: use compute for formatted string
      let formatted = '';
      try{ const f = compute && compute(data); formatted = (typeof f === 'string') ? f : (f && f.formatted) || ''; }catch(e){}
      if(!formatted && details.formatted) formatted = details.formatted;

      // format numbers with locale-aware formatting for formula pieces
      const locale = (navigator && navigator.language) ? navigator.language : 'en-US';

      // compute numeric conversion factor and present a concise formula line
      function conversionFactor(from, to){
        if(!from || !to) return null;
        from = from.toUpperCase(); to = to.toUpperCase();
        if(from === to) return 1;
        if(fxRates && fxRates.rates){
          const R = fxRates.rates; const B = fxRates.base;
          try{
            if(from === B && R[to] !== undefined) return R[to];
            if(to === B && R[from] !== undefined) return 1 / R[from];
            if(R[from] !== undefined && R[to] !== undefined) return R[to] / R[from];
          }catch(e){}
        }
        if(ratesToINR[from] !== undefined && ratesToINR[to] !== undefined){
          return (ratesToINR[from] / ratesToINR[to]);
        }
        return null;
      }

      function formatNumberShort(n){
        try{
          if(n === null || n === undefined || !isFinite(n)) return String(n);
          const abs = Math.abs(n);
          if(abs >= 1000) return Math.round(n).toLocaleString();
          if(abs >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
          if(abs > 0) return n.toLocaleString(undefined, { maximumSignificantDigits: 4 });
          return String(n);
        }catch(e){ return String(n); }
      }

      const factor = (data.type === 'currency') ? conversionFactor(data.unit, data.target || data.unit) : null;
      let formulaLine = '';
      if(data.type === 'currency' && factor !== null){
        const amt = data.amt;
        const converted = (typeof factor === 'number') ? (amt * factor) : null;
        const convertedStr = converted !== null ? formatCurrencyValue(converted, data.target || data.unit) : (details.formatted || '');
        formulaLine = `${formatCurrencyValue(amt, data.unit)} × ${formatNumberShort(factor)} = ${convertedStr}`;
      } else {
        // fallback to details.formula
        formulaLine = details.formula || '';
      }

  const formulaHtml = (formulaLine && SHOW_FORMULA) ? `<div class="formula">${formulaLine}</div>` : '';
  tEl.innerHTML = `<div style="font-weight:600;">${formatted}</div>${formulaHtml}`;
      tEl.classList.remove('hidden');
      debugLog('attachHover: showed tooltip', { data, details, formulaLine });
      // position immediately at mouse location
      (function positionAtEvent(evt){
        const pad = 12;
        let x = evt.clientX + pad; let y = evt.clientY + pad;
        const rect = tEl.getBoundingClientRect();
        if(x + rect.width > window.innerWidth) x = evt.clientX - rect.width - pad;
        if(y + rect.height > window.innerHeight) y = evt.clientY - rect.height - pad;
        tEl.style.left = x + 'px'; tEl.style.top = y + 'px';
      })(e);
    });
    node.addEventListener('mousemove', (e)=>{
      const tEl = createTooltip();
      const pad = 12;
      let x = e.clientX + pad; let y = e.clientY + pad;
      // keep inside viewport
      const rect = tEl.getBoundingClientRect();
      if(x + rect.width > window.innerWidth) x = e.clientX - rect.width - pad;
      if(y + rect.height > window.innerHeight) y = e.clientY - rect.height - pad;
      tEl.style.left = x + 'px'; tEl.style.top = y + 'px';
    });
    node.addEventListener('mouseleave', ()=>{
      if(tooltipEl){ tooltipEl.classList.add('hidden'); }
    });
  }

  function walkAndAnnotate(root, prefs){
    try{ processRoot(root, prefs); }catch(e){}
  }

  // safe sendMessage wrapper
  function safeSendMessage(msg, cb){
    try{
      if(window.chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function'){
        chrome.runtime.sendMessage(msg, (resp)=>{ try{ if(cb) cb(resp); }catch(e){} });
      } else {
        debugLog('safeSendMessage: chrome.runtime not available', msg);
        if(cb) cb && cb(null);
      }
    }catch(e){ debugLog('safeSendMessage error', e); if(cb) try{ cb(null); }catch(err){} }
  }
  function createRangeFromIndex(container, start, length){
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let node; let idx = 0; let startNode = null, startOffset = 0; let endNode = null, endOffset = 0;
    while(walker.nextNode()){
      node = walker.currentNode;
      const txt = node.nodeValue || '';
      const nextIdx = idx + txt.length;
      if(startNode === null && start < nextIdx){
        startNode = node; startOffset = Math.max(0, start - idx);
      }
      if(startNode !== null && (start + length) <= nextIdx){
        endNode = node; endOffset = Math.max(0, (start + length) - idx);
        break;
      }
      idx = nextIdx;
    }
    if(!startNode || !endNode) return null;
    const range = document.createRange();
    try{ range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset); return range; }catch(e){ return null; }
  }

  function processElement(el, prefs){
    if(el.closest && el.closest('script,style,textarea,input')) return;
    if(el.closest && el.closest('.smart-detect')) return;
  // avoid large blocks; prefer textContent but fall back to innerText for some sites (e.g., Amazon offscreen text)
  let text = (el.textContent && el.textContent.trim().length) ? el.textContent : (el.innerText || '');
    // normalize characters that break matching: unicode minus, non-breaking spaces, collapse whitespace
    try{ text = text.replace(/\u2212/g,'-').replace(/\u00A0/g,' ').replace(/\s+/g,' ').trim(); }catch(e){}
    if(!text || text.length > 1000) return;

    const matches = [];
    function collect(re, type){
      const r = new RegExp(re.source, 'gi');
      let m;
      while((m = r.exec(text)) !== null){
        matches.push({ index: m.index, text: m[0], groups: m.slice(1), type });
      }
    }

    collect(CURRENCY_REGEX, 'currency');
    collect(CURRENCY_SYMBOL_REGEX, 'currency');
  collect(TEMP_REGEX, 'temp');
  collect(MEASUREMENT_REGEX, 'measurement');
    collect(TIME_REGEX, 'time');

    if(matches.length === 0) return;
    matches.sort((a,b)=>a.index - b.index);
    // filter overlaps
    const filtered = [];
    let lastEnd = -1;
    for(const m of matches){
      const end = m.index + m.text.length;
      if(m.index >= lastEnd){ filtered.push(m); lastEnd = end; }
    }

    // apply from last to first to keep indices valid
    for(let i = filtered.length - 1; i >= 0; i--){
      const m = filtered[i];
      const range = createRangeFromIndex(el, m.index, m.text.length);
      if(!range) continue;
      const span = document.createElement('span'); span.className = 'smart-detect'; span.textContent = m.text;

      if(m.type === 'currency'){
        let parts = m.text.match(/(\d+[\d,]*(?:\.\d+)?)\s?(USD|EUR|GBP|INR)/i);
  if(parts){ const amt = parseFloat(parts[1].replace(/,/g,'')); const unit = parts[2].toUpperCase(); attachHover(span, {type:'currency', amt, unit, target: prefs.currency}, (t)=>convertCurrency(t.amt, t.unit, prefs.currency)); }
        else{
          const sym = m.text.match(/(\$|₹|€|£)\s?([\d,]+(?:\.\d+)?)/);
          if(sym){ const symbol = sym[1]; const raw = sym[2].replace(/,/g,''); const amt = parseFloat(raw); const map = { '$':'USD', '€':'EUR', '£':'GBP', '₹':'INR' }; const unit = map[symbol]||'USD'; attachHover(span, {type:'currency', amt, unit, target: prefs.currency}, (t)=>convertCurrency(t.amt, t.unit, prefs.currency)); }
        }
  } else if(m.type === 'temp'){
    // parse with the robust TEMP_REGEX pattern (supports words like 'Celsius' and optional degree symbols)
    const parts = m.text.match(/(-?\d+(?:\.\d+)?)(?:\s*(?:°|\u00b0)?\s*(?:deg(?:rees)?)?)?\s*(?:°|\u00b0)?\s*(C|F|K|Celsius|Fahrenheit)/i);
  if(parts){ const raw = parts[1].replace(/,/g,''); const val = parseFloat(raw); let unit = (parts[2] || '').toUpperCase(); if(unit.startsWith('C')) unit = 'C'; else if(unit.startsWith('F')) unit = 'F'; else if(unit.startsWith('K')) unit = 'K'; attachHover(span, {type:'temp', val, unit, target: prefs.temperature}, (t)=>convertTemp(t.val, t.unit, prefs.temperature)); }
      } else if(m.type === 'time'){
        const parts = m.text.match(/(\d{1,2}):(\d{2})\s?(AM|PM)?\s?(PST|EST|CET|IST)/i);
  if(parts){ const hh = parseInt(parts[1],10); const mm = parseInt(parts[2],10); const ampm = parts[3]; const tz = parts[4].toUpperCase(); attachHover(span, {type:'time', hh, mm, ampm, tz, target: prefs.timezone}, (t)=>convertTime(t.hh, t.mm, t.ampm, t.tz, prefs.timezone)); }
      } else if(m.type === 'measurement'){
        const parts = m.text.match(/(-?\d+(?:\.\d+)?)(?:\s*)(cm|m|km|in|ft|yd|mi|g|kg|lb|oz|ml|l|gal)/i);
        if(parts){
          const val = parseFloat(parts[1].replace(/,/g,''));
          let unit = (parts[2] || '').toLowerCase().trim();
          // normalize common variants to keys used in convertMeasurement maps
          unit = unit.replace(/\^/g, '').replace(/\s+/g, ' ');
          if(unit === 'cubic m' || unit === 'cubic meter' || unit === 'cubic metre' || unit === 'm3' || unit === 'm3') unit = 'm3';
          if(unit === 'teaspoon') unit = 'tsp';
          if(unit === 'tablespoon') unit = 'tbsp';
          if(unit === 'tonne') unit = 't';
          if(unit === 'microgram') unit = 'mcg';
          // strip plural s
          unit = unit.replace(/s$/,'');
          const conv = convertMeasurement(val, unit, MEASUREMENT_PREF || prefs.measurement || 'Metric');
          if(conv){ const formatted = formatNumberForLocale(conv.val) + ' ' + conv.unit; attachHover(span, { type:'measurement', val, unit, conv }, ()=>formatted); }
        }
      }

      try{
        range.deleteContents();
        range.insertNode(span);
      }catch(e){
        // ignore
      }
    }
  }

  function processRoot(root, prefs){
    // If root itself has a shadowRoot, process it first
    if(root && root.shadowRoot) try{ processRoot(root.shadowRoot, prefs); }catch(e){}
    // Walk all elements under this root so we can detect nested shadow roots too
    try{
      const walker = (root.createTreeWalker) ? root.createTreeWalker(root.ELEMENT_NODE ? NodeFilter.SHOW_ELEMENT : Node.ELEMENT_NODE, null, false) : document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
      let node = walker.nextNode();
      while(node){
        try{ debugLog('processRoot: processing element', node.tagName, (node.className||'').toString().slice(0,60)); processElement(node, prefs); }catch(e){}
        // if element hosts a shadow root, process it recursively
        if(node.shadowRoot) try{ processRoot(node.shadowRoot, prefs); }catch(e){}
        node = walker.nextNode();
      }
    }catch(e){
      // fallback to querySelectorAll for broad selectors
      const selector = 'span, a, div, p, li, td, strong, em, small, b, i, .a-price, .a-offscreen, [id^="priceblock_"], .offer-price, .price';
      const els = (root.querySelectorAll) ? root.querySelectorAll(selector) : [];
      els.forEach(el => processElement(el, prefs));
    }
  }


  function loadAndRun(){
    chrome.storage.sync.get({ currency:'INR', temperature:'C', timezone:'IST' }, (prefs)=>{
      try{ walkAndAnnotate(document.body, prefs); }catch(e){ console.error(e); }
    });
  }

  // Detect split prices where currency symbol and numeric portions are separate sibling nodes
  function scanForSplitPrices(root, prefs){
  const SYMBOLS = ['$', '₹', '€', '£', '¥', 'A$', 'C$', 'S$', '元'];
  // candidate selector — include Amazon-specific price classes too
  const candidates = root.querySelectorAll('span, a, div, .a-price, .a-offscreen, [id^="priceblock_"], .offer-price, .price');
  debugLog('scanForSplitPrices: candidates found', candidates.length);
  candidates.forEach(el => {
      if(el.closest('script,style,textarea,input')) return;
      if(el.closest('.smart-detect')) return;
      // skip very long nodes
      if((el.innerText || '').length > 120) return;
      const childNodes = Array.from(el.childNodes);
      if(childNodes.length < 2) return;

      for(let i=0;i<childNodes.length-1;i++){
        const a = childNodes[i];
        const b = childNodes[i+1];
        if(!a || !b) continue;
        const aText = (a.textContent||'').trim();
        if(!aText) continue;
        // check if a looks like currency symbol
        const hasSymbol = SYMBOLS.some(s=> aText.includes(s));
        if(!hasSymbol) continue;

        // collect number-like text from following siblings
        let combined = '';
        let endIndex = -1;
        for(let j=i+1;j<childNodes.length && j<i+6;j++){
          const txt = (childNodes[j].textContent||'').trim();
          if(!txt) continue;
          // allow parts like '1,234' or '1' or '.99'
          if(/^[\d,]+(\.\d+)?$/.test(txt) || /^\.\d+$/.test(txt)){
            combined += (combined?'' : '') + txt;
            endIndex = j;
          } else if(/^[\d,.\s]+$/.test(txt) && /\d/.test(txt)){
            combined += txt.replace(/\s+/g,''); endIndex = j;
          } else {
            break;
          }
        }

        if(endIndex !== -1 && /\d/.test(combined)){
          // build full text
          const full = aText + (combined.startsWith('.')? combined : (' ' + combined));
          // create span and attach
          const span = document.createElement('span');
          span.className = 'smart-detect';
          span.textContent = full;
          // derive unit from symbol
          const symMatch = aText.match(/(\$|₹|€|£)/);
          const map = { '$':'USD', '€':'EUR', '£':'GBP', '₹':'INR', '¥':'JPY', 'A$':'AUD', 'C$':'CAD', 'S$':'SGD', '元':'CNY' };
          const unit = symMatch ? (map[symMatch[1]]||'USD') : 'USD';
          const amt = parseFloat(combined.replace(/,/g,''));
          attachHover(span, {type:'currency', amt, unit, target: prefs.currency}, (t)=>convertCurrency(t.amt, t.unit, prefs.currency));
          debugLog('scanForSplitPrices: replaced split price', { full, unit, amt });

          // replace range from a to childNodes[endIndex]
          try{
            const range = document.createRange();
            range.setStartBefore(a);
            range.setEndAfter(childNodes[endIndex]);
            range.deleteContents();
            range.insertNode(span);
          }catch(e){
            // fallback: simple replace of a and remove others
            try{
              a.parentNode.insertBefore(span, a);
              for(let k=i;k<=endIndex;k++){ if(childNodes[k] && childNodes[k].parentNode) childNodes[k].parentNode.removeChild(childNodes[k]); }
            }catch(err){ /* ignore */ }
          }

          // skip ahead
          i = endIndex;
        }
      }
    });
  }

  // initial
  // createTooltip and scans will be started after unit tokens are loaded below

  // Detect split temperatures where numeric and unit parts are in separate sibling nodes (e.g., '72' and '°F')
  function scanForSplitTemps(root, prefs){
    // localized / variant unit tokens to broaden language coverage
    // include common spellings and local words: English, Spanish, French, German, Portuguese, Italian
    const UNIT_TOKENS = [
      // Celsius variants
      'c', 'celsius', 'centigrade', 'cent edgrados', 'cent igrados', 'cent igrado', 'grado c', 'grados c', 'degres', 'degr[ée]s', 'celsius',
      // Fahrenheit variants
      'f', 'fahrenheit', 'fahrenheit', 'grado f', 'grados f',
      // Kelvin
      'k', 'kelvin'
    ];
    // build a regex to match any unit word/token (word boundary aware)
  // use pre-built unitRegex (dynamically loaded when available)

    // narrower selectors: focus on elements that commonly hold temperatures (classes/ids with temp/degree/weather) to reduce false positives
    const selectorList = [
      '.temp', '.temperature', '[class*="temp"]', '[id*="temp"]', '.degree', '.degrees', '[class*="degree"]',
      '.weather', '.forecast', '.wx', '.temperature__value', '.w-temperature', 'span', 'p', 'div', 'li', 'td'
    ];
    const candidates = root.querySelectorAll(selectorList.join(','));
    debugLog('scanForSplitTemps: candidates', candidates.length);
    candidates.forEach(el => {
      if(el.closest('script,style,textarea,input')) return;
      if(el.closest('.smart-detect')) return;
      if((el.innerText || '').length > 120) return;
      const childNodes = Array.from(el.childNodes);
      if(childNodes.length < 2) return;

      for(let i=0;i<childNodes.length-1;i++){
        const a = childNodes[i];
        const b = childNodes[i+1];
        if(!a || !b) continue;
        const aText = (a.textContent||'').trim();
        const bText = (b.textContent||'').trim();
        if(!aText || !bText) continue;
  // numeric then unit (unit may appear as a word like 'Celsius', 'grados', etc.)
  if(/^[-+]?\d+[\d,]*(?:\.\d+)?$/.test(aText) && unitRegex.test(bText)){
          const combined = aText + ' ' + bText;
          const span = document.createElement('span'); span.className = 'smart-detect'; span.textContent = combined;
          const parts = combined.match(/(-?\d+(?:\.\d+)?).*?(C|F|K|Celsius|Fahrenheit)/i);
          if(parts){ const val = parseFloat(parts[1].replace(/,/g,'')); let unit = (parts[2]||'').toUpperCase(); if(unit.startsWith('C')) unit = 'C'; else if(unit.startsWith('F')) unit = 'F'; else if(unit.startsWith('K')) unit = 'K'; attachHover(span, { type:'temp', val, unit, target: prefs.temperature }, (t)=>convertTemp(t.val, t.unit, prefs.temperature)); }
          try{
            const range = document.createRange(); range.setStartBefore(a); range.setEndAfter(b); range.deleteContents(); range.insertNode(span);
          }catch(e){ try{ a.parentNode.insertBefore(span, a); a.parentNode.removeChild(a); a.parentNode.removeChild(b); }catch(err){} }
          i++;
        }
      }
    });
  }
  // run split-temp scanner too
  chrome.storage.sync.get({ currency:'INR', temperature:'C', timezone:'IST' }, (prefs)=>{
    try{ scanForSplitTemps(document.body, prefs); }catch(e){ console.error(e); }
  });

  // load tokens and then start tooltip + scanning
  (async function loadUnitTokensAndStart(){
    try{
      const url = chrome.runtime.getURL('unit_tokens.json');
      const res = await fetch(url);
      if(res && res.ok){
        const data = await res.json();
        if(data && Array.isArray(data.units) && data.units.length){
          UNIT_TOKENS = data.units.slice();
          unitRegex = new RegExp('(?:' + UNIT_TOKENS.map(u => u.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')).join('|') + ')', 'i');
          debugLog('Loaded unit tokens', UNIT_TOKENS.slice(0,40));
        }
      }
    }catch(e){ debugLog('Failed to load unit tokens, using defaults', e); }

    // now start tooltip and scans
    createTooltip();
    loadAndRun();
    chrome.storage.sync.get({ currency:'INR', temperature:'C', timezone:'IST' }, (prefs)=>{
      try{ scanForSplitPrices(document.body, prefs); }catch(e){ console.error(e); }
    });
    chrome.storage.sync.get({ currency:'INR', temperature:'C', timezone:'IST' }, (prefs)=>{
      try{ scanForSplitTemps(document.body, prefs); }catch(e){ console.error(e); }
    });
  })();

  // listen for storage changes (fxRates or prefs) and re-run annotation on tabs
  try{
    if(window.chrome && chrome.storage && chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === 'function'){
      chrome.storage.onChanged.addListener((changes, area) => {
  const relevant = ['fxRates', 'ratesToINR', 'currency', 'temperature', 'timezone', 'showFormula'];
        const keys = Object.keys(changes || {});
        if(keys.some(k => relevant.includes(k))){
          // reload stored fxRates, showFormula, measurement prefs and number locale, then re-run full scan
          safeGetStorage({ ratesToINR: ratesToINR, fxRates: null, showFormula: true, measurement: 'Metric', numberLocale: 'auto' }, (items)=>{ if(items){ if(items.ratesToINR) ratesToINR = items.ratesToINR; if(items.fxRates) fxRates = items.fxRates; if(typeof items.showFormula !== 'undefined') SHOW_FORMULA = items.showFormula; if(items.measurement) MEASUREMENT_PREF = items.measurement; if(items.numberLocale) NUMBER_LOCALE = items.numberLocale; }
            // debounce a tiny bit to allow multiple storage changes to coalesce
            if(scheduledRun) clearTimeout(scheduledRun);
            scheduledRun = setTimeout(()=>{
              // remove existing annotations so new prefs will be applied
              try{ clearAnnotations(); }catch(e){ debugLog('clearAnnotations failed', e); }
              loadAndRun();
              try{ scanForSplitPrices(document.body, { currency: (changes.currency && changes.currency.newValue) || (changes.fxRates? (items.fxRates && items.fxRates.base) : undefined) || 'INR' }); }catch(e){};
              try{ scanForSplitTemps(document.body, { temperature: (changes.temperature && changes.temperature.newValue) || 'C' }); }catch(e){};
              scheduledRun = null;
            }, 200);
          });
        }
      });
    }
  }catch(e){ console.warn('Smart Converter: failed to attach storage listener', e); }

  // debounce scheduler to avoid frequent full re-scans
  let scheduledRun = null;
  function scheduleRun(delay = 250){
    if(scheduledRun) clearTimeout(scheduledRun);
    scheduledRun = setTimeout(()=>{ loadAndRun(); scheduledRun = null; }, delay);
  }

  // observe DOM changes
  const obs = new MutationObserver((m)=>{
    // schedule a debounced full-scan
    scheduleRun(300);
  });
  obs.observe(document.documentElement, { childList:true, subtree:true, characterData:false });

})();
