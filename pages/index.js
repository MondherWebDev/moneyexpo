import { useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import { getVisitorsCache, saveVisitorsCache, getOfflineCache, saveOfflineCache, getCheckinsCache, saveCheckinsCache } from "../lib/db";

const defaultToken = "f9c8ad6db3f6aabf2744f416623bd55f8c4b91b3";
const defaultBase = "https://moneyexpoglobal.com";
// Use relative proxy so it works on any Vercel domain/preview without editing settings.
const defaultProxy = "/api/proxy?url=";
const pageSize = 100;

export default function Home() {
  const [base, setBase] = useState(defaultBase);
  const [token, setToken] = useState(defaultToken);
  const [proxy, setProxy] = useState(defaultProxy);
  const [remember, setRemember] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [visitors, setVisitors] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [offline, setOffline] = useState([]);
  const [checkins, setCheckins] = useState({});
  const [statusMsg, setStatusMsg] = useState("Awaiting selection.");
  const [statusTone, setStatusTone] = useState("muted");
  const [showStats, setShowStats] = useState(false);
  const [lastDelta, setLastDelta] = useState(0);
  const [maxSeen, setMaxSeen] = useState(0);
  const [activeTab, setActiveTab] = useState("VISITOR");
  const [offlineCategory, setOfflineCategory] = useState("EXHIBITOR");
  const [modalOpen, setModalOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(1);
  const [showSecrets, setShowSecrets] = useState(false);
  const PASSCODE = "2580";
  const printAreaRef = useRef(null);

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
        if (saved.remember) setRemember(true);
      } catch (_) {
        /* ignore */
      }
      try {
        const storedOffline = await getOfflineCache();
        const offlineList = Array.isArray(storedOffline) ? storedOffline : [];
        setOffline(offlineList);
        const storedVisitors = await getVisitorsCache();
        if (Array.isArray(storedVisitors) && storedVisitors.length) {
          const merged = mergeRecords([...storedVisitors.map(expandVisitor), ...offlineList]);
          setVisitors(merged);
          updateCounts(merged.length);
          setStatus("Loaded cached visitors.");
        }
      } catch (_) {
        /* ignore */
      }
      try {
        const storedCheck = await getCheckinsCache();
        setCheckins(storedCheck && typeof storedCheck === "object" ? storedCheck : {});
      } catch (_) {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    if (remember) {
      localStorage.setItem(
        "badgeSettings",
        JSON.stringify({ base, token, proxy, remember: true })
      );
    }
  }, [base, token, proxy, remember]);

  useEffect(() => {
    if (visitors.length > 0) {
      try {
        const compact = visitors.map(compactVisitor);
        saveVisitorsCache(compact);
      } catch (_) {
        /* ignore */
      }
    }
  }, [visitors]);

  const mergedVisitors = useMemo(() => {
    const merged = mergeRecords([...visitors, ...offline]);
    if (activeTab === "VISITOR") {
      return merged.filter((v) => (v.category || "VISITOR") === "VISITOR");
    }
    return offline.filter((v) => (v.category || "VISITOR") === activeTab);
  }, [visitors, offline, activeTab]);

  const tabList = useMemo(() => {
    const baseTabs = ["VISITOR", "EXHIBITOR", "MEDIA", "SPEAKER", "ORGANIZER", "STAFF"];
    const offlineCounts = offline.reduce((acc, v) => {
      const cat = v.category || "VISITOR";
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {});
    return baseTabs.map((cat) => ({
      cat,
      count: cat === "VISITOR" ? visitors.length : offlineCounts[cat] || 0,
    }));
  }, [visitors.length, offline]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(mergedVisitors.length / pageSize)),
    [mergedVisitors.length]
  );

  const pagedVisitors = useMemo(() => {
    const start = (pageIndex - 1) * pageSize;
    return mergedVisitors.slice(start, start + pageSize);
  }, [mergedVisitors, pageIndex]);

  useEffect(() => {
    if (!modalOpen || !selected) return;
    const qrEl = document.getElementById("preview-qr");
    if (!qrEl) return;
    qrEl.innerHTML = "";
    try {
      // eslint-disable-next-line no-undef
      new QRCode(qrEl, {
        text: String(selected.qrValue || ""),
        width: Math.round(qrSizeCm * 37.8),
        height: Math.round(qrSizeCm * 37.8),
        correctLevel: QRCode.CorrectLevel.H,
      });
    } catch (err) {
      qrEl.textContent = "QR unavailable";
    }
  }, [modalOpen, selected, qrSizeCm]);

  useEffect(() => {
    setPageIndex(1);
  }, [activeTab]);

  const stats = useMemo(() => {
    const loaded = mergedVisitors.length;
    const printed = mergedVisitors.filter((v) => v.status === "PRINTED").length;
    const checkedIn = Object.values(checkins).filter((c) => c.status === "IN").length;
    return { loaded, printed, checkedIn, selected: selectedIds.size };
  }, [mergedVisitors, checkins, selectedIds]);

  useEffect(() => {
    if (pageIndex > totalPages) {
      setPageIndex(totalPages || 1);
    }
  }, [pageIndex, totalPages]);

  function setStatus(msg, tone = "muted") {
    setStatusMsg(msg);
    setStatusTone(tone);
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

  async function apiPost(path, body) {
    const url = buildUrl(path);
    const target = proxy ? `${proxy}${encodeURIComponent(url)}` : url;
    const res = await fetch(target, { method: "POST", headers: { ...authHeader() }, body });
    const text = await res.text();
    const data = safeJson(text);
    if (!res.ok) throw new Error(`POST ${path} failed (${res.status}): ${text.slice(0, 140)}`);
    return data;
  }

  async function handleSearch() {
    const term = searchTerm.trim();
    if (!term) {
      setStatus("Enter an email or attendee ID to search.", "error");
      return;
    }
    try {
      setStatus("Searching...");
      const payload = await apiGet(`/api/qatar/get-attendee-data?search_term=${encodeURIComponent(term)}`);
      const list = normalizeRecords(payload).map((v) => ({ ...v, category: "VISITOR" }));
      const offlineMatches = filterOffline(term, offline);
      const merged = mergeRecords([...list, ...offlineMatches]);
      updateCounts(merged.length);
      setVisitors(merged);
      setActiveTab("VISITOR");
      setPageIndex(1);
      setSelectedIds(new Set());
      if (merged[0]) setSelected(merged[0]);
      setStatus(`Loaded ${merged.length} result(s) (including offline) for "${term}".`);
      if (merged.length === 0) {
        // Surface a hint in the status and console for easier debugging in the field.
        console.warn("Search returned no normalized records. Raw payload:", payload);
      }
    } catch (err) {
      setStatus(err.message, "error");
    }
  }

  // Removed bulk "load all" to encourage targeted search and avoid rate limits.

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

    // Walk object graph up to depth 4 to locate the first array if predefined slots miss.
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
    const qrValue = id || raw.qr_value || raw.qr || email || name;
    const category =
      raw.category ||
      raw.sub_title ||
      raw.subTitle ||
      raw.title ||
      raw.type ||
      raw.role ||
      "VISITOR";
    const jobTitle = raw.job_title || raw.title || raw.position || raw.role || "";
    return {
      raw,
      id: String(id || ""),
      name,
      company,
      email,
      status,
      qrValue,
      category: String(category || "").toUpperCase(),
      jobTitle,
      country,
    };
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

  function compactVisitor(v) {
    return {
      id: v.id,
      name: v.name,
      company: v.company,
      email: v.email,
      status: v.status,
      qrValue: v.qrValue,
      category: v.category,
      jobTitle: v.jobTitle,
      country: v.country,
    };
  }

  function expandVisitor(v) {
    return {
      raw: v,
      ...v,
    };
  }

  function toggleSelection(id, checked) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAll(e) {
    const shouldSelect = e.target.checked;
    if (shouldSelect) {
      setSelectedIds(new Set(mergedVisitors.map((v) => v.id)));
    } else {
      setSelectedIds(new Set());
    }
  }

  function handlePrint(records) {
    const items = (records || []).filter(Boolean);
    if (!items.length) {
      setStatus("Select at least one visitor to print.", "error");
      return;
    }
    const qrPx = Math.round(qrSizeCm * 37.8);
    if (printAreaRef.current) {
      printAreaRef.current.innerHTML = items
        .map(
          (rec) => `
        <div class="print-badge ${rec.category && rec.category !== "VISITOR" ? "badge-nonvisitor" : ""}">
          <div class="badge-info" style="top:${offsetY}%;left:${offsetX}%;transform:translate(-${offsetX}%, -${offsetY - 10}%);">
            <p class="print-name">${escapeHtml(rec.name)}</p>
            <p class="print-job-title">${escapeHtml(rec.jobTitle || "")}</p>
            <p class="print-company">${escapeHtml(rec.company || "Company")}</p>
            <p class="print-country">${escapeHtml(rec.country || "")}</p>
            <div class="qr" style="width:${qrPx}px;height:${qrPx}px;" id="qr-${rec.id}"></div>
          </div>
        </div>`
        )
        .join("");
      items.forEach((rec) => {
        const qrEl = document.getElementById(`qr-${rec.id}`);
        if (!qrEl) return;
        try {
          // eslint-disable-next-line no-undef
          new QRCode(qrEl, {
            text: String(rec.qrValue || ""),
            width: 110,
            height: 110,
            correctLevel: QRCode.CorrectLevel.H,
          });
        } catch (err) {
          qrEl.textContent = "QR unavailable";
        }
      });
    }
    window.print();
  }

  async function markPrintedBatch(records) {
    const errors = [];
    for (const rec of records) {
      try {
        await markPrinted(rec, true);
      } catch (err) {
        errors.push(err.message);
      }
    }
    if (errors.length) {
      setStatus(`Printed with errors: ${errors.join("; ")}`, "error");
    } else {
      setStatus("Badge(s) marked as PRINTED.");
    }
  }

  async function markPrinted(rec, silent = false) {
    if (!rec || !rec.id) {
      if (!silent) setStatus("No visitor selected to update.", "error");
      return;
    }
    const form = new FormData();
    form.append("id", rec.id);
    form.append("status", "PRINTED");
    form.append("created", formatTimestamp(new Date()));
    try {
      await apiPost("/api/qatar/update-badge-print-status", form);
      const updated = mergedVisitors.map((v) => (v.id === rec.id ? { ...v, status: "PRINTED" } : v));
      setVisitors(updated);
      if (!silent) setStatus("Badge marked as PRINTED.");
    } catch (err) {
      const msg = String(err.message || "");
      if (msg.includes("422")) {
        if (!silent) {
          setStatus("Print status update was rejected (already printed or invalid payload). Badge kept as-is.", "muted");
        }
        return;
      }
      if (!silent) setStatus(err.message, "error");
      throw err;
    }
  }

  function handleCsvImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const usedIds = new Set([...visitors.map((v) => v.id), ...offline.map((o) => o.id)]);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        const records = parseCsv(text, offlineCategory, usedIds);
        if (!records.length) {
          setStatus("No records found in CSV.", "error");
          return;
        }
        const mergedOffline = mergeRecords([...offline, ...records]);
        setOffline(mergedOffline);
        saveOfflineCache(mergedOffline.map(compactVisitor));
        const mergedAll = mergeRecords([...visitors, ...records]);
        setVisitors(mergedAll);
        updateCounts(mergedAll.length);
        setStatus(`Imported ${records.length} offline ${offlineCategory} record(s).`);
      } catch (err) {
        setStatus(`Import failed: ${err.message}`, "error");
      }
    };
    reader.readAsText(file);
  }

  function parseCsv(text, categoryDefault, usedIds = new Set()) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const rows = lines.slice(1);
    return rows
      .map((line) => {
        const cols = line.split(",").map((c) => c.trim());
        const rec = {};
        header.forEach((key, idx) => {
          rec[key] = cols[idx] || "";
        });
        let id = rec.id || rec.attendee_id || rec.code;
        const name = rec.name || `${rec.first_name || ""} ${rec.last_name || ""}`.trim();
        const company = rec.company || rec.company_name || rec.organization || rec.organisation;
        const email = rec.email || "";
        const category = rec.category || rec.type || categoryDefault || "VISITOR";
        const jobTitle = rec.job_title || rec.title || rec.position || rec.role || "";
        const status = String(rec.status || "PENDING").toUpperCase();
        if (!id || usedIds.has(String(id))) {
          id = generateRandomId(usedIds);
        } else {
          usedIds.add(String(id));
        }
        return {
          raw: rec,
          id: String(id),
          name: name || email || "Unknown",
          company: company || "Unknown",
          email,
          status,
          qrValue: String(id),
          category: String(category || "VISITOR").toUpperCase(),
          jobTitle,
        };
      })
      .filter(Boolean);
  }

  function generateRandomId(used) {
    let id = "";
    do {
      id = `ID-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    } while (used.has(id));
    used.add(id);
    return id;
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

  function updateCounts(currentCount) {
    setLastDelta(Math.max(0, currentCount - maxSeen));
    setMaxSeen((prev) => Math.max(prev, currentCount));
  }

  function handleSelectRow(item, e) {
    const action = e.target.getAttribute("data-action");
    if (action === "print") {
      setSelected(item);
      setModalOpen(true);
      return;
    }
    if (e.target.tagName === "INPUT") {
      toggleSelection(item.id, e.target.checked);
      return;
    }
    setSelected(item);
  }

  function statusPill(status) {
    const cls =
      status === "PRINTED"
        ? "bg-emerald-100 text-emerald-700"
        : status === "PENDING"
        ? "bg-amber-100 text-amber-700"
        : "bg-rose-100 text-rose-700";
    const label = status || "UNKNOWN";
    return (
      <span className={`inline-flex items-center px-3 py-1 text-xs font-semibold rounded-full ${cls}`}>
        {escapeHtml(label)}
      </span>
    );
  }

  const tableMeta = `Loaded: ${mergedVisitors.length}${
    lastDelta > 0 ? ` (+${lastDelta} new)` : ""
  } | Total seen: ${maxSeen} | Selected: ${selectedIds.size}`;
  const tableTitle = activeTab === "VISITOR" ? "Visitors" : `${activeTab.toLowerCase()}s`;
  const badgeOverlayStyles = {
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "82%",
  };
  const statusColor =
    statusTone === "error" ? "text-rose-300" : statusTone === "success" ? "text-emerald-200" : "text-white/80";

  function downloadTemplate() {
    const headers = ["id", "name", "company", "email", "category", "status", "job_title"];
    const sample = [
      headers.join(","),
      'sample-1,"Jane Doe","Example Corp","jane@example.com","EXHIBITOR","PENDING","Marketing Manager"',
      'sample-2,"John Smith","Example Corp","john@example.com","VISITOR","PENDING","Sales Lead"',
    ].join("\n");
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "badge-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Head>
        <title>MEQ2025 Badge Printer</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js" defer></script>
      </Head>
      <div id="app" className="w-full px-4 sm:px-6 lg:px-8 pb-12 text-white">
        <header className="mt-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6 rounded-2xl p-5 shadow-2xl bg-gradient-to-r from-magenta/40 via-violet/30 to-navy/70 border border-white/10">
          <div className="flex items-center gap-4 min-w-[260px]">
            <img src="/MoneyExpo.jpeg" alt="Money Expo Qatar" className="w-32 rounded-2xl shadow-2xl" />
            <div>
              <p className="uppercase tracking-[0.16em] font-bold text-aqua text-sm mb-1">MEQ2025</p>
              <h1 className="text-3xl font-bold text-white leading-tight m-0">Badge Printing Control</h1>
              <p className="text-white/70 mt-1 text-sm">Search, print, and track badges with live API updates.</p>
            </div>
          </div>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => handlePrint(mergedVisitors.filter((v) => selectedIds.has(v.id)))}
              className="bg-gradient-to-r from-magenta to-violet text-white font-bold rounded-xl px-4 py-2 shadow-lg hover:-translate-y-[1px] transition"
            >
              Bulk print selected
            </button>
            <button
              onClick={async () => {
                await fetch("/api/logout", { method: "POST" });
                window.location.href = "/login";
              }}
              className="bg-white/15 text-white font-semibold rounded-xl px-4 py-2 border border-white/30 hover:bg-white/20 transition"
            >
              Logout
            </button>
          </div>
        </header>

        <section className="bg-navy2 rounded-2xl p-5 shadow-xl border border-white/5 mb-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col xl:flex-row gap-4 xl:items-start">
              <div className="flex flex-1 items-center gap-3">
                <button
                  type="button"
                  className="w-11 h-11 inline-flex items-center justify-center rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 transition"
                  aria-label="Toggle secrets"
                  onClick={() => {
                    if (showSecrets) {
                      setShowSecrets(false);
                      return;
                    }
                    const pass = prompt("Enter passcode to show credentials");
                    if (pass && pass === PASSCODE) {
                      setShowSecrets(true);
                    } else {
                      setShowSecrets(false);
                      setStatus("Incorrect passcode.", "error");
                    }
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {showSecrets ? (
                      <path
                        d="M3 3l18 18M10.58 10.58A3 3 0 0113.42 13.4M9.88 5.08a7 7 0 014.24 0m5.82 5.3c.36.45.54.67.54.67s-3.4 4.95-9 4.95c-.85 0-1.64-.1-2.37-.27"
                        stroke="#fff"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : (
                      <path
                        d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7 5 0 9.27-3.11 11-7-1.73-3.89-6-7-11-7Zm0 12a5 5 0 110-10 5 5 0 010 10Z"
                        fill="#fff"
                      />
                    )}
                  </svg>
                </button>
                <div className="flex-1 flex items-center gap-3">
                  <input
                    id="search-term"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by email or attendee ID"
                    className="flex-1 h-14 rounded-2xl px-4 py-3 bg-white text-textmain border border-black/10 text-base shadow-inner"
                  />
                  <button
                    onClick={handleSearch}
                    className="h-14 px-5 rounded-2xl bg-gradient-to-r from-magenta to-violet text-white font-semibold shadow-lg hover:-translate-y-[1px] transition"
                  >
                    Search
                  </button>
                </div>
              </div>

              <div className="w-full xl:w-[360px] bg-white/5 border border-white/10 rounded-2xl p-4">
                <p className="text-sm font-semibold mb-2">Import offline CSV (id,name,company,email,category,status)</p>
                <input
                  id="csv-import"
                  type="file"
                  accept=".csv"
                  onChange={handleCsvImport}
                  className="w-full bg-white text-textmain border border-black/10 rounded-xl px-3 py-3 text-sm"
                />
                <div className="flex items-center gap-3 mt-3">
                  <select
                    value={offlineCategory}
                    onChange={(e) => setOfflineCategory(e.target.value)}
                    className="flex-1 bg-white text-textmain border border-black/10 rounded-xl px-3 py-3 text-sm"
                  >
                    <option value="EXHIBITOR">Exhibitor</option>
                    <option value="MEDIA">Media</option>
                    <option value="SPEAKER">Speaker</option>
                    <option value="ORGANIZER">Organizer</option>
                    <option value="STAFF">Staff</option>
                  </select>
                  <span className="text-xs text-white/70">Applied to imported rows</span>
                </div>
                <p className="text-xs text-white/60 mt-2">Imported records merge with API data and save locally.</p>
                <button
                  type="button"
                  className="mt-3 w-full bg-white/10 text-white font-semibold rounded-xl px-3 py-2 border border-white/20 hover:bg-white/15 transition"
                  onClick={downloadTemplate}
                >
                  Download CSV template
                </button>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3 text-sm text-white/80">
                  <label className="flex flex-col">
                    <span>Offset X (%)</span>
                    <input
                      type="number"
                      value={offsetX}
                      step="0.5"
                      min="40"
                      max="60"
                      onChange={(e) => setOffsetX(parseFloat(e.target.value) || 48)}
                      className="mt-1 rounded-lg px-2 py-1 text-textmain"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span>Offset Y (%)</span>
                    <input
                      type="number"
                      value={offsetY}
                      step="0.5"
                      min="40"
                      max="60"
                      onChange={(e) => setOffsetY(parseFloat(e.target.value) || 50)}
                      className="mt-1 rounded-lg px-2 py-1 text-textmain"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span>QR size (cm)</span>
                    <input
                      type="number"
                      value={qrSizeCm}
                      step="0.1"
                      min="2"
                      max="5"
                      onChange={(e) => setQrSizeCm(parseFloat(e.target.value) || 3.6)}
                      className="mt-1 rounded-lg px-2 py-1 text-textmain"
                    />
                  </label>
                </div>
              </div>
            </div>

            {showSecrets && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                <label className="flex items-center gap-2 text-sm text-white/80 bg-white/5 rounded-xl px-3 py-3 border border-white/10">
                  <input
                    id="remember-settings"
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span>Remember API settings on this device</span>
                </label>
                <div className="flex flex-col gap-2 bg-white/5 rounded-xl px-3 py-3 border border-white/10">
                  <label htmlFor="base-url" className="text-xs font-semibold text-white/80">
                    API Base URL
                  </label>
                  <input
                    id="base-url"
                    type="text"
                    value={base}
                    onChange={(e) => setBase(e.target.value)}
                    placeholder="https://moneyexpoglobal.com"
                    className="bg-white text-textmain border border-black/10 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-2 bg-white/5 rounded-xl px-3 py-3 border border-white/10">
                  <label htmlFor="token" className="text-xs font-semibold text-white/80">
                    Bearer Token
                  </label>
                  <input
                    id="token"
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="bg-white text-textmain border border-black/10 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-2 bg-white/5 rounded-xl px-3 py-3 border border-white/10">
                  <label htmlFor="proxy-url" className="text-xs font-semibold text-white/80">
                    Proxy URL (optional, for CORS)
                  </label>
                  <input
                    id="proxy-url"
                    type="text"
                    value={proxy}
                    onChange={(e) => setProxy(e.target.value)}
                    placeholder="https://your-proxy.example.com?url="
                    className="bg-white text-textmain border border-black/10 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}

          </div>
        </section>

        <section className="bg-navy2 rounded-2xl p-4 shadow-xl border border-white/5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white/80 m-0">Stats</h3>
            <button
              type="button"
              className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-white/10 border border-white/20 hover:bg-white/15 transition"
              onClick={() => {
                if (showStats) {
                  setShowStats(false);
                  return;
                }
                const pass = prompt("Enter passcode to unlock stats");
                if (pass && pass === PASSCODE) {
                  setShowStats(true);
                } else {
                  setStatus("Incorrect passcode.", "error");
                  setShowStats(false);
                }
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d={showStats ? "M6 10V7a6 6 0 1112 0v3h1a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V11a1 1 0 011-1h1zm2 0h8V7a4 4 0 10-8 0v3z" : "M6 10V7a6 6 0 1112 0v3h1a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V11a1 1 0 011-1h1zm2 0h8V7a4 4 0 10-8 0v3zm4 4a2 2 0 100 4 2 2 0 000-4z"}
                  fill="#fff"
                />
              </svg>
              <span>{showStats ? "Lock" : "Unlock"}</span>
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Loaded", value: stats.loaded },
              { label: "Selected", value: stats.selected },
              { label: "Printed", value: stats.printed },
              { label: "Checked in", value: stats.checkedIn },
            ].map((item) => (
              <div key={item.label} className="bg-white/10 border border-white/15 rounded-xl p-3">
                <p className="text-xs uppercase tracking-[0.08em] text-white/70 m-0">{item.label}</p>
                <p className="text-2xl font-bold mt-1">{showStats ? item.value : "•••"}</p>
              </div>
            ))}
          </div>
          <p className={`text-sm mt-3 ${statusColor} m-0`}>{statusMsg}</p>
        </section>

        <section className="bg-navy2 rounded-2xl p-3 shadow-lg border border-white/5 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            {tabList.map(({ cat, count }) => (
              <button
                key={cat}
                className={`px-4 py-2 rounded-full text-sm font-semibold border transition ${
                  activeTab === cat
                    ? "bg-gradient-to-r from-magenta to-violet text-white border-transparent shadow-lg"
                    : "bg-white text-navy border-slate-200"
                }`}
                onClick={() => {
                  setActiveTab(cat);
                  setPageIndex(1);
                  setSelectedIds(new Set());
                }}
              >
                {cat}
                {count ? ` (${count})` : ""}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="bg-white rounded-2xl shadow-xl p-4 text-textmain">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="text-xl font-bold m-0 capitalize">{tableTitle}</h2>
                <p className="text-sm text-slate-500 m-0">{tableMeta}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => {
                    setSelectedIds(new Set());
                    const allBox = document.getElementById("select-all");
                    if (allBox) allBox.checked = false;
                  }}
                  className="bg-white text-navy font-bold rounded-xl px-3 py-2 border border-navy shadow-sm"
                >
                  Clear selection
                </button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl">
              <table className="w-full border-collapse min-w-full">
                <thead className="bg-navy text-white rounded-t-xl">
                  <tr>
                    <th className="p-3 text-left">
                      <input
                        type="checkbox"
                        id="select-all"
                        onChange={toggleSelectAll}
                        checked={mergedVisitors.length > 0 && selectedIds.size === mergedVisitors.length}
                      />
                    </th>
                    <th className="p-3 text-left">ID</th>
                    <th className="p-3 text-left">Name</th>
                    <th className="p-3 text-left">Company</th>
                    <th className="p-3 text-left">Email</th>
                    <th className="p-3 text-left">Category</th>
                    <th className="p-3 text-left">Status</th>
                    <th className="p-3 text-left">Check-in</th>
                    <th className="p-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedVisitors.length === 0 ? (
                    <tr>
                      <td className="p-4 text-center text-slate-500" colSpan={9}>
                        {activeTab === "VISITOR"
                          ? "No results yet. Search by email or attendee ID."
                          : "No records for this category. Upload CSV to add entries."}
                      </td>
                    </tr>
                  ) : (
                    pagedVisitors.map((item) => {
                      const check = checkins[item.id] || {};
                      const checkLabel =
                        check.status === "IN" ? "Checked in" : check.status === "OUT" ? "Checked out" : "Not checked";
                      const checkTime = check.time ? ` (${check.time})` : "";
                      return (
                        <tr
                          key={item.id}
                          className="border-b last:border-b-0 hover:bg-slate-50/70 transition"
                          onClick={(e) => handleSelectRow(item, e)}
                        >
                          <td className="p-3">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              onChange={(e) => toggleSelection(item.id, e.target.checked)}
                            />
                          </td>
                          <td className="p-3">{item.id}</td>
                          <td className="p-3">{item.name}</td>
                          <td className="p-3">{item.company}</td>
                          <td className="p-3">{item.email || ""}</td>
                          <td className="p-3">{item.category || "VISITOR"}</td>
                          <td className="p-3">{statusPill(item.status)}</td>
                          <td className="p-3">
                            <span className="text-sm text-slate-700">{checkLabel}</span>
                            <span className="text-xs text-slate-500">{checkTime}</span>
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col gap-2 min-w-[130px]">
                              <button
                                className="bg-gradient-to-r from-magenta to-violet text-white font-bold rounded-xl px-3 py-2 shadow"
                                data-action="print"
                              >
                                Print
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end items-center gap-3 mt-3">
              <button
                className="bg-white text-navy font-bold rounded-xl px-3 py-2 border border-navy shadow-sm disabled:opacity-50"
                disabled={pageIndex <= 1}
                onClick={() => setPageIndex((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <span className="text-sm text-slate-600">
                Page {pageIndex} of {totalPages}
              </span>
              <button
                className="bg-white text-navy font-bold rounded-xl px-3 py-2 border border-navy shadow-sm disabled:opacity-50"
                disabled={pageIndex >= totalPages}
                onClick={() => setPageIndex((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setModalOpen(false)}></div>
          <div className="relative bg-white text-textmain rounded-2xl shadow-2xl p-6 w-[480px] max-w-[92vw]">
            <button
              className="absolute top-3 right-3 text-2xl text-slate-500 hover:text-slate-800"
              aria-label="Close badge preview"
              onClick={() => setModalOpen(false)}
            >
              &times;
            </button>
            <h3 className="text-lg font-semibold mb-3">Badge preview</h3>
            <div
              id="badge-preview"
              className="relative w-full max-w-[480px] mx-auto overflow-hidden shadow"
              style={{
                width: "320px",
                height: "440px",
                background: 'url("/badge-template.png") center top / cover no-repeat',
                borderRadius: "0",
              }}
            >
              <div className="absolute text-center flex flex-col items-center gap-2" style={badgeOverlayStyles}>
                <p className="text-2xl font-bold my-0">{selected?.name || "Select a visitor"}</p>
                <p className="text-xl text-slate-800 my-0 font-semibold">{selected?.company || "Company"}</p>
                <p className="text-lg text-slate-700 my-0 font-semibold">{selected?.country || ""}</p>
                <div
                  id="preview-qr"
                  className="bg-white p-2 rounded-lg grid place-items-center mx-auto"
                  style={{ width: Math.round(qrSizeCm * 37.8) + "px", height: Math.round(qrSizeCm * 37.8) + "px" }}
                ></div>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button
                disabled={!selected}
                className="bg-gradient-to-r from-magenta to-violet text-white font-semibold rounded-xl px-4 py-2 shadow disabled:opacity-50"
                onClick={() => {
                  if (!selected) return;
                  setModalOpen(false);
                  const current = selected;
                  setTimeout(() => {
                    handlePrint([current]);
                    markPrinted(current);
                  }, 10);
                }}
              >
                Print
              </button>
            </div>
          </div>
        </div>
      )}

      <div id="print-area" ref={printAreaRef}></div>
    </>
  );
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
