import { useState } from "react";
import Head from "next/head";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const redirectTo = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("from") || "/" : "/";

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error || "Login failed");
      }
      window.location.href = redirectTo;
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Login | MEQ2025 Badge Control</title>
      </Head>
      <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-[#0c0a1f] via-[#0a0a1a] to-[#131230] text-white">
        <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-2xl shadow-2xl p-6 backdrop-blur">
          <div className="flex items-center gap-3 mb-4">
            <img src="/MoneyExpo.jpeg" alt="Money Expo" className="w-16 rounded-xl shadow-lg ring-2 ring-white/10" />
            <div>
              <p className="uppercase tracking-[0.16em] font-bold text-aqua text-xs mb-1">MEQ2025</p>
              <h1 className="text-xl font-bold m-0">Badge Control Login</h1>
              <p className="text-white/60 text-sm m-0">Access the dashboard and check-in tools.</p>
            </div>
          </div>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-white/80">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-xl px-3 py-2 bg-white text-textmain border border-black/10 text-sm"
                placeholder="Enter username"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-white/80">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl px-3 py-2 bg-white text-textmain border border-black/10 text-sm"
                placeholder="Enter password"
                required
              />
            </div>
            {error && <p className="text-sm text-rose-300">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 mt-1 rounded-xl bg-gradient-to-r from-magenta to-violet text-white font-semibold shadow-lg hover:-translate-y-[1px] transition disabled:opacity-60"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
