import { readFile, writeFile } from "node:fs/promises";

const outFile = "_site/x-posts.json";
const userId = process.env.X_USER_ID;
const bearerToken = process.env.X_BEARER_TOKEN;
const maxPosts = Number.parseInt(process.env.MAX_X_POSTS || "50", 10);

if (!userId) {
  throw new Error("X_USER_ID is required.");
}

if (!bearerToken) {
  throw new Error("X_BEARER_TOKEN is required. Add it as a GitHub Actions secret.");
}

if (!Number.isInteger(maxPosts) || maxPosts < 1) {
  throw new Error("MAX_X_POSTS must be a positive integer.");
}

const existing = await readExistingCache();
const refreshMedia = existing.media_schema_version !== 1;
const newestId = refreshMedia ? "" : existing.newest_id || existing.posts?.[0]?.id || "";
const newPosts = await fetchNewPosts(newestId);
const posts = mergePosts(newPosts, existing.posts || []).slice(0, maxPosts);

const output = {
  updated_at: new Date().toISOString(),
  source: "x",
  user_id: userId,
  media_schema_version: 1,
  newest_id: posts[0]?.id || newestId || null,
  posts,
};

await writeFile(outFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote ${posts.length} posts to ${outFile}. Fetched posts: ${newPosts.length}.`);

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

async function fetchNewPosts(sinceId) {
  const url = new URL(`https://api.x.com/2/users/${userId}/tweets`);

  url.searchParams.set("max_results", String(sinceId ? 5 : Math.min(Math.max(maxPosts, 10), 100)));
  url.searchParams.set("exclude", "retweets,replies");
  url.searchParams.set("tweet.fields", "attachments,created_at,entities");
  url.searchParams.set("expansions", "attachments.media_keys");
  url.searchParams.set("media.fields", "alt_text,duration_ms,height,media_key,preview_image_url,type,url,variants,width");

  if (sinceId) {
    url.searchParams.set("since_id", sinceId);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: "application/json",
    },
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`X API request failed with ${response.status}: ${body}`);
  }

  const data = JSON.parse(body);

  if (!Array.isArray(data.data)) {
    return [];
  }

  const mediaByKey = new Map(
    (data.includes?.media || [])
      .filter((media) => media.media_key)
      .map((media) => [media.media_key, media]),
  );

  return data.data.map((post) => normalizePost(post, mediaByKey));
}

function normalizePost(post, mediaByKey) {
  return {
    id: post.id,
    url: `https://x.com/aiAgentSquid/status/${post.id}`,
    text: post.text,
    created_at: post.created_at || null,
    entities: post.entities || null,
    media: normalizeMedia(post.attachments?.media_keys || [], mediaByKey),
  };
}

function normalizeMedia(mediaKeys, mediaByKey) {
  for (const mediaKey of mediaKeys) {
    const media = mediaByKey.get(mediaKey);
    if (!media) continue;

    if (media.type === "photo" && media.url) {
      return {
        type: "image",
        url: media.url,
        alt: media.alt_text || "",
        width: numberOrNull(media.width),
        height: numberOrNull(media.height),
      };
    }

    if ((media.type === "video" || media.type === "animated_gif") && Array.isArray(media.variants)) {
      const videoUrl = bestMp4Variant(media.variants);
      if (videoUrl) {
        return {
          type: "video",
          url: videoUrl,
          poster: media.preview_image_url || null,
          alt: media.alt_text || "",
          width: numberOrNull(media.width),
          height: numberOrNull(media.height),
        };
      }
    }

    if (media.preview_image_url) {
      return {
        type: "image",
        url: media.preview_image_url,
        alt: media.alt_text || "",
        width: numberOrNull(media.width),
        height: numberOrNull(media.height),
      };
    }
  }

  return null;
}

function bestMp4Variant(variants) {
  return variants
    .filter((variant) => variant.url && variant.content_type === "video/mp4")
    .sort((a, b) => (numberOrNull(b.bit_rate) || 0) - (numberOrNull(a.bit_rate) || 0))[0]?.url || null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mergePosts(newPosts, oldPosts) {
  const byId = new Map();

  for (const post of [...newPosts, ...oldPosts]) {
    if (!post || !post.id) continue;
    byId.set(post.id, post);
  }

  return [...byId.values()].sort(compareTweetIdsDesc);
}

function compareTweetIdsDesc(a, b) {
  const aId = BigInt(a.id);
  const bId = BigInt(b.id);

  if (aId > bId) return -1;
  if (aId < bId) return 1;
  return 0;
}
