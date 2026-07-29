/* Shared busy / re-entry guard for async UI actions.
   Classic script: function declarations are globals for admin-*.js and app.js.
   Sync early return (undefined) on missing/busy el; Promise when work runs. */

function isBusy(el){
  return !!(el && el.dataset && el.dataset.busy === '1');
}

function _busyIsNativeDisableable(el){
  if(!el || !el.tagName) return false;
  const t = el.tagName;
  return t === 'BUTTON' || t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA';
}

function withBusy(el, fn){
  if(!el || isBusy(el)) return;
  el.dataset.busy = '1';
  el.classList.add('is-busy');
  el.setAttribute('aria-busy', 'true');
  const native = _busyIsNativeDisableable(el);
  let prevDisabled = false;
  if(native){
    prevDisabled = !!el.disabled;
    el.disabled = true;
  }else{
    el.setAttribute('aria-disabled', 'true');
  }
  return (async () => {
    try{
      return await fn();
    }finally{
      if(!el.isConnected) return;
      delete el.dataset.busy;
      el.classList.remove('is-busy');
      el.removeAttribute('aria-busy');
      if(native) el.disabled = prevDisabled;
      else el.removeAttribute('aria-disabled');
    }
  })();
}
