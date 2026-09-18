import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { DbManager, CADENCE_MS } from "../../src/db/db_manager.js";

function makeTmpDbPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `db-manager-test-${name}-`));
  return path.join(dir, "test.db");
}

// A UTC timestamp landing at the given UTC hour, arbitrary fixed date.
function atUtcHour(hour) {
  return Date.UTC(2026, 0, 15, hour, 0, 0);
}

test("DbManager creates the db_maintenance table on construction", () => {
  const dbPath = makeTmpDbPath("schema");
  const manager = new DbManager({ dbPath });

  const row = manager.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'db_maintenance'")
    .get();
  assert.ok(row, "db_maintenance table should exist");

  manager.shutdown();
});

test("tick() runs a job on first tick, then withholds it until its cadence elapses", () => {
  const dbPath = makeTmpDbPath("cadence");
  let now = atUtcHour(10); // outside the low-traffic window; irrelevant here since job isn't window-gated
  let calls = 0;

  const manager = new DbManager({ dbPath, now: () => now });
  manager.registerJob({ name: "dailyJob", cadence: "daily", run: () => { calls += 1; } });

  manager.tick();
  assert.equal(calls, 1, "first tick should run a never-before-run job");

  now += 1000; // 1 second later, well within the daily cadence
  manager.tick();
  assert.equal(calls, 1, "should not re-run before cadence elapses");

  now += CADENCE_MS.daily;
  manager.tick();
  assert.equal(calls, 2, "should run again once cadence has elapsed");

  manager.shutdown();
});

test("lowTrafficWindowOnly jobs only run inside the configured UTC hour window", () => {
  const dbPath = makeTmpDbPath("window");
  let now = atUtcHour(10); // outside default 21-23 window
  let calls = 0;

  const manager = new DbManager({ dbPath, now: () => now });
  manager.registerJob({ name: "vacuumJob", cadence: "daily", lowTrafficWindowOnly: true, run: () => { calls += 1; } });

  manager.tick();
  assert.equal(calls, 0, "should not run outside the low-traffic window, even on first tick");

  now = atUtcHour(22); // inside default 21-23 window
  manager.tick();
  assert.equal(calls, 1, "should run once inside the low-traffic window");

  manager.shutdown();
});

test("last-run state survives across a restart (new DbManager instance, same file)", () => {
  const dbPath = makeTmpDbPath("restart");
  const t0 = atUtcHour(10);

  const first = new DbManager({ dbPath, now: () => t0 });
  let firstCalls = 0;
  first.registerJob({ name: "dailyJob", cadence: "daily", run: () => { firstCalls += 1; } });
  first.tick();
  assert.equal(firstCalls, 1);
  first.shutdown();

  // Simulated restart shortly after: a fresh instance against the same file
  // must see the persisted last_run_at and NOT re-run.
  const soonAfter = t0 + 1000;
  const second = new DbManager({ dbPath, now: () => soonAfter });
  let secondCalls = 0;
  second.registerJob({ name: "dailyJob", cadence: "daily", run: () => { secondCalls += 1; } });
  second.tick();
  assert.equal(secondCalls, 0, "fresh instance should honor the persisted last_run_at");
  second.shutdown();

  // A third instance, once the cadence has genuinely elapsed, should run again.
  const muchLater = t0 + CADENCE_MS.daily;
  const third = new DbManager({ dbPath, now: () => muchLater });
  let thirdCalls = 0;
  third.registerJob({ name: "dailyJob", cadence: "daily", run: () => { thirdCalls += 1; } });
  third.tick();
  assert.equal(thirdCalls, 1, "a stale last_run_at should allow the job to run again");
  third.shutdown();
});

test("vacuum() shrinks a bloated database file", () => {
  const dbPath = makeTmpDbPath("vacuum");
  const manager = new DbManager({ dbPath });

  manager.db.exec("CREATE TABLE bloat (data TEXT)");
  const insertStmt = manager.db.prepare("INSERT INTO bloat (data) VALUES (?)");
  const bigBlob = "x".repeat(10_000);
  const insertMany = manager.db.transaction((count) => {
    for (let i = 0; i < count; i += 1) insertStmt.run(bigBlob);
  });
  insertMany(500);
  manager.db.exec("DELETE FROM bloat");

  const sizeBefore = fs.statSync(dbPath).size;
  manager.vacuum();
  const sizeAfter = fs.statSync(dbPath).size;

  assert.ok(sizeAfter < sizeBefore * 0.5, `expected vacuum to shrink the file (${sizeBefore} -> ${sizeAfter})`);

  manager.shutdown();
});
