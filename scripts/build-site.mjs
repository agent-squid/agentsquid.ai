import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "_site");
const SQUID_RAW_BASE = process.env.SQUID_RAW_BASE || "https://raw.githubusercontent.com/agent-squid/squid/main";
const SQUID_REPO_ROOT = process.env.SQUID_REPO_ROOT || "";

const PAGE_TITLES = {
  home: "Home",
  docs: "Docs",
  blog: "Blog",
  playground: "Squid Flow => Playground",
};

// href is root-relative; external links are left untouched, internal links
// get the page's {{BASE}} ("" or "../") prepended at render time.
const NAV_LINKS = {
  home: [
    { href: "#fit", label: "Where it fits" },
    { href: "#features", label: "Features" },
    { href: "#quickstart", label: "Get Started" },
    { href: "blog/index.html", label: "Blog" },
    { href: "docs/index.html", label: "Docs" },
    { href: "community.html", label: "Community" },
  ],
  docs: [
    { href: "index.html#fit", label: "Where it fits" },
    { href: "index.html#features", label: "Features" },
    { href: "index.html#quickstart", label: "Get Started" },
    { href: "blog/index.html", label: "Blog" },
    { href: "index.html", label: "Docs", active: true, bare: true },
    { href: "community.html", label: "Community" },
  ],
  blog: [
    { href: "index.html#fit", label: "Where it fits" },
    { href: "index.html#features", label: "Features" },
    { href: "index.html#quickstart", label: "Get Started" },
    { href: "index.html", label: "Blog", active: true, bare: true },
    { href: "docs/index.html", label: "Docs" },
    { href: "community.html", label: "Community" },
  ],
  playground: [
    { href: "index.html#fit", label: "Where it fits" },
    { href: "index.html#features", label: "Features" },
    { href: "index.html#quickstart", label: "Get Started" },
    { href: "blog/index.html", label: "Blog" },
    { href: "docs/index.html", label: "Docs" },
    { href: "community.html", label: "Community" },
  ],
};

const SHARED_FOOTER_LINKS = [
  { href: "https://github.com/agent-squid/squid", label: "GitHub", external: true },
  { href: "blog/index.html", label: "Blog" },
  { href: "docs/index.html", label: "Docs" },
  { href: "community.html", label: "Community Feed" },
];

// Top-level static entries copied verbatim into _site (mirrors the previous
// hand-written cp list in .github/workflows/deploy-pages.yml).
const STATIC_FILES = [
  "index.html",
  "index1.html",
  "index2.html",
  "index3.html",
  "index4.html",
  "community.html",
  "nav-toggle.js",
  "insights.json",
  "pinned-posts.json",
  "CNAME",
  "agent_squid_400.png",
  "agent_squid_400x400.png",
  "install.sh",
];
const STATIC_DIRS = ["blog", "docs", "images"];

// Pages that use the shared {{ INCLUDE header:SECTION }} / {{ INCLUDE footer:SECTION }}
// markers and need include-expansion before being copied to _site.
const TEMPLATED_HTML = [
  { file: "index.html", section: "home" },
  { file: "docs/index.html", section: "docs" },
  { file: "docs/quick-start.html", section: "docs" },
  { file: "docs/basic-usage.html", section: "docs" },
  { file: "docs/comparison.html", section: "docs" },
  { file: "docs/remote-access.html", section: "docs" },
  { file: "docs/squid-flow.html", section: "docs" },
  { file: "blog/index.html", section: "blog" },
  { file: "blog/introducing-agent-squid.html", section: "blog" },
  { file: "blog/named-lanes-vs-terminal-tabs.html", section: "blog" },
  { file: "flow-playground.html", section: "playground" },
];

const INCLUDE_RE = /^[ \t]*<!--\s*INCLUDE\s+(header|footer):(\w+)\s*-->\r?\n/gm;
const FLOW_PLAYGROUND_RE = /^[ \t]*<!--\s*INCLUDE\s+squid-flow-playground\s*-->\r?\n/gm;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const [headerTemplate, footerTemplate] = await Promise.all([
    readFile(path.join(ROOT, "partials/header.html"), "utf8"),
    readFile(path.join(ROOT, "partials/footer.html"), "utf8"),
  ]);
  const templates = { header: headerTemplate.trimEnd(), footer: footerTemplate.trimEnd() };
  const squidPlayground = await loadSquidPlayground();

  for (const name of STATIC_FILES) {
    const src = path.join(ROOT, name);
    try {
      await cp(src, path.join(OUT_DIR, name));
    } catch (err) {
      if (err.code === "ENOENT") {
        console.log(`Skipping missing static file: ${name}`);
        continue;
      }
      throw err;
    }
  }
  for (const name of STATIC_DIRS) {
    await cp(path.join(ROOT, name), path.join(OUT_DIR, name), { recursive: true });
  }

  for (const { file, section } of TEMPLATED_HTML) {
    const base = file.includes("/") ? "../" : "";
    const source = await readFile(path.join(ROOT, file), "utf8");
    const rendered = source.replace(INCLUDE_RE, (match, kind, includeSection) => {
      if (!NAV_LINKS[includeSection]) {
        throw new Error(`${file}: unknown section "${includeSection}" in "${match}"`);
      }
      return `${renderPartial(kind, includeSection, base, templates)}\n`;
    }).replace(FLOW_PLAYGROUND_RE, `${squidPlayground.html}\n`);
    await writeFile(path.join(OUT_DIR, file), rendered, "utf8");
  }

  console.log(`Built ${TEMPLATED_HTML.length} templated pages into ${path.relative(ROOT, OUT_DIR)}/`);
}

async function loadSquidPlayground() {
  const [html, lang] = await Promise.all([
    readSquidFile("ui/flow-playground.html"),
    readSquidFile("ui/flow-lang.js"),
  ]);
  await mkdir(path.join(OUT_DIR, "playground"), { recursive: true });
  await writeFile(path.join(OUT_DIR, "playground", "flow-lang.js"), lang, "utf8");
  return { html: renderSquidPlayground(html) };
}

async function readSquidFile(file) {
  if (SQUID_REPO_ROOT) {
    return readFile(path.join(SQUID_REPO_ROOT, file), "utf8");
  }
  const url = `${SQUID_RAW_BASE.replace(/\/$/, "")}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

function renderSquidPlayground(source) {
  const style = source.match(/<style>([\s\S]*?)<\/style>/i)?.[1];
  const body = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  if (!style || !body) {
    throw new Error("Could not extract Squid Flow playground style/body from Squid source");
  }
  const content = body
    .replace(/<script\s+src=["']flow-lang\.js["']><\/script>\s*/i, "")
    .replace(/<footer>[\s\S]*?<\/footer>/i, "")
    .trim();
  return `<style>
${style
  .replace(/\bbody\s*\{/g, ".flow-playground-page {")
  .replace(/footer\b/g, ".flow-playground-source")}
  .flow-playground-source {
    color: var(--text-dim);
    font-size: 0.72em;
    margin-top: 2rem;
  }
  .flow-playground-source a { color: var(--text-mid); }
</style>
<script src="playground/flow-lang.js"></script>
<main class="flow-playground-page">
${content.replace(/This page is standalone — not wired into the live composer or backend yet\./g, "This public playground mirrors Squid's current Flow grammar.")}
  <p class="flow-playground-source">
    Synced from <a href="https://github.com/agent-squid/squid/blob/main/ui/flow-playground.html" target="_blank" rel="noopener">Squid's playground source</a>.
  </p>
</main>`;
}

function renderPartial(kind, section, base, templates) {
  if (kind === "header") {
    return templates.header
      .replace(/\{\{BASE\}\}/g, base)
      .replace(/\{\{PAGE_TITLE\}\}/g, PAGE_TITLES[section])
      .replace("{{NAV_LINKS}}", NAV_LINKS[section].map((link) => renderLink(link, base)).join("\n"));
  }

  return templates.footer.replace(
    "{{FOOTER_LINKS}}",
    SHARED_FOOTER_LINKS.map((link) => renderLink(link, base)).join("\n"),
  );
}

function renderLink({ href, label, external, active, bare }, base) {
  const finalHref = external || bare ? href : `${base}${href}`;
  const classAttr = active ? ' class="active"' : "";
  const externalAttrs = external ? ' target="_blank" rel="noopener"' : "";
  return `      <a${classAttr} href="${finalHref}"${externalAttrs}>${label}</a>`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
