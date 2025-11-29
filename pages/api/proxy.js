export default async function handler(req, res) {
  const target = req.query.url;
  if (!target) {
    return res.status(400).json({ error: "Missing url param" });
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        // forward auth if provided
        Authorization: req.headers.authorization || "",
      },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    });

    const text = await upstream.text();
    res.status(upstream.status);
    // copy minimal headers
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("content-type", contentType);
    res.send(text);
  } catch (err) {
    res.status(500).json({ error: err.message || "Proxy error" });
  }
}
