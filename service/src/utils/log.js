import fs from "node:fs";
import path from "node:path";

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  verbose: 3,
  debug: 4,
};

let streamsInitialized = false;
let fileStreams = {
  info: null,
  verbose: null,
};

function getLevel() {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

function getLogsDir() {
  const raw = String(process.env.LOGS_DIR || "").trim();
  return raw || null;
}

function shouldEmit(level, threshold) {
  return LEVELS[level] <= threshold;
}

function reportFileLogError(target, err) {
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    level: "error",
    message: "log_file_write_failed",
    target,
    error: err?.message || String(err),
  });
  console.error(payload);
}

function attachErrorHandler(stream, target) {
  stream.on("error", (err) => reportFileLogError(target, err));
}

function ensureFileStreams() {
  if (streamsInitialized) return fileStreams;
  streamsInitialized = true;

  const logsDir = getLogsDir();
  if (!logsDir) return fileStreams;

  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fileStreams = {
      info: fs.createWriteStream(path.join(logsDir, "info.log"), { flags: "a" }),
      verbose: fs.createWriteStream(path.join(logsDir, "verbose.log"), { flags: "a" }),
    };
    attachErrorHandler(fileStreams.info, "info.log");
    attachErrorHandler(fileStreams.verbose, "verbose.log");
  } catch (err) {
    reportFileLogError(logsDir, err);
    fileStreams = { info: null, verbose: null };
  }

  return fileStreams;
}

function toRecord(level, message, fields) {
  const record = {
    ts: new Date().toISOString(),
    level,
    message,
  };
  if (fields && typeof fields === "object") {
    for (const [key, value] of Object.entries(fields)) {
      if (key === "message") {
        record.detail = value;
        continue;
      }
      if (key === "level" || key === "ts") {
        record[`field_${key}`] = value;
        continue;
      }
      record[key] = value;
    }
  }
  return record;
}

function emit(level, message, fields) {
  const record = toRecord(level, message, fields);
  const payload = `${JSON.stringify(record)}\n`;

  if (shouldEmit(level, getLevel())) {
    if (level === "error") {
      console.error(payload.trimEnd());
    } else {
      console.log(payload.trimEnd());
    }
  }

  const streams = ensureFileStreams();
  if (streams.info && shouldEmit(level, LEVELS.info)) {
    streams.info.write(payload);
  }
  if (streams.verbose && shouldEmit(level, LEVELS.verbose)) {
    streams.verbose.write(payload);
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
  verbose(message, fields) {
    emit("verbose", message, fields);
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
