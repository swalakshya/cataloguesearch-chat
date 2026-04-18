/**
 * Serializes integration test files so they don't run concurrently against
 * the shared test service. Each test file calls acquireIntegrationLock() in
 * its `before` hook and calls the returned release function in its `after` hook.
 *
 * Node's test runner executes test files in parallel by default. Without this
 * lock, concurrent files would race on shared service state (sessions, model
 * availability, test-provider behaviors), causing flaky failures.
 */

let tail = Promise.resolve();

export async function acquireIntegrationLock() {
  let release;
  const next = new Promise((resolve) => {
    release = resolve;
  });
  const waitForPrevious = tail;
  tail = tail.then(() => next);
  await waitForPrevious;
  return release;
}
