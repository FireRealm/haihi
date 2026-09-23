const http = require("http");
const { URL } = require("url");

const port = process.env.PORT || 3000;
const accessToken = process.env.SCRIPT_TOKEN || "";

function getScript() {
  if (process.env.OBFUSCATED_SCRIPT_B64) {
    return Buffer.from(
      process.env.OBFUSCATED_SCRIPT_B64,
      "base64"
    ).toString("utf8");
  }

  return process.env.OBFUSCATED_SCRIPT || "";
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  );

  if (requestUrl.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("online");
    return;
  }

  if (requestUrl.pathname === "/script") {
    if (accessToken) {
      const suppliedToken = requestUrl.searchParams.get("token");

      if (suppliedToken !== accessToken) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
    }

    const script = getScript();

    if (!script) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Script is not configured");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });

    res.end(script);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});