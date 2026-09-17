import { parse as parseCookies } from "cookie";
import jwt from "jsonwebtoken";

const DEFAULT_COOKIE_NAME = "cs_session";

// Same cookie name/secret as cataloguesearch's auth_api.py -- this service
// only verifies tokens, it never issues them (auth/identity lives there).
// Uses the `cookie` package (already an indirect dependency via express, now
// explicit) rather than hand-parsing, since it correctly handles quoted
// values and stray `=` characters a naive split/indexOf wouldn't.
export function extractSessionCookie(req, cookieName = DEFAULT_COOKIE_NAME) {
  const header = req.headers?.cookie;
  if (!header) return null;
  try {
    return parseCookies(header)[cookieName] ?? null;
  } catch {
    // Malformed cookie header -- treat as "no cookie" rather than letting an
    // error escape this globally-mounted middleware and 500 every request
    // that carries it, including unrelated anonymous routes. Soft auth means
    // a bad cookie degrades to anonymous, same as an invalid/expired JWT
    // does below.
    return null;
  }
}

// Soft auth: never blocks the request -- login isn't mandatory to chat, so a
// missing or invalid token just leaves req.userId null (anonymous), while a
// valid one attaches the real user id for routes that care about ownership.
export function verifyAuth(options = {}) {
  const jwtSecret = String(options.jwtSecret ?? process.env.JWT_SECRET ?? "").trim();
  const cookieName = options.cookieName ?? DEFAULT_COOKIE_NAME;

  return function verifyAuthMiddleware(req, _res, next) {
    req.userId = null;
    const token = extractSessionCookie(req, cookieName);
    if (token && jwtSecret) {
      try {
        const payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
        if (payload?.sub) {
          req.userId = String(payload.sub);
        }
      } catch {
        // Invalid/expired -- treated as anonymous, not an error.
      }
    }
    next();
  };
}
