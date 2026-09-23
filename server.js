const http = require("http");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT || 3000;
const accessToken = process.env.SCRIPT_TOKEN || "";

const scriptPath = path.join(__dirname, "script.lua");

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("online");
        return;
    }

    if (url.pathname === "/script") {
        if (accessToken) {
            const suppliedToken = url.searchParams.get("token");

            if (suppliedToken !== accessToken) {
                res.writeHead(401, { "Content-Type": "text/plain" });
                res.end("Unauthorized");
                return;
            }
        }

        if (!fs.existsSync(scriptPath)) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("script.lua not found");
            return;
        }

        const script = fs.readFileSync(scriptPath, "utf8");

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
