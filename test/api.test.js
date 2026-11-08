const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mood-oasis-test-"));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = "test-only-secret-that-is-longer-than-thirty-two-characters";

const { startServer } = require("../server");

let server;
let baseUrl;

before(async () => {
  server = startServer(0);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function request(method, route, body, token) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  return { status: response.status, data };
}

async function createUser(username) {
  const password = "Baseline!123";
  const registration = await request("POST", "/api/register", { username, password });
  assert.equal(registration.status, 201);
  const login = await request("POST", "/api/login", { username, password });
  assert.equal(login.status, 200);
  return login.data.token;
}

test("secured API regression suite", async (t) => {
  const token1 = await createUser("Primary User");
  const token2 = await createUser("Second User");

  await t.test("authentication validates input and duplicate names", async () => {
    let response = await request("POST", "/api/register", {
      username: "primary user",
      password: "Baseline!123",
    });
    assert.equal(response.status, 409);

    response = await request("POST", "/api/register", {
      username: "short-password",
      password: "short",
    });
    assert.equal(response.status, 400);

    response = await request("POST", "/api/login", {
      username: "Primary User",
      password: "wrong-password",
    });
    assert.equal(response.status, 401);

    response = await request("GET", "/api/notes");
    assert.equal(response.status, 401);
  });

  await t.test("notes are validated, private, and serialized safely", async () => {
    let response = await request("POST", "/api/notes", {}, token1);
    assert.equal(response.status, 400);

    response = await request(
      "POST",
      "/api/notes",
      { mood: "unknown", text: "bad mood" },
      token1
    );
    assert.equal(response.status, 400);

    response = await request(
      "POST",
      "/api/notes",
      { mood: "happy", text: "A valid check-in", img: "" },
      token1
    );
    assert.equal(response.status, 201);
    assert.equal("userId" in response.data.note, false);
    const noteId = response.data.note.id;

    response = await request("GET", "/api/notes", undefined, token2);
    assert.equal(response.data.notes.some((note) => note.id === noteId), false);

    response = await request("DELETE", `/api/notes/${noteId}`, undefined, token2);
    assert.equal(response.status, 404);

    response = await request("DELETE", `/api/notes/${noteId}`, undefined, token1);
    assert.equal(response.status, 200);

    response = await request("DELETE", `/api/notes/${noteId}`, undefined, token1);
    assert.equal(response.status, 404);
  });

  await t.test("suggestions hide internal voting data and enforce moderation", async () => {
    let response = await request("POST", "/api/suggestions", {}, token1);
    assert.equal(response.status, 400);

    response = await request(
      "POST",
      "/api/suggestions",
      { mood: "calm", title: "Slow down", desc: "Take a slow breath." },
      token1
    );
    assert.equal(response.status, 201);
    const suggestionId = response.data.suggestion.id;
    assert.equal("userId" in response.data.suggestion, false);
    assert.equal("likedBy" in response.data.suggestion, false);
    assert.equal("dislikedBy" in response.data.suggestion, false);

    response = await request(
      "POST",
      `/api/suggestions/${suggestionId}/vote`,
      { action: "other" },
      token1
    );
    assert.equal(response.status, 400);

    response = await request(
      "POST",
      "/api/suggestions/not-found/vote",
      { action: "like" },
      token1
    );
    assert.equal(response.status, 404);

    const voterTokens = [token1, token2];
    for (let index = 3; index <= 5; index += 1) {
      voterTokens.push(await createUser(`Voter ${index}`));
    }
    for (const token of voterTokens) {
      response = await request(
        "POST",
        `/api/suggestions/${suggestionId}/vote`,
        { action: "dislike" },
        token
      );
      assert.equal(response.status, 200);
    }

    response = await request("GET", "/api/suggestions");
    assert.equal(
      response.data.suggestions.some((suggestion) => suggestion.id === suggestionId),
      false
    );
    assert.equal(
      response.data.suggestions.some(
        (suggestion) =>
          "userId" in suggestion || "likedBy" in suggestion || "dislikedBy" in suggestion
      ),
      false
    );
  });

  await t.test("anonymous posts do not expose ownership and use correct status codes", async () => {
    let response = await request("POST", "/api/posts", {}, token1);
    assert.equal(response.status, 400);

    response = await request(
      "POST",
      "/api/posts",
      {
        title: "Anonymous moment",
        mood: "calm",
        text: "A private identity with a public message",
        img: "",
        isAnonymous: true,
      },
      token1
    );
    assert.equal(response.status, 201);
    const postId = response.data.post.id;
    assert.equal(response.data.post.username, "Anonymous");
    assert.equal("userId" in response.data.post, false);
    assert.equal("likedBy" in response.data.post, false);

    response = await request("GET", "/api/posts", undefined, token2);
    const visiblePost = response.data.posts.find((post) => post.id === postId);
    assert.equal(visiblePost.username, "Anonymous");
    assert.equal(visiblePost.isMine, false);
    assert.equal("userId" in visiblePost, false);
    assert.equal("likedBy" in visiblePost, false);

    response = await request("DELETE", `/api/posts/${postId}`, undefined, token2);
    assert.equal(response.status, 403);

    response = await request("POST", `/api/posts/${postId}/comment`, { text: "Hello" }, token2);
    assert.equal(response.status, 201);

    response = await request("POST", "/api/posts/not-found/like", {}, token2);
    assert.equal(response.status, 404);

    response = await request(
      "POST",
      "/api/posts/not-found/comment",
      { text: "Hello" },
      token2
    );
    assert.equal(response.status, 404);

    response = await request("DELETE", "/api/posts/not-found", undefined, token1);
    assert.equal(response.status, 404);

    response = await request("DELETE", `/api/posts/${postId}`, undefined, token1);
    assert.equal(response.status, 200);
  });

  await t.test("unsafe image types and unknown API routes are rejected", async () => {
    let response = await request(
      "POST",
      "/api/notes",
      { mood: "happy", text: "unsafe", img: "data:image/svg+xml;base64,PHN2Zz4=" },
      token1
    );
    assert.equal(response.status, 400);

    response = await request("GET", "/api/does-not-exist", undefined, token1);
    assert.equal(response.status, 404);
  });
});
