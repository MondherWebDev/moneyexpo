import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import { getOfflineCache, getCheckinsCache, saveCheckinsCache } from "../lib/db";

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
    const rawList = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.visitors)
      ? payload.visitors
      : Array.isArray(payload.result)
      ? payload.result
      : payload.data && Array.isArray(payload.data.records)
      ? payload.data.records
      : [payload];
    return rawList.map(normalizeRecord).filter((r) => r.id);
  }

  function normalizeRecord(raw) {
    const id =
      raw.attendee_id ||
      raw.attendeeId ||
      raw.id ||
      raw.registration_id ||
      raw.ticket_id ||
      raw.uuid ||
      raw.code;
    const name =
      raw.full_name ||
      raw.name ||
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
    return { raw, id: String(id || ""), name, company, email, status, qrValue, category: String(category || "").toUpperCase() };
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
    try {
      const rec = await lookupRecord(value);
      if (!rec) return;
      const current = checkins[rec.id]?.status;
      const nextStatus = current === "IN" ? "OUT" : "IN";
      handleCheck(nextStatus, rec);
    } catch (err) {
      setStatus(err.message, "error");
    }
  }

  async function startScan() {
    if (scanning) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      scanFrame();
      setStatus("Scanning... point camera at QR.", "muted");
    } catch (err) {
      setStatus(`Camera error: ${err.message}`, "error");
    }
  }

  function stopScan() {
    setScanning(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
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
    const qrLib = typeof window !== "undefined" ? window.jsQR : null;
    if (!qrLib) {
      setStatus("Scanner not ready. Please try again.", "error");
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    const code = qrLib(imageData.data, w, h);
    if (code && code.data) {
      stopScan();
      handleScannedPayload(code.data);
      return;
    }
    rafRef.current = requestAnimationFrame(scanFrame);
  }

  return (
    <>
      <Head>
        <title>MEQ2025 Check-in</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"></script>
      </Head>
      <div className="min-h-screen bg-gradient-to-b from-[#0c0a1f] via-[#0a0a1a] to-[#0a0a18] text-white px-4 py-8">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          <div className="bg-navy2 border border-white/10 rounded-2xl p-5 shadow-xl">
            <p className="uppercase tracking-[0.14em] text-aqua font-semibold text-sm mb-1">MEQ2025</p>
            <h2 className="text-2xl font-bold mb-1">Check-in / Check-out</h2>
            <p className="text-white/70 text-sm">
              Use visitor QR for lead capture + check-in/out. Other categories: QR for check-in/out only.
            </p>
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
            <div className="bg-black/30 border border-white/10 rounded-2xl p-3">
              <video
                ref={videoRef}
                className="w-full rounded-xl bg-black/40 border border-white/10"
                style={{ display: scanning ? "block" : "none" }}
                playsInline
                muted
              />
              <canvas ref={canvasRef} style={{ display: "none" }} />
              <p className="text-xs text-white/60 mt-2">
                If the attendee was already IN, the scan will mark them OUT automatically.
              </p>
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
