const http = require("http");

const port = process.env.PORT || 3000;
const scriptUrl = process.env.SCRIPT_URL;
const githubToken = process.env.GITHUB_TOKEN;

async function getScript() {
    if (!scriptUrl || !githubToken) {
        throw new Error("SCRIPT_URL or GITHUB_TOKEN is missing");
    }

    const response = await fetch(scriptUrl, {
        headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: "application/vnd.github.raw+json",
            "User-Agent": "Railway-Script-Server"
        }
    });

    if (!response.ok) {
        throw new Error(`GitHub returned ${response.status}`);
    }

    return await response.text();
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("online");
        return;
    }

    if (url.pathname === "/script") {
        try {
            const script = await getScript();

            res.writeHead(200, {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff"
            });

            res.end(script);
        } catch (error) {
            console.error(error);

            res.writeHead(500, {
                "Content-Type": "text/plain"
            });

            res.end("Failed to retrieve script");
        }

        return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
});

server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
