const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function getLevel() {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

function toRecord(level, message, fields) {
  const record = {
    ts: new Date().toISOString(),
    level,
    message,
  };
  if (fields && typeof fields === "object") {
    Object.assign(record, fields);
  }
  return record;
}

function emit(level, message, fields) {
  const min = getLevel();
  if (LEVELS[level] > min) return;
  const payload = JSON.stringify(toRecord(level, message, fields));
  if (level === "error") {
    console.error(payload);
  } else {
    console.log(payload);
  }
}

export const log = {
  error(message, fields) {
    emit("error", message, fields);
  },
  warn(message, fields) {
    emit("warn", message, fields);
  },
  info(message, fields) {
    emit("info", message, fields);
  },
  debug(message, fields) {
    emit("debug", message, fields);
  },
};

export function maskKey(value) {
  if (!value) return "";
  const str = String(value);
  if (str.length <= 6) return "***";
  return `${str.slice(0, 4)}...${str.slice(-2)}`;
}

export function summarize(value, maxLen = 800) {
  try {
    const seen = new WeakSet();
    const json = JSON.stringify(
      value,
      (key, val) => {
        if (typeof val === "string") {
          return val.length > 200 ? `${val.slice(0, 200)}…` : val;
        }
        if (Array.isArray(val)) {
          if (val.length > 20) {
            return [...val.slice(0, 20), `…(${val.length - 20} more)`];
          }
          return val;
        }
        if (val && typeof val === "object") {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        return val;
      },
      2
    );
    return json.length > maxLen ? `${json.slice(0, maxLen)}…` : json;
  } catch (err) {
    return `<<unserializable:${err?.message || String(err)}>>`;
  }
}
