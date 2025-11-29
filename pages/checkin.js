import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import { getOfflineCache, getCheckinsCache, saveCheckinsCache } from "../lib/db";
import jsQR from "jsqr";

const defaultBase = "https://moneyexpoglobal.com";
const defaultToken = "f9c8ad6db3f6aabf2744f416623bd55f8c4b91b3";
// Relative proxy to work across preview domains
const defaultProxy = "/api/proxy?url=";

export default function Checkin() {
  const [base, setBase] = useState(defaultBase);
  const [token, setToken] = useState(defaultToken);
  const [proxy, setProxy] = useState(defaultProxy);
  const [record, setRecord] = useState(null);
  const [statusMsg, setStatusMsg] = useState("Ready.");
  const [tone, setTone] = useState("muted");
  const [checkins, setCheckins] = useState({});
  const [offline, setOffline] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState("");
  const [scanMsg, setScanMsg] = useState("Tap start camera to scan QR.");
  const [scanTone, setScanTone] = useState("muted");
  const [installPrompt, setInstallPrompt] = useState(null);
  const [iosHint, setIosHint] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const saved = JSON.parse(localStorage.getItem("badgeSettings") || "{}");
        const savedBase = saved.base && saved.base.trim() ? saved.base : defaultBase;
        const savedToken = saved.token && saved.token.trim() ? saved.token : defaultToken;
        const rawProxy = saved.proxy && saved.proxy.trim();
        const savedProxy =
          rawProxy && !rawProxy.toLowerCase().includes("netlify") ? rawProxy : defaultProxy;
        setBase(savedBase);
        setToken(savedToken);
        setProxy(savedProxy);
      } catch (_) {}
      try {
        const storedCheck = await getCheckinsCache();
        setCheckins(storedCheck && typeof storedCheck === "object" ? storedCheck : {});
      } catch (_) {}
      try {
        const storedOffline = await getOfflineCache();
        setOffline(Array.isArray(storedOffline) ? storedOffline : []);
      } catch (_) {}
    })();
  }, []);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
    const isIos = /iphone|ipad|ipod/.test(ua);
    const isStandalone = typeof navigator !== "undefined" ? navigator.standalone : false;
    if (isIos && !isStandalone) setIosHint(true);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function setStatus(msg, t = "muted") {
    setStatusMsg(msg);
    setTone(t);
  }

  function authHeader() {
    const trimmed = token.trim();
    if (!trimmed) throw new Error("Add the bearer token first.");
    return { Authorization: `Bearer ${trimmed}` };
  }

  function buildUrl(path) {
    const clean = base.trim().replace(/\/$/, "");
    if (!clean) throw new Error("Add the API base URL first.");
    return path.startsWith("/") ? `${clean}${path}` : `${clean}/${path}`;
  }

  async function apiGet(path) {
    const url = buildUrl(path);
    const target = proxy ? `${proxy}${encodeURIComponent(url)}` : url;
    const res = await fetch(target, {
      method: "GET",
      cache: "no-store",
      headers: {
        ...authHeader(),
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
    const text = await res.text();
    const data = safeJson(text);
    if (!res.ok) throw new Error(`GET ${path} failed (${res.status}): ${text.slice(0, 140)}`);
    return data;
  }

  function normalizeRecords(payload) {
    if (!payload) return [];
    const candidates = [
      payload,
      payload.data,
      payload.data?.data,
      payload.data?.records,
      payload.data?.data?.records,
      payload.visitors,
      payload.result,
      payload.records,
    ];

    function findArray(node, depth = 0) {
      if (!node || depth > 4) return null;
      if (Array.isArray(node)) return node;
      if (typeof node !== "object") return null;
      for (const val of Object.values(node)) {
        const found = findArray(val, depth + 1);
        if (found) return found;
      }
      return null;
    }

    const foundArray = candidates.find((c) => Array.isArray(c)) || findArray(payload);
    if (foundArray) {
      return foundArray.map(normalizeRecord).filter((r) => r.id);
    }
    const obj = payload?.data || payload;
    return [obj].map(normalizeRecord).filter((r) => r.id);
  }

  function normalizeRecord(raw) {
    const id =
      raw.attendee_id ||
      raw.attendeeId ||
      raw.id ||
      raw.registration_id ||
      raw.ticket_id ||
      raw.uuid ||
      raw.code ||
      raw.attendee?.id;
    const country = raw.country || raw.country_name || raw.nationality || raw.city || raw.attendee?.country || "";
    const name =
      raw.full_name ||
      raw.name ||
      raw.attendee?.full_name ||
      `${raw.first_name || ""} ${raw.last_name || ""}`.trim() ||
      raw.email ||
      "Unknown";
    const company = raw.company_name || raw.company || raw.organization || raw.organisation || raw.brand || "Unknown";
    const email = raw.email || raw.work_email || raw.contact_email || "";
    const status = String(raw.badge_status || raw.status || "PENDING").toUpperCase();
    const qrValue = raw.qr_value || raw.qr || id || email || name;
    const category =
      raw.category ||
      raw.sub_title ||
      raw.subTitle ||
      raw.title ||
      raw.type ||
      raw.role ||
      "VISITOR";
    return {
      raw,
      id: String(id || ""),
      name,
      company,
      email,
      status,
      qrValue,
      category: String(category || "").toUpperCase(),
      country,
    };
  }

  async function lookupRecord(termValue) {
    const t = termValue.trim();
    if (!t) {
      setStatus("Enter a code/email to lookup.", "error");
      return null;
    }
    setStatus("Looking up...");
    const payload = await apiGet(`/api/qatar/get-attendee-data?search_term=${encodeURIComponent(t)}`);
    const list = normalizeRecords(payload);
    const offlineMatches = filterOffline(t, offline);
    const merged = mergeRecords([...list, ...offlineMatches]);
    const first = merged[0];
    setRecord(first || null);
    setStatus(first ? "Ready to check-in/out." : "Not found.", first ? "muted" : "error");
    return first || null;
  }

  function handleCheck(status, recOverride) {
    const target = recOverride || record;
    if (!target || !target.id) {
      setStatus("Load a record first.", "error");
      return;
    }
    const time = formatTimestamp(new Date());
    const next = { ...checkins, [target.id]: { status, time } };
    setCheckins(next);
    saveCheckinsCache(next);
    setStatus(`${target.name || target.id} ${status === "IN" ? "checked in" : "checked out"}.`);
  }

  async function handleScannedPayload(value) {
    const payload = (value || "").trim();
    setLastScan(payload);
    try {
      const rec = await lookupRecord(payload);
      if (!rec) {
        setStatus("No record found for scanned code.", "error");
        setScanMsg("No record found.");
        setScanTone("error");
        setTimeout(() => {
          if (!scanning) startScan();
        }, 800);
        return;
      }
      const current = checkins[rec.id]?.status;
      const nextStatus = current === "IN" ? "OUT" : "IN";
      handleCheck(nextStatus, rec);
      setStatus(`Scanned ${rec.name || rec.id} (${nextStatus === "IN" ? "checked in" : "checked out"}).`, "muted");
      setScanMsg(`${rec.name || rec.id} ${nextStatus === "IN" ? "checked in" : "checked out"}.`);
      setScanTone("success");
      setTimeout(() => {
        if (!scanning) startScan();
      }, 800);
    } catch (err) {
      setStatus(err.message, "error");
      setScanMsg(err.message || "Scan failed");
      setScanTone("error");
      setTimeout(() => {
        if (!scanning) startScan();
      }, 1200);
    }
  }

  async function startScan() {
    if (scanning) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true");
        videoRef.current.setAttribute("autoplay", "true");
        videoRef.current.setAttribute("muted", "true");
        await videoRef.current.play();
      }
      setScanning(true);
      setScanMsg("Scanning... point camera at QR");
      setScanTone("muted");
      scanFrame();
      setStatus("Scanning... point camera at QR.", "muted");
    } catch (err) {
      setStatus(`Camera error: ${err.message}`, "error");
      setScanMsg(`Camera error: ${err.message}`);
      setScanTone("error");
    }
  }

  function stopScan() {
    setScanning(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (rafRef.current) rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function scanFrame() {
    if (!scanning) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const code = jsQR(imageData.data, w, h, { inversionAttempts: "attemptBoth" });
    if (code && code.data) {
      stopScan();
      handleScannedPayload(code.data);
      // Clear overlay before returning
      ctx.clearRect(0, 0, w, h);
      return;
    }

    // Draw a simple guide frame to help aim at the QR
    ctx.strokeStyle = "#4dd9c8";
    ctx.lineWidth = 4;
    const frameSize = Math.min(w, h) * 0.4;
    const fx = (w - frameSize) / 2;
    const fy = (h - frameSize) / 2;
    ctx.strokeRect(fx, fy, frameSize, frameSize);

    rafRef.current = requestAnimationFrame(scanFrame);
  }

  return (
    <>
      <Head>
        <title>MEQ2025 Check-in</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-gradient-to-b from-[#0c0a1f] via-[#0a0a1a] to-[#0a0a18] text-white px-4 py-8">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          <div className="bg-navy2 border border-white/10 rounded-2xl p-5 shadow-xl">
            <p className="uppercase tracking-[0.14em] text-aqua font-semibold text-sm mb-1">MEQ2025</p>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold mb-1">Check-in / Check-out</h2>
                <p className="text-white/70 text-sm">
                  Use visitor QR for lead capture + check-in/out. Other categories: QR for check-in/out only.
                </p>
              </div>
              <button
                onClick={async () => {
                  await fetch("/api/logout", { method: "POST" });
                  window.location.href = "/login";
                }}
                className="bg-white/15 text-white font-semibold rounded-xl px-4 py-2 border border-white/30 hover:bg-white/20 transition h-10"
              >
                Logout
              </button>
            </div>
          </div>

          <section className="bg-navy2 border border-white/10 rounded-2xl p-5 shadow-xl flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm text-white/80 m-0">Camera scan (first scan = check-in, second scan = check-out)</p>
                <p className="text-xs text-white/60 m-0">Point the rear camera at the badge QR.</p>
              </div>
              <div className="flex gap-2">
                <button
                  className="bg-gradient-to-r from-magenta to-violet text-white font-semibold rounded-xl px-4 py-2 shadow disabled:opacity-60"
                  onClick={startScan}
                  disabled={scanning}
                >
                  Start camera
                </button>
                <button
                  className="bg-white/10 text-white font-semibold rounded-xl px-4 py-2 border border-white/20 disabled:opacity-60"
                  onClick={stopScan}
                  disabled={!scanning}
                >
                  Stop
                </button>
              </div>
            </div>
            <div className="bg-black/30 border border-white/10 rounded-2xl p-3 relative overflow-hidden">
              <video
                ref={videoRef}
                className="w-full rounded-xl bg-black/40 border border-white/10"
                style={{ display: scanning ? "block" : "none" }}
                playsInline
                muted
              />
              <canvas ref={canvasRef} style={{ display: "none" }} />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="border-4 border-aqua/80 rounded-xl w-2/3 max-w-[260px] aspect-square animate-pulse"></div>
              </div>
              {scanning && (
                <div className="mt-2 text-xs text-white/70 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-aqua animate-ping"></span>
                  <span>{scanMsg}</span>
                </div>
              )}
              {!scanning && (
                <div className="mt-2 text-xs text-rose-200">{scanMsg}</div>
              )}
              <p className="text-xs text-white/60 mt-2">
                If the attendee was already IN, the scan will mark them OUT automatically.
              </p>
              {lastScan && (
                <p className="text-xs text-white/60 mt-1">Last scanned payload: {lastScan}</p>
              )}
            </div>
          </section>

          {(installPrompt || iosHint) && (
            <section className="bg-navy2 border border-white/10 rounded-2xl p-4 shadow">
              {installPrompt && (
                <button
                  className="bg-gradient-to-r from-magenta to-violet text-white font-semibold rounded-xl px-4 py-2 shadow"
                  onClick={async () => {
                    installPrompt.prompt();
                    await installPrompt.userChoice;
                    setInstallPrompt(null);
                  }}
                >
                  Install app
                </button>
              )}
              {iosHint && <p className="text-sm text-white/70 mt-2">On iPhone: tap Share ? Add to Home Screen to install.</p>}
            </section>
          )}

          <section className="bg-white text-textmain rounded-2xl shadow p-4">
            {record ? (
              <>
                <h3 className="text-xl font-semibold mb-1">{record.name}</h3>
                <p className="text-slate-600 m-0">{record.company}</p>
                <p className="text-slate-600 m-0">ID: {record.id}</p>
                <p className="text-slate-600 m-0">Category: {record.category || "VISITOR"}</p>
                <p className="text-slate-600 m-0">Status: {record.status}</p>
                <p className="text-slate-600 m-0">
                  Check state: {checkins[record.id]?.status || "Not checked"} {checkins[record.id]?.time || ""}
                </p>
                <div className="flex gap-2 mt-3">
                  <button className="bg-gradient-to-r from-magenta to-violet text-white font-semibold rounded-xl px-4 py-2 shadow" onClick={() => handleCheck("IN")}>
                    Check-in
                  </button>
                  <button className="bg-white text-navy font-semibold rounded-xl px-4 py-2 border border-navy shadow-sm" onClick={() => handleCheck("OUT")}>
                    Check-out
                  </button>
                </div>
              </>
            ) : (
              <p className="text-slate-600 m-0">No record loaded yet.</p>
            )}
            <p className={`text-sm mt-3 ${tone === "error" ? "text-rose-600" : "text-emerald-700"}`}>{statusMsg}</p>
          </section>
        </div>
      </div>
    </>
  );
}

function mergeRecords(list) {
  const map = new Map();
  list.forEach((item) => {
    if (!item || !item.id) return;
    const existing = map.get(item.id) || {};
    map.set(item.id, { ...existing, ...item });
  });
  return Array.from(map.values());
}

function filterOffline(term, records) {
  const t = term.toLowerCase();
  return records.filter(
    (v) =>
      v.id.toLowerCase().includes(t) ||
      (v.email && v.email.toLowerCase().includes(t)) ||
      (v.name && v.name.toLowerCase().includes(t))
  );
}

function safeJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch (_) {
    return { raw: text };
  }
}

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}
