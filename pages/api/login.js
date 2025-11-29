import jwt from "jsonwebtoken";

function parseUsers() {
  const raw = process.env.USERS_JSON;
  try {
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((u) => ({ u: u.u || u.username, p: u.p || u.password }))
          .filter((u) => u.u && u.p);
      }
    }
  } catch (_) {
    /* ignore malformed JSON */
  }
  // Fallback to single user env if provided
  if (process.env.DASH_USER && process.env.DASH_PASS) {
    return [{ u: process.env.DASH_USER, p: process.env.DASH_PASS }];
  }
  return [];
}

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { username, password } = req.body || {};
  const secret = process.env.JWT_SECRET;
  const users = parseUsers();

  if (!secret || users.length === 0) {
    return res.status(500).json({ error: "Dashboard credentials not configured." });
  }

  const match = users.find((u) => u.u === username && u.p === password);
  if (!match) {
    return res.status(401).json({ error: "Invalid credentials." });
  }

  const token = jwt.sign({ sub: match.u, role: "dashboard" }, secret, { expiresIn: "1d" });
  res.setHeader(
    "Set-Cookie",
    `auth_token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24}`
  );
  return res.status(200).json({ ok: true });
}
