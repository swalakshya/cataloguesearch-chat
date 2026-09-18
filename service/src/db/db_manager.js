import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { log } from "../utils/log.js";

export const CADENCE_MS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

const TICK_MS = 60 * 60 * 1000; // hourly

// Runs named maintenance jobs (prune, VACUUM, ...) against a single SQLite
// file on a daily/weekly cadence, from inside the running service rather
// than host cron. Last-run state is persisted in the DB itself so cadence
// survives a redeploy -- a naive setInterval/sleep loop would drift or
// double/skip-run jobs across restarts.
export class DbManager {
  constructor({
    dbPath,
    tickMs = TICK_MS,
    now = () => Date.now(),
    lowTrafficStartHour = Number(process.env.DB_MAINTENANCE_LOW_TRAFFIC_START_HOUR ?? 21),
    lowTrafficEndHour = Number(process.env.DB_MAINTENANCE_LOW_TRAFFIC_END_HOUR ?? 23),
  }) {
    this.dbPath = String(dbPath || "").trim();
    if (!this.dbPath) throw new Error("dbPath required for DbManager");

    this.tickMs = tickMs;
    this.now = now;
    this.lowTrafficStartHour = lowTrafficStartHour;
    this.lowTrafficEndHour = lowTrafficEndHour;
    this.jobs = [];
    this.timer = null;

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS db_maintenance (
        job_name    TEXT PRIMARY KEY,
        last_run_at INTEGER NOT NULL
      );
    `);

    this.getLastRunStmt = this.db.prepare(`SELECT last_run_at FROM db_maintenance WHERE job_name = ?`);
    this.setLastRunStmt = this.db.prepare(`
      INSERT INTO db_maintenance (job_name, last_run_at) VALUES (?, ?)
      ON CONFLICT(job_name) DO UPDATE SET last_run_at = excluded.last_run_at
    `);
  }

  registerJob({ name, cadence, run, lowTrafficWindowOnly = false }) {
    if (!CADENCE_MS[cadence]) throw new Error(`unknown cadence: ${cadence}`);
    this.jobs.push({ name, cadence, run, lowTrafficWindowOnly });
  }

  vacuum() {
    this.db.exec("VACUUM");
  }

  isInLowTrafficWindow(nowMs) {
    const hour = new Date(nowMs).getUTCHours();
    return hour >= this.lowTrafficStartHour && hour < this.lowTrafficEndHour;
  }

  shouldRun(job, nowMs) {
    if (job.lowTrafficWindowOnly && !this.isInLowTrafficWindow(nowMs)) return false;
    const row = this.getLastRunStmt.get(job.name);
    if (!row) return true;
    return nowMs - row.last_run_at >= CADENCE_MS[job.cadence];
  }

  runJob(job, nowMs) {
    try {
      job.run();
      this.setLastRunStmt.run(job.name, nowMs);
      log.info("db_maintenance_job_ran", { job: job.name });
    } catch (err) {
      log.error("db_maintenance_job_failed", { job: job.name, error: err?.message || String(err) });
    }
  }

  tick() {
    const nowMs = this.now();
    for (const job of this.jobs) {
      if (this.shouldRun(job, nowMs)) this.runJob(job, nowMs);
    }
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  shutdown() {
    if (this.timer) clearInterval(this.timer);
    this.db.close();
  }
}
