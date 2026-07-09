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
const newestId = existing.newest_id || existing.posts?.[0]?.id || "";
const newPosts = await fetchNewPosts(newestId);
const posts = mergePosts(newPosts, existing.posts || []).slice(0, maxPosts);

const output = {
  updated_at: new Date().toISOString(),
  source: "x",
  user_id: userId,
  newest_id: posts[0]?.id || newestId || null,
  posts,
};

await writeFile(outFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote ${posts.length} posts to ${outFile}. New posts: ${newPosts.length}.`);

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

  url.searchParams.set("max_results", sinceId ? "5" : "10");
  url.searchParams.set("exclude", "retweets,replies");
  url.searchParams.set("tweet.fields", "created_at,entities");

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

  return data.data.map(normalizePost);
}

function normalizePost(post) {
  return {
    id: post.id,
    url: `https://x.com/aiAgentSquid/status/${post.id}`,
    text: post.text,
    created_at: post.created_at || null,
    entities: post.entities || null,
  };
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
