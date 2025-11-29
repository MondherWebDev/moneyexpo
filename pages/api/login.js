import jwt from "jsonwebtoken";

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { username, password } = req.body || {};
  const envUser = process.env.DASH_USER;
  const envPass = process.env.DASH_PASS;
  const secret = process.env.JWT_SECRET;

  if (!envUser || !envPass || !secret) {
    return res.status(500).json({ error: "Dashboard credentials not configured." });
  }

  if (username !== envUser || password !== envPass) {
    return res.status(401).json({ error: "Invalid credentials." });
  }

  const token = jwt.sign({ sub: envUser, role: "dashboard" }, secret, { expiresIn: "1d" });
  res.setHeader(
    "Set-Cookie",
    `auth_token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24}`
  );
  return res.status(200).json({ ok: true });
}
