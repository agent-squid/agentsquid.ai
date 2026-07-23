import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "_site");

const PAGE_TITLES = {
  home: "Home",
  docs: "Docs",
  blog: "Blog",
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
    { href: "index.html#quickstart", label: "Get Started" },
    { href: "index.html#features", label: "Features" },
    { href: "blog/index.html", label: "Blog" },
    { href: "index.html", label: "Docs", active: true, bare: true },
    { href: "community.html", label: "Community" },
  ],
  blog: [
    { href: "index.html#quickstart", label: "Get Started" },
    { href: "index.html#features", label: "Features" },
    { href: "index.html", label: "Blog", active: true, bare: true },
    { href: "docs/index.html", label: "Docs" },
    { href: "community.html", label: "Community" },
  ],
};

const FOOTER_LINKS = {
  home: [
    { href: "https://github.com/agent-squid/squid", label: "GitHub", external: true },
    { href: "blog/index.html", label: "Blog" },
    { href: "docs/index.html", label: "Docs" },
    { href: "community.html", label: "Community Feed" },
  ],
  docs: [
    { href: "https://github.com/agent-squid/squid", label: "GitHub", external: true },
    { href: "blog/index.html", label: "Blog" },
    { href: "community.html", label: "Community Feed" },
  ],
  blog: [
    { href: "https://github.com/agent-squid/squid", label: "GitHub", external: true },
    { href: "community.html", label: "Community Feed" },
  ],
};

// Top-level static entries copied verbatim into _site (mirrors the previous
// hand-written cp list in .github/workflows/deploy-pages.yml).
const STATIC_FILES = [
  "index.html",
  "index1.html",
  "community.html",
  "nav-toggle.js",
  "insights.json",
  "pinned-posts.json",
  "CNAME",
  "agent_squid_400.png",
  "agent_squid_400x400.png",
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
];

const INCLUDE_RE = /^[ \t]*<!--\s*INCLUDE\s+(header|footer):(\w+)\s*-->\r?\n/gm;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const [headerTemplate, footerTemplate] = await Promise.all([
    readFile(path.join(ROOT, "partials/header.html"), "utf8"),
    readFile(path.join(ROOT, "partials/footer.html"), "utf8"),
  ]);
  const templates = { header: headerTemplate.trimEnd(), footer: footerTemplate.trimEnd() };

  for (const name of STATIC_FILES) {
    await cp(path.join(ROOT, name), path.join(OUT_DIR, name));
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
    });
    await writeFile(path.join(OUT_DIR, file), rendered, "utf8");
  }

  console.log(`Built ${TEMPLATED_HTML.length} templated pages into ${path.relative(ROOT, OUT_DIR)}/`);
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
    FOOTER_LINKS[section].map((link) => renderLink(link, base)).join("\n"),
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
