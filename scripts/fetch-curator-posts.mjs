import { readFile, writeFile } from "node:fs/promises";

const outFile = "_site/curator-posts.json";
const feedId = process.env.CURATOR_FEED_ID;
const pageSize = Number.parseInt(process.env.CURATOR_PAGE_SIZE || "25", 10);
const maxPosts = Number.parseInt(process.env.MAX_CURATOR_POSTS || "100", 10);

if (!feedId) {
  throw new Error("CURATOR_FEED_ID is required.");
}

if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
  throw new Error("CURATOR_PAGE_SIZE must be an integer from 1 to 100.");
}

if (!Number.isInteger(maxPosts) || maxPosts < 1) {
  throw new Error("MAX_CURATOR_POSTS must be a positive integer.");
}

const existing = await readExistingCache();
const firstPage = await fetchPage(0);
const firstPagePosts = normalizePosts(firstPage.posts);

if (existing.posts.length > 0 && samePosts(firstPagePosts, existing.posts.slice(0, firstPagePosts.length))) {
  console.log(`Curator cache unchanged. Kept ${existing.posts.length} posts in ${outFile}.`);
  process.exit(0);
}

const fetchedAt = new Date().toISOString();
const pages = [pageSummary(firstPage, 0)];
const fetchedPosts = [...firstPagePosts];
let postCount = Number.isInteger(firstPage.postCount) ? firstPage.postCount : null;
const existingIds = new Set(existing.posts.map((post) => post.id));

if (firstPagePosts.length === pageSize && !firstPagePosts.some((post) => existingIds.has(post.id))) {
  for (let offset = pageSize; offset < maxPosts; offset += pageSize) {
    const page = await fetchPage(offset);
    const pagePosts = normalizePosts(page.posts);

    postCount = Number.isInteger(page.postCount) ? page.postCount : postCount;
    pages.push(pageSummary(page, offset));
    fetchedPosts.push(...pagePosts);

    if (pagePosts.length < pageSize || pagePosts.some((post) => existingIds.has(post.id))) {
      break;
    }
  }
}

const dedupedPosts = mergePosts(fetchedPosts, existing.posts).slice(0, maxPosts);
const newestPost = dedupedPosts[0] || null;

const output = {
  updated_at: fetchedAt,
  source: "curator",
  page_size: pageSize,
  max_posts: maxPosts,
  post_count: dedupedPosts.length,
  curator_post_count: postCount,
  newest_id: newestPost?.id || null,
  newest_created_at: newestPost?.created_at || null,
  pages,
  posts: dedupedPosts,
};

await writeFile(outFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote ${dedupedPosts.length} Curator posts to ${outFile}.`);

async function fetchPage(offset) {
  const url = new URL(`https://api.curator.io/v1/feeds/${feedId}/posts`);
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("status", "1");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Curator API request failed with ${response.status}: ${body}`);
  }

  const data = JSON.parse(body);

  if (data.success !== true) {
    throw new Error(`Curator API request failed: ${body}`);
  }

  return data;
}

async function readExistingCache() {
  try {
    const raw = await readFile(outFile, "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.posts)) {
      return { posts: [] };
    }

    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      return { posts: [] };
    }

    throw error;
  }
}

function pageSummary(page, offset) {
  const pagePosts = Array.isArray(page.posts) ? page.posts : [];

  return {
    offset,
    limit: pageSize,
    count: pagePosts.length,
    pagination: page.pagination || null,
    cache: page.cache || null,
  };
}

function normalizePosts(posts) {
  return Array.isArray(posts) ? posts.map(normalizePost) : [];
}

function normalizePost(post) {
  const createdAt = post.source_created_at || post.created_at || null;

  return {
    id: String(post.id),
    source_identifier: post.source_identifier ? String(post.source_identifier) : null,
    created_at: createdAt,
    last_modified: post.last_modified || null,
    network_id: post.network_id ?? null,
    network_name: post.network_name || networkNameForId(post.network_id),
    source_type: post.source_type ?? null,
    status: post.status ?? null,
    post_status: post.post_status || null,
    is_html: Boolean(post.is_html),
    text: cleanText(post.text || ""),
    url: post.url || null,
    user: {
      screen_name: post.user_screen_name || null,
      full_name: post.user_full_name || null,
      image: post.user_image || null,
      url: post.user_url || null,
    },
    media: {
      has_media: Boolean(post.has_media),
      has_image: Boolean(post.has_image),
      has_video: Boolean(post.has_video),
      image: post.image || null,
      image_large: post.image_large || null,
      thumbnail: post.thumbnail || null,
      video: post.video || null,
      image_width: numberOrNull(post.image_width),
      image_height: numberOrNull(post.image_height),
      video_width: numberOrNull(post.video_width),
      video_height: numberOrNull(post.video_height),
    },
    engagement: {
      likes: numberOrNull(post.likes),
      comments: numberOrNull(post.comments),
      views: numberOrNull(post.views),
    },
    pinned: Boolean(post.pinned),
    pinned_at: post.pinned_at || null,
  };
}

function cleanText(value) {
  return decodeHtmlEntities(
    String(value)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/ *\n+ */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function networkNameForId(id) {
  const names = new Map([
    [2, "Instagram"],
    [23, "Reddit"],
    [25, "TikTok"],
  ]);

  return names.get(id) || null;
}

function mergePosts(fetchedPosts, oldPosts) {
  const fetchedIds = new Set();
  const merged = [];

  for (const item of fetchedPosts) {
    if (!item?.id) continue;
    fetchedIds.add(item.id);
    merged.push(item);
  }

  for (const item of oldPosts) {
    if (!item?.id || fetchedIds.has(item.id)) continue;
    merged.push(item);
  }

  return merged;
}

function samePosts(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((post, index) => postFingerprint(post) === postFingerprint(right[index]));
}

function postFingerprint(post) {
  if (!post) {
    return "";
  }

  return JSON.stringify({
    id: post.id,
    source_identifier: post.source_identifier,
    created_at: post.created_at,
    last_modified: post.last_modified,
    network_id: post.network_id,
    network_name: post.network_name,
    source_type: post.source_type,
    status: post.status,
    post_status: post.post_status,
    is_html: post.is_html,
    text: post.text,
    url: post.url,
    user: post.user,
    media: post.media,
    engagement: post.engagement,
    pinned: post.pinned,
    pinned_at: post.pinned_at,
  });
}
