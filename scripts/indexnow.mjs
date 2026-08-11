// Ping IndexNow so Bing, DuckDuckGo and Yandex pick up changes in hours rather
// than weeks. Bing is this site's largest search channel by a factor of two, so
// this is the highest-leverage crawl signal available — Google ignores IndexNow
// and still has to be handled through Search Console.
//
//   node scripts/indexnow.mjs              # submit every URL in sitemap.xml
//   node scripts/indexnow.mjs /run/doom/   # submit specific paths
//
// Run it after a deploy has gone live: the endpoint fetches the URLs to verify
// them, so submitting before the content is up wastes the ping.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public");
const SITE = "https://exebrowser.com";
const HOST = "exebrowser.com";
const KEY = "8c85ed68020adc1cd6adf2e1a1c0bc43";

const args = process.argv.slice(2);
const urls = args.length
  ? args.map((p) => (p.startsWith("http") ? p : SITE + (p.startsWith("/") ? p : "/" + p)))
  : [...readFileSync(resolve(ROOT, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

if (!urls.length) {
  console.error("nothing to submit");
  process.exit(1);
}

// The key file has to be reachable, or the endpoint rejects the whole batch.
const keyUrl = `${SITE}/${KEY}.txt`;
const keyRes = await fetch(keyUrl);
const keyBody = (await keyRes.text()).trim();
if (!keyRes.ok || keyBody !== KEY) {
  console.error(`key file check failed: ${keyUrl} → ${keyRes.status} "${keyBody.slice(0, 40)}"`);
  console.error("deploy the key file before submitting.");
  process.exit(1);
}
console.log(`key file OK (${keyUrl})`);

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: keyUrl, urlList: urls }),
});

// 200 and 202 both mean accepted; 202 just means the key is still being verified.
console.log(`submitted ${urls.length} URLs → ${res.status} ${res.statusText}`);
if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}
