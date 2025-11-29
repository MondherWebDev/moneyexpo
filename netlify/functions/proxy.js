export const handler = async (event) => {
  try {
    const target = event.queryStringParameters && event.queryStringParameters.url;
    if (!target) {
      return { statusCode: 400, body: "Missing url parameter" };
    }

    const method = event.httpMethod || "GET";
    const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : event.body;

    const upstream = await fetch(target, {
      method,
      headers: { Authorization: authHeader },
      body,
    });

    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "application/json";

    return {
      statusCode: upstream.status,
      headers: { "Content-Type": contentType },
      body: text,
    };
  } catch (err) {
    return { statusCode: 500, body: `Proxy error: ${err.message}` };
  }
};
