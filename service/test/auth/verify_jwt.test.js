import { test } from "node:test";
import assert from "node:assert/strict";

import jwt from "jsonwebtoken";

import { verifyAuth, extractSessionCookie } from "../../src/auth/verify_jwt.js";

const SECRET = "test-secret";

function makeReqRes(cookieHeader) {
  const req = { headers: cookieHeader ? { cookie: cookieHeader } : {} };
  const res = {};
  return { req, res };
}

test("extractSessionCookie finds the named cookie among several", () => {
  const header = "foo=bar; cs_session=abc123; other=xyz";
  assert.equal(extractSessionCookie({ headers: { cookie: header } }, "cs_session"), "abc123");
});

test("extractSessionCookie returns null when the cookie is absent", () => {
  assert.equal(extractSessionCookie({ headers: { cookie: "foo=bar" } }, "cs_session"), null);
});

test("extractSessionCookie returns null with no cookie header at all", () => {
  assert.equal(extractSessionCookie({ headers: {} }, "cs_session"), null);
});

test("verifyAuth sets req.userId from a valid token", () => {
  const token = jwt.sign({ sub: "user-1" }, SECRET, { algorithm: "HS256" });
  const { req, res } = makeReqRes(`cs_session=${token}`);
  let nextCalled = false;
  verifyAuth({ jwtSecret: SECRET })(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(req.userId, "user-1");
});

test("verifyAuth leaves req.userId null with no cookie", () => {
  const { req, res } = makeReqRes(null);
  let nextCalled = false;
  verifyAuth({ jwtSecret: SECRET })(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(req.userId, null);
});

test("verifyAuth leaves req.userId null for a tampered token and does not throw", () => {
  const { req, res } = makeReqRes("cs_session=not-a-real-jwt");
  let nextCalled = false;
  assert.doesNotThrow(() => {
    verifyAuth({ jwtSecret: SECRET })(req, res, () => {
      nextCalled = true;
    });
  });
  assert.equal(nextCalled, true);
  assert.equal(req.userId, null);
});

test("verifyAuth leaves req.userId null for an expired token", () => {
  const token = jwt.sign({ sub: "user-1" }, SECRET, { algorithm: "HS256", expiresIn: -10 });
  const { req, res } = makeReqRes(`cs_session=${token}`);
  verifyAuth({ jwtSecret: SECRET })(req, res, () => {});
  assert.equal(req.userId, null);
});

test("verifyAuth leaves req.userId null when signed with a different secret", () => {
  const token = jwt.sign({ sub: "user-1" }, "wrong-secret", { algorithm: "HS256" });
  const { req, res } = makeReqRes(`cs_session=${token}`);
  verifyAuth({ jwtSecret: SECRET })(req, res, () => {});
  assert.equal(req.userId, null);
});

test("verifyAuth is a no-op (never throws, req.userId null) when JWT_SECRET is unset", () => {
  const token = jwt.sign({ sub: "user-1" }, SECRET, { algorithm: "HS256" });
  const { req, res } = makeReqRes(`cs_session=${token}`);
  verifyAuth({ jwtSecret: "" })(req, res, () => {});
  assert.equal(req.userId, null);
});
