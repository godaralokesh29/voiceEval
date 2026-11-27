import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

// Proxy is optional: only use it when PROXY_URL is a real, parseable URL.
function buildProxyAgent() {
    const proxyUrl = process.env.PROXY_URL;
    if (!proxyUrl) return undefined;
    try {
        const parsed = new URL(proxyUrl);
        if (!parsed.port && /proxy-host/.test(parsed.hostname)) return undefined;
        return new HttpsProxyAgent(proxyUrl);
    } catch {
        console.warn("PROXY_URL is invalid, calling GitHub directly");
        return undefined;
    }
}

const httpsAgent = buildProxyAgent();

export async function scrapeGithub(username: string) {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    const userRepos = await axios.request({
        url: `https://api.github.com/users/${encodeURIComponent(username)}/repos`,
        headers,
        httpsAgent,
        proxy: false,
    });
    return userRepos.data.map((x: any) => ({
        description: x.description,
        name: x.name,
        fullName: x.full_name,
        starCount: x.stargazers_count
    }))
}
