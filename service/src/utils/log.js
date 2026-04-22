import fs from "node:fs";
import path from "node:path";

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  verbose: 3,
  debug: 4,
};

let sinkState = {
  logsDir: null,
  infoStream: null,
  verboseStream: null,
  reportedError: false,
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
  const payload = `${JSON.stringify(toRecord(level, message, fields))}\n`;
  if (LEVELS[level] <= getLevel()) {
    if (level === "error") {
      console.error(payload.trimEnd());
    } else {
      console.log(payload.trimEnd());
    }
  }
  writeToFiles(level, payload);
}

function writeToFiles(level, payload) {
  const sinks = getFileSinks();
  if (!sinks) return;
  if (LEVELS[level] <= LEVELS.info) {
    sinks.infoStream.write(payload);
  }
  if (LEVELS[level] <= LEVELS.verbose) {
    sinks.verboseStream.write(payload);
  }
}

function getFileSinks() {
  const logsDir = String(process.env.LOGS_DIR || "").trim();
  if (!logsDir) {
    const previousSinks = detachCurrentSinks();
    if (previousSinks.infoStream) previousSinks.infoStream.end();
    if (previousSinks.verboseStream) previousSinks.verboseStream.end();
    return null;
  }
  if (sinkState.logsDir === logsDir && sinkState.infoStream && sinkState.verboseStream) {
    return sinkState;
  }

  const previousSinks = detachCurrentSinks();
  if (previousSinks.infoStream) previousSinks.infoStream.end();
  if (previousSinks.verboseStream) previousSinks.verboseStream.end();
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const infoStream = fs.createWriteStream(path.join(logsDir, "info.log"), {
      flags: "a",
      encoding: "utf8",
    });
    const verboseStream = fs.createWriteStream(path.join(logsDir, "verbose.log"), {
      flags: "a",
      encoding: "utf8",
    });
    infoStream.on("error", (err) => reportFileError(logsDir, err));
    verboseStream.on("error", (err) => reportFileError(logsDir, err));
    sinkState = {
      logsDir,
      infoStream,
      verboseStream,
      reportedError: false,
    };
    return sinkState;
  } catch (err) {
    reportFileError(logsDir, err);
    return null;
  }
}

function detachCurrentSinks() {
  const current = sinkState;
  sinkState = {
    logsDir: null,
    infoStream: null,
    verboseStream: null,
    reportedError: false,
  };
  return current;
}

function reportFileError(logsDir, err) {
  if (sinkState.reportedError) return;
  sinkState.reportedError = true;
  const payload = JSON.stringify(
    toRecord("error", "log_file_write_failed", {
      logsDir,
      error: err?.message || String(err),
    })
  );
  console.error(payload);
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

export async function resetLogStateForTest() {
  const { infoStream, verboseStream } = detachCurrentSinks();
  await Promise.all([closeStream(infoStream), closeStream(verboseStream)]);
}

function closeStream(stream) {
  if (!stream) return Promise.resolve();
  return new Promise((resolve) => stream.end(resolve));
}

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
