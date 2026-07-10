/* Zero-dependency structured logging: one JSON line per event to
   stdout/stderr, so failures survive a host restart's log stream and
   stay greppable/filterable instead of scrolling by as free text. */

function line(level, event, context){
  return JSON.stringify(Object.assign({ level, ts: new Date().toISOString(), event }, context || {}));
}

export function logInfo(event, context){
  console.log(line('info', event, context));
}

export function logWarn(event, context){
  console.warn(line('warn', event, context));
}

export function logError(event, err, context){
  const errFields = err ? { errMessage: err.message, errStack: err.stack } : {};
  console.error(line('error', event, Object.assign({}, errFields, context)));
}
