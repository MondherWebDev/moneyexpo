import { useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import { getVisitorsCache, saveVisitorsCache, getOfflineCache, saveOfflineCache, getCheckinsCache, saveCheckinsCache } from "../lib/db";

const defaultToken = "f9c8ad6db3f6aabf2744f416623bd55f8c4b91b3";
const defaultBase = "https://moneyexpoglobal.com";
const defaultProxy = "https://moneyexpo.vercel.app/api/proxy?url=";
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
  const [lastDelta, setLastDelta] = useState(0);
  const [maxSeen, setMaxSeen] = useState(0);
  const [activeTab, setActiveTab] = useState("VISITOR");
  const [offlineCategory, setOfflineCategory] = useState("EXHIBITOR");
  const [modalOpen, setModalOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const [lastPageLoaded, setLastPageLoaded] = useState(0);
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
        width: 110,
        height: 110,
        correctLevel: QRCode.CorrectLevel.H,
      });
    } catch (err) {
      qrEl.textContent = "QR unavailable";
    }
  }, [modalOpen, selected]);

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
    const res = await fetch(target, { headers: { ...authHeader() } });
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
      if (merged[0]) setSelected(merged[0]);
      setStatus(`Loaded ${merged.length} result(s) (including offline) for "${term}".`);
    } catch (err) {
      setStatus(err.message, "error");
    }
  }

  async function handleLoadAll() {
    try {
      setStatus("Loading all visitors...");
      setVisitors([]);
      setPageIndex(1);
      setLoadError(false);
      setLastPageLoaded(0);
      const apiList = (await fetchAllVisitors(1)).map((v) => ({ ...v, category: "VISITOR" }));
      const merged = mergeRecords([...apiList, ...offline]);
      updateCounts(merged.length);
      setVisitors(merged);
      setStatus(`Loaded ${merged.length} visitors (including offline).`);
      try {
        if (merged.length) saveVisitorsCache(merged.map(compactVisitor));
        } catch (_) {
          /* ignore */
        }
      } catch (err) {
        setStatus(err.message, "error");
    }
  }

  async function fetchAllVisitors(startPage = 1) {
    let all = [];
    let page = startPage;
    while (true) {
      setStatus(`Loading visitors (page ${page})...`);
      try {
        const payload = await apiGet(`/api/qatar/get-all-visitors-data?page=${page}&per_page=${pageSize}`);
        const chunk = normalizeRecords(payload);
        if (!chunk.length) break;
        all = mergeRecords([...all, ...chunk]);
        setVisitors(all);
        updateCounts(all.length);
        setLastPageLoaded(page);
        saveVisitorsCache(all.map(compactVisitor));
        if (chunk.length < pageSize) break;
        page += 1;
        await new Promise((resolve) => setTimeout(resolve, 200)); // small pause to reduce 429s
      } catch (err) {
        if (String(err.message || "").includes("429")) {
          setStatus(`Rate limit reached after page ${page - 1}. Loaded ${all.length} so far. Use Resume to continue later.`, "error");
          setLoadError(true);
          break;
        }
        setStatus(
          `API error at page ${page}. Loaded ${all.length} so far. Use Resume to continue when available. (${err.message})`,
          "error"
        );
        setLoadError(true);
        break;
      }
    }
    return all;
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
    const jobTitle = raw.job_title || raw.title || raw.position || raw.role || "";
    return { raw, id: String(id || ""), name, company, email, status, qrValue, category: String(category || "").toUpperCase(), jobTitle };
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
    if (printAreaRef.current) {
      printAreaRef.current.innerHTML = items
        .map(
          (rec) => `
        <div class="print-badge ${rec.category && rec.category !== "VISITOR" ? "badge-nonvisitor" : ""}">
          <div class="badge-info">
            <p class="print-name">${escapeHtml(rec.name)}</p>
            <p class="print-category">${escapeHtml(rec.category || "VISITOR")}</p>
            <p class="print-job-title">${escapeHtml(rec.jobTitle || "")}</p>
            <p class="print-company">${escapeHtml(rec.company || "Company")}</p>
            <p class="print-id">${escapeHtml(rec.id)}</p>
            <div class="qr ${rec.category && rec.category !== "VISITOR" ? "qr-small" : ""}" id="qr-${rec.id}"></div>
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
    markPrintedBatch(items);
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
      if (!silent) setStatus(err.message, "error");
      throw err;
    }
  }

  function handleCsvImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        const records = parseCsv(text, offlineCategory);
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

  function parseCsv(text, categoryDefault) {
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
        const id = rec.id || rec.attendee_id || rec.code;
        const name = rec.name || `${rec.first_name || ""} ${rec.last_name || ""}`.trim();
        const company = rec.company || rec.company_name || rec.organization || rec.organisation;
        const email = rec.email || "";
        const category = rec.category || rec.type || categoryDefault || "VISITOR";
        const jobTitle = rec.job_title || rec.title || rec.position || rec.role || "";
        const status = String(rec.status || "PENDING").toUpperCase();
        if (!id) return null;
        return {
          raw: rec,
          id: String(id),
          name: name || email || "Unknown",
          company: company || "Unknown",
          email,
          status,
          qrValue: rec.qr || rec.qr_value || id,
          category: String(category || "VISITOR").toUpperCase(),
          jobTitle,
        };
      })
      .filter(Boolean);
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
    if (action === "preview") {
      setSelected(item);
      setModalOpen(true);
      return;
    }
    if (action === "print") {
      setSelected(item);
      handlePrint([item]);
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
  const badgeOverlayStyles = { top: "56%", left: "50%", transform: "translate(-50%, -42%)", width: "82%" };
  const statusColor =
    statusTone === "error" ? "text-rose-300" : statusTone === "success" ? "text-emerald-200" : "text-white/80";

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
        <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6 rounded-2xl p-5 shadow-2xl bg-gradient-to-r from-magenta/40 via-violet/30 to-navy/70 border border-white/10">
          <div className="flex items-center gap-4 min-w-[260px]">
            <img src="/MoneyExpo.jpeg" alt="Money Expo Qatar" className="w-32 rounded-2xl shadow-2xl ring-2 ring-white/10" />
            <div>
              <p className="uppercase tracking-[0.16em] font-bold text-aqua text-sm mb-1">MEQ2025</p>
              <h1 className="text-3xl font-bold text-white leading-tight m-0">Badge Printing Control</h1>
              <p className="text-white/70 mt-1 text-sm">Search, print, and track badges with live API updates.</p>
            </div>
          </div>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={handleLoadAll}
              className="bg-white text-navy font-bold rounded-xl px-4 py-2 shadow-md hover:-translate-y-[1px] transition"
            >
              Load all visitors
            </button>
            <button
              onClick={() => handlePrint(mergedVisitors.filter((v) => selectedIds.has(v.id)))}
              className="bg-gradient-to-r from-magenta to-violet text-white font-bold rounded-xl px-4 py-2 shadow-lg hover:-translate-y-[1px] transition"
            >
              Bulk print selected
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

        <section className="bg-navy2 rounded-2xl p-4 shadow-xl border border-white/5 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white/10 border border-white/15 rounded-xl p-3">
            <p className="text-xs uppercase tracking-[0.08em] text-white/70 m-0">Loaded</p>
            <p className="text-2xl font-bold mt-1">{stats.loaded}</p>
          </div>
          <div className="bg-white/10 border border-white/15 rounded-xl p-3">
            <p className="text-xs uppercase tracking-[0.08em] text-white/70 m-0">Selected</p>
            <p className="text-2xl font-bold mt-1">{stats.selected}</p>
          </div>
          <div className="bg-white/10 border border-white/15 rounded-xl p-3">
            <p className="text-xs uppercase tracking-[0.08em] text-white/70 m-0">Printed</p>
            <p className="text-2xl font-bold mt-1">{stats.printed}</p>
          </div>
          <div className="bg-white/10 border border-white/15 rounded-xl p-3">
            <p className="text-xs uppercase tracking-[0.08em] text-white/70 m-0">Checked in</p>
            <p className="text-2xl font-bold mt-1">{stats.checkedIn}</p>
          </div>
          <p className={`col-span-2 md:col-span-4 text-sm ${statusColor} m-0`}>{statusMsg}</p>
        </section>

        <section>
          <div className="bg-white rounded-2xl shadow-xl p-4 text-textmain">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {tabList.map(({ cat, count }) => (
                <button
                  key={cat}
                  className={`px-4 py-2 rounded-full text-sm font-semibold border transition ${
                    activeTab === cat
                      ? "bg-gradient-to-r from-magenta to-violet text-white border-transparent shadow-lg"
                      : "bg-white text-navy border-slate-200"
                  }`}
                  onClick={() => setActiveTab(cat)}
                >
                  {cat}
                  {count ? ` (${count})` : ""}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="text-xl font-bold m-0">Visitors</h2>
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
                {loadError && (
                  <button
                    className="bg-gradient-to-r from-magenta to-violet text-white font-bold rounded-xl px-3 py-2 shadow"
                    onClick={async () => {
                      setStatus("Resuming load...");
                      setLoadError(false);
                      const more = (await fetchAllVisitors(lastPageLoaded + 1)).map((v) => ({ ...v, category: "VISITOR" }));
                      const merged = mergeRecords([...visitors, ...more, ...offline]);
                      updateCounts(merged.length);
                      setVisitors(merged);
                      setStatus(`Loaded ${merged.length} visitors (including offline).`);
                    }}
                  >
                    Resume load
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-full">
                <thead className="bg-navy text-white">
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
                        No results yet.
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
                                className="bg-white text-navy font-bold rounded-xl px-3 py-2 border border-navy shadow-sm"
                                data-action="preview"
                              >
                                Preview
                              </button>
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
              className="relative w-full max-w-[420px] aspect-[27/37] mx-auto overflow-hidden rounded-2xl shadow"
              style={{ background: 'url("/badge-template.png") center top / cover no-repeat' }}
            >
              <div className="absolute text-center flex flex-col items-center gap-2" style={badgeOverlayStyles}>
                <p className="text-2xl font-bold my-0">{selected?.name || "Select a visitor"}</p>
                <p className="text-sm text-slate-800 my-0">{selected?.company || "Company"}</p>
                <p className="text-xs text-slate-700 my-0">{selected?.id || "ID"}</p>
                <div id="preview-qr" className="w-[140px] h-[140px] bg-white p-2 rounded-lg grid place-items-center mx-auto"></div>
              </div>
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
