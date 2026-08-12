import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "_site");
const SITE_URL = (process.env.SITE_URL || "https://agentsquid.ai").replace(/\/$/, "");
const SQUID_RAW_BASE = process.env.SQUID_RAW_BASE || "https://raw.githubusercontent.com/agent-squid/squid/main";
const SQUID_REPO_ROOT = process.env.SQUID_REPO_ROOT || "";
const DEFAULT_SOCIAL_IMAGE = "agent_squid_400.png";

const PAGE_TITLES = {
  home: "Home",
  docs: "Docs",
  blog: "Blog",
  playground: "Squid Flow => Playground",
  community: "Community",
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
  community: [
    { href: "index.html#fit", label: "Where it fits" },
    { href: "index.html#features", label: "Features" },
    { href: "index.html#quickstart", label: "Get Started" },
    { href: "blog/index.html", label: "Blog" },
    { href: "docs/index.html", label: "Docs" },
    { href: "community.html", label: "Community", active: true, bare: true },
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
  "community.html",
  "nav-toggle.js",
  "insights.json",
  "pinned-posts.json",
  "CNAME",
  "agent_squid_400.png",
  "install.sh",
  "install-test.sh",
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
  { file: "flow-playground.html", section: "playground" },
  { file: "community.html", section: "community" },
];

const STATIC_HTML = [];

const SEO_META = {
  "index.html": {
    description: "AgentSquid is a local meta harness for Claude Code, Codex, Cursor Agent, OpenCode, and Pi. Run named agent lanes, queue work, track tokens, and control coding agents from one browser UI.",
    type: "website",
    schema: "SoftwareApplication",
  },
  "docs/index.html": {
    description: "AgentSquid documentation: quick start, basic usage, Squid Flow, remote access, and how it compares to other tools.",
    type: "article",
    schema: "TechArticle",
  },
  "docs/quick-start.html": {
    description: "Install a backend CLI, start AgentSquid, and open the browser UI.",
    type: "article",
    schema: "TechArticle",
  },
  "docs/basic-usage.html": {
    description: "Tag syntax, adhoc turns, and slash commands for everyday AgentSquid use.",
    type: "article",
    schema: "TechArticle",
  },
  "docs/comparison.html": {
    description: "Where AgentSquid fits next to chat UIs, single-agent CLIs, and IDE agents, and when it's not the right tool.",
    type: "article",
    schema: "TechArticle",
  },
  "docs/remote-access.html": {
    description: "Couch coding from your phone or tablet with Tailscale.",
    type: "article",
    schema: "TechArticle",
  },
  "docs/squid-flow.html": {
    description: "Chain agents together with Squid Flow: one-way handoffs, round trips, joins, and scheduled runs.",
    type: "article",
    schema: "TechArticle",
  },
  "flow-playground.html": {
    description: "Try Squid Flow route expressions and see canonical routes, branch breakdowns, and expanded execution forms.",
    type: "website",
    schema: "WebApplication",
  },
  "blog/index.html": {
    description: "Release notes, design notes, and field reports from the AgentSquid team.",
    type: "website",
    schema: "CollectionPage",
  },
  "blog/introducing-agent-squid.html": {
    description: "Why we built a meta harness for local coding agents instead of another chat UI.",
    type: "article",
    schema: "BlogPosting",
    published: "2026-07-28",
  },
  "blog/named-lanes-vs-terminal-tabs.html": {
    description: "How #topic@agent routing replaces a desktop full of unlabeled terminal windows.",
    type: "article",
    schema: "BlogPosting",
    published: "2026-07-28",
  },
  "blog/parallel-conflicts.html": {
    description: "How Squid isolates parallel agent turns with per-turn worktrees, merges them with a real Git three-way merge, and surfaces true conflicts instead of silent data loss.",
    type: "article",
    schema: "BlogPosting",
    published: "2026-07-28",
  },
  "blog/multiple-coding-agents-one-workspace.html": {
    description: "How to compare coding agents, models, and personas on the same real task while tracking their code changes, token usage, and quota consumption in AgentSquid.",
    type: "article",
    schema: "BlogPosting",
    published: "2026-08-12",
  },
  "blog/mixing-frontier-local-models.html": {
    description: "How to mix frontier, mid-tier, free-tier, and local coding models in one workspace without losing context or control of token costs.",
    type: "article",
    schema: "BlogPosting",
    published: "2026-08-12",
  },
  "community.html": {
    title: "Community - AgentSquid",
    description: "Follow AgentSquid community updates, curated posts, demos, and developer conversations from one feed.",
    type: "website",
    schema: "CollectionPage",
  },
};

// Every *.html file under blog/ is templated with the shared blog header/footer —
// new posts just need the INCLUDE markers, not a manual entry here.
async function discoverBlogPages() {
  const entries = await readdir(path.join(ROOT, "blog"), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => ({ file: `blog/${entry.name}`, section: "blog" }));
}

const INCLUDE_RE = /^[ \t]*<!--\s*INCLUDE\s+(header|footer):(\w+)\s*-->\r?\n/gm;
const FLOW_PLAYGROUND_RE = /^[ \t]*<!--\s*INCLUDE\s+squid-flow-playground\s*-->\r?\n/gm;

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const [headerTemplate, footerTemplate] = await Promise.all([
    readFile(path.join(ROOT, "partials/header.html"), "utf8"),
    readFile(path.join(ROOT, "partials/footer.html"), "utf8"),
  ]);
  const templates = { header: headerTemplate.trimEnd(), footer: footerTemplate.trimEnd() };
  const squidPlayground = await loadSquidPlayground();
  const templatedHtml = [...TEMPLATED_HTML, ...(await discoverBlogPages())];

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

  for (const { file, section } of templatedHtml) {
    const base = file.includes("/") ? "../" : "";
    const source = await readFile(path.join(ROOT, file), "utf8");
    const rendered = source.replace(INCLUDE_RE, (match, kind, includeSection) => {
      if (!NAV_LINKS[includeSection]) {
        throw new Error(`${file}: unknown section "${includeSection}" in "${match}"`);
      }
      return `${renderPartial(kind, includeSection, base, templates)}\n`;
    }).replace(FLOW_PLAYGROUND_RE, `${squidPlayground.html}\n`);
    await writeFile(path.join(OUT_DIR, file), injectSeo(file, rendered), "utf8");
  }

  for (const file of STATIC_HTML) {
    const source = await readFile(path.join(ROOT, file), "utf8");
    await writeFile(path.join(OUT_DIR, file), injectSeo(file, source), "utf8");
  }

  const publicHtml = uniqueFiles([...templatedHtml.map(({ file }) => file), ...STATIC_HTML]);
  await Promise.all([
    writeFile(path.join(OUT_DIR, "robots.txt"), renderRobots(), "utf8"),
    writeFile(path.join(OUT_DIR, "sitemap.xml"), renderSitemap(publicHtml), "utf8"),
  ]);

  console.log(`Built ${templatedHtml.length} templated pages into ${path.relative(ROOT, OUT_DIR)}/`);
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

function injectSeo(file, html) {
  const meta = SEO_META[file] || {};
  const title = meta.title || html.match(/<title>([^<]+)<\/title>/i)?.[1] || "AgentSquid";
  const description = meta.description || html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']\s*\/?>/i)?.[1] || "";
  const canonical = urlForFile(file);
  const image = `${SITE_URL}/${DEFAULT_SOCIAL_IMAGE}`;
  const tags = [
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:site_name" content="AgentSquid" />`,
    `<meta property="og:type" content="${escapeHtml(meta.type || "website")}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<script type="application/ld+json">${JSON.stringify(schemaFor(file, title, description, canonical, image))}</script>`,
  ];

  let next = stripManagedSeo(html);
  if (description && !/<meta\s+name=["']description["']/i.test(next)) {
    next = next.replace(/(<title>[^<]+<\/title>)/i, `$1\n  <meta name="description" content="${escapeHtml(description)}" />`);
  }
  return next.replace(/(<meta\s+name=["']description["'][^>]*>\s*)/i, `$1\n  ${tags.join("\n  ")}\n  `);
}

function stripManagedSeo(html) {
  return html
    .replace(/\n?\s*<link\s+rel=["']canonical["'][^>]*>\s*/gi, "\n")
    .replace(/\n?\s*<meta\s+(?:property=["']og:[^"']+["']|name=["']twitter:[^"']+["'])[^>]*>\s*/gi, "\n")
    .replace(/\n?\s*<script\s+type=["']application\/ld\+json["']>[\s\S]*?<\/script>\s*/gi, "\n");
}

function schemaFor(file, title, description, canonical, image) {
  const meta = SEO_META[file] || {};
  const base = {
    "@context": "https://schema.org",
    "@type": meta.schema || "WebPage",
    name: title,
    description,
    url: canonical,
    image,
    publisher: organizationSchema(),
  };

  if (meta.schema === "SoftwareApplication") {
    return {
      ...base,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS, Linux",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      downloadUrl: "https://github.com/agent-squid/squid",
    };
  }

  if (meta.schema === "BlogPosting" || meta.schema === "TechArticle") {
    return {
      ...base,
      headline: title,
      author: organizationSchema(),
      datePublished: meta.published,
      dateModified: meta.modified || meta.published,
      mainEntityOfPage: canonical,
    };
  }

  return base;
}

function organizationSchema() {
  return {
    "@type": "Organization",
    name: "AgentSquid",
    url: SITE_URL,
    logo: `${SITE_URL}/${DEFAULT_SOCIAL_IMAGE}`,
    sameAs: [
      "https://github.com/agent-squid/squid",
    ],
  };
}

function renderRobots() {
  return `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

function renderSitemap(files) {
  const urls = files.map((file) => `  <url>
    <loc>${escapeXml(urlForFile(file))}</loc>
  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function urlForFile(file) {
  return file === "index.html" ? `${SITE_URL}/` : `${SITE_URL}/${file}`;
}

function uniqueFiles(files) {
  return [...new Set(files)].sort((a, b) => urlForFile(a).localeCompare(urlForFile(b)));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXml(value) {
  return escapeHtml(value).replace(/'/g, "&apos;");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
