const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    "JWT_SECRET must be set to a random value containing at least 32 characters. " +
      "Copy .env.example to .env when using npm run dev."
  );
}

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const NOTES_FILE = path.join(DATA_DIR, "notes.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SUGGEST_FILE = path.join(DATA_DIR, "suggestions.json");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const ALLOWED_MOODS = new Set([
  "anxious",
  "irritated",
  "happy",
  "tired",
  "emo",
  "calm",
]);
const MAX_IMAGE_CHARS = 4_000_000;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\r\n]+$/i;

app.disable("x-powered-by");
app.use(express.json({ limit: "5mb", strict: true }));
app.use(express.static(PUBLIC_DIR));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const file of [NOTES_FILE, USERS_FILE, SUGGEST_FILE, POSTS_FILE]) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, "[]\n", "utf-8");
  }
}

function readData(file) {
  ensureDataFiles();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
    return parsed;
  } catch (error) {
    console.error(`Unable to read data file ${path.basename(file)}:`, error.message);
    throw new HttpError(500, "Data storage is unavailable");
  }
}

function writeData(file, data) {
  ensureDataFiles();
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempFile, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
    fs.renameSync(tempFile, file);
  } catch (error) {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {}
    console.error(`Unable to write data file ${path.basename(file)}:`, error.message);
    throw new HttpError(500, "Data storage is unavailable");
  }
}

function uid() {
  return crypto.randomUUID();
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "A JSON object is required");
  }
  return value;
}

function readString(value, field, options = {}) {
  const { required = true, min = required ? 1 : 0, max = 500, trim = true } = options;
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${field} is required`);
    return "";
  }
  if (typeof value !== "string") throw new HttpError(400, `${field} must be a string`);
  const result = trim ? value.trim() : value;
  if (result.length < min) throw new HttpError(400, `${field} is too short`);
  if (result.length > max) throw new HttpError(400, `${field} is too long`);
  if (/[\u0000-\u001f\u007f]/.test(result)) {
    throw new HttpError(400, `${field} contains unsupported characters`);
  }
  return result;
}

function readMood(value) {
  const mood = readString(value, "mood", { max: 20 });
  if (!ALLOWED_MOODS.has(mood)) throw new HttpError(400, "Unsupported mood");
  return mood;
}

function readImage(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new HttpError(400, "img must be a string");
  if (value.length > MAX_IMAGE_CHARS) throw new HttpError(413, "Image is too large");
  if (!IMAGE_DATA_URL.test(value)) {
    throw new HttpError(400, "Only PNG, JPEG, GIF, and WebP images are supported");
  }
  return value;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function authenticateToken(req, res, next) {
  const authHeader = req.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ ok: false, error: "Please login first" });

  try {
    req.user = jwt.verify(match[1], JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ ok: false, error: "Token expired or invalid" });
  }
}

function serializeNote(note) {
  return {
    id: note.id,
    text: note.text || "",
    mood: note.mood,
    img: note.img || "",
    createdAt: note.createdAt,
  };
}

function serializeSuggestion(suggestion, userId = null) {
  const likedBy = Array.isArray(suggestion.likedBy) ? suggestion.likedBy : [];
  const dislikedBy = Array.isArray(suggestion.dislikedBy) ? suggestion.dislikedBy : [];
  return {
    id: suggestion.id,
    username: suggestion.username,
    mood: suggestion.mood,
    title: suggestion.title,
    desc: suggestion.desc,
    createdAt: suggestion.createdAt,
    likeCount: likedBy.length,
    dislikeCount: dislikedBy.length,
    hasLiked: Boolean(userId && likedBy.includes(userId)),
    hasDisliked: Boolean(userId && dislikedBy.includes(userId)),
  };
}

function serializePost(post, userId) {
  const likedBy = Array.isArray(post.likedBy) ? post.likedBy : [];
  const comments = Array.isArray(post.comments) ? post.comments : [];
  return {
    id: post.id,
    username: post.username,
    title: post.title,
    mood: post.mood,
    text: post.text,
    img: post.img || "",
    comments: comments.map((comment) => ({
      id: comment.id,
      username: comment.username,
      text: comment.text,
      createdAt: comment.createdAt,
    })),
    createdAt: post.createdAt,
    likeCount: likedBy.length,
    hasLiked: likedBy.includes(userId),
    isMine: post.userId === userId,
  };
}

app.post(
  "/api/register",
  asyncRoute(async (req, res) => {
    const body = requireObject(req.body);
    const username = readString(body.username, "username", { min: 2, max: 40 });
    const password = readString(body.password, "password", {
      min: 8,
      max: 128,
      trim: false,
    });
    const normalizedUsername = username.toLocaleLowerCase();
    let users = readData(USERS_FILE);
    if (users.some((user) => user.username.toLocaleLowerCase() === normalizedUsername)) {
      throw new HttpError(409, "Username exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    users = readData(USERS_FILE);
    if (users.some((user) => user.username.toLocaleLowerCase() === normalizedUsername)) {
      throw new HttpError(409, "Username exists");
    }
    users.push({ id: uid(), username, password: hashedPassword });
    writeData(USERS_FILE, users);
    res.status(201).json({ ok: true });
  })
);

app.post(
  "/api/login",
  asyncRoute(async (req, res) => {
    const body = requireObject(req.body);
    const username = readString(body.username, "username", { max: 40 });
    const password = readString(body.password, "password", { max: 128, trim: false });
    const users = readData(USERS_FILE);
    const normalizedUsername = username.toLocaleLowerCase();
    const user = users.find(
      (candidate) => candidate.username.toLocaleLowerCase() === normalizedUsername
    );
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new HttpError(401, "Invalid credentials");
    }
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
      expiresIn: "7d",
    });
    res.json({ ok: true, token, username: user.username });
  })
);

app.get("/api/notes", authenticateToken, (req, res) => {
  const notes = readData(NOTES_FILE)
    .filter((note) => note.userId === req.user.id)
    .map(serializeNote);
  res.json({ ok: true, notes });
});

app.post("/api/notes", authenticateToken, (req, res) => {
  const body = requireObject(req.body);
  const mood = readMood(body.mood);
  const text = readString(body.text, "text", { required: false, max: 100 });
  const img = readImage(body.img);
  const notes = readData(NOTES_FILE);
  const note = {
    id: uid(),
    userId: req.user.id,
    text,
    mood,
    img,
    createdAt: new Date().toISOString(),
  };
  notes.unshift(note);
  writeData(NOTES_FILE, notes);
  res.status(201).json({ ok: true, note: serializeNote(note) });
});

app.delete("/api/notes/:id", authenticateToken, (req, res) => {
  const notes = readData(NOTES_FILE);
  const index = notes.findIndex(
    (note) => note.id === req.params.id && note.userId === req.user.id
  );
  if (index === -1) throw new HttpError(404, "Note not found");
  notes.splice(index, 1);
  writeData(NOTES_FILE, notes);
  res.json({ ok: true });
});

app.get("/api/suggestions", (req, res) => {
  let userId = null;
  const authHeader = req.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match) {
    try {
      userId = jwt.verify(match[1], JWT_SECRET).id;
    } catch {}
  }

  const suggestions = readData(SUGGEST_FILE)
    .filter((suggestion) => {
      const dislikedBy = Array.isArray(suggestion.dislikedBy)
        ? suggestion.dislikedBy
        : [];
      return dislikedBy.length < 5;
    })
    .map((suggestion) => serializeSuggestion(suggestion, userId));
  res.json({ ok: true, suggestions });
});

app.post("/api/suggestions", authenticateToken, (req, res) => {
  const body = requireObject(req.body);
  const mood = readMood(body.mood);
  const title = readString(body.title, "title", { max: 80 });
  const desc = readString(body.desc, "desc", { max: 300 });
  const suggestions = readData(SUGGEST_FILE);
  const suggestion = {
    id: uid(),
    userId: req.user.id,
    username: req.user.username,
    mood,
    title,
    desc,
    likedBy: [],
    dislikedBy: [],
    createdAt: new Date().toISOString(),
  };
  suggestions.unshift(suggestion);
  writeData(SUGGEST_FILE, suggestions);
  res.status(201).json({
    ok: true,
    suggestion: serializeSuggestion(suggestion, req.user.id),
  });
});

app.post("/api/suggestions/:id/vote", authenticateToken, (req, res) => {
  const body = requireObject(req.body);
  const action = readString(body.action, "action", { max: 10 });
  if (!new Set(["like", "dislike"]).has(action)) {
    throw new HttpError(400, "Unsupported vote action");
  }

  const suggestions = readData(SUGGEST_FILE);
  const suggestion = suggestions.find((item) => item.id === req.params.id);
  if (!suggestion) throw new HttpError(404, "Suggestion not found");
  if (!Array.isArray(suggestion.likedBy)) suggestion.likedBy = [];
  if (!Array.isArray(suggestion.dislikedBy)) suggestion.dislikedBy = [];

  const userId = req.user.id;
  if (action === "like") {
    if (suggestion.likedBy.includes(userId)) {
      suggestion.likedBy = suggestion.likedBy.filter((id) => id !== userId);
    } else {
      suggestion.likedBy.push(userId);
      suggestion.dislikedBy = suggestion.dislikedBy.filter((id) => id !== userId);
    }
  } else if (suggestion.dislikedBy.includes(userId)) {
    suggestion.dislikedBy = suggestion.dislikedBy.filter((id) => id !== userId);
  } else {
    suggestion.dislikedBy.push(userId);
    suggestion.likedBy = suggestion.likedBy.filter((id) => id !== userId);
  }

  writeData(SUGGEST_FILE, suggestions);
  res.json({ ok: true, suggestion: serializeSuggestion(suggestion, userId) });
});

app.get("/api/posts", authenticateToken, (req, res) => {
  const posts = readData(POSTS_FILE).map((post) => serializePost(post, req.user.id));
  res.json({ ok: true, posts });
});

app.post("/api/posts", authenticateToken, (req, res) => {
  const body = requireObject(req.body);
  const title = readString(body.title, "title", { max: 100 });
  const mood = readMood(body.mood);
  const text = readString(body.text, "text", { max: 1000 });
  const img = readImage(body.img);
  const isAnonymous = body.isAnonymous === true;
  const posts = readData(POSTS_FILE);
  const post = {
    id: uid(),
    userId: req.user.id,
    username: isAnonymous ? "Anonymous" : req.user.username,
    title,
    mood,
    text,
    img,
    likedBy: [],
    comments: [],
    createdAt: new Date().toISOString(),
  };
  posts.unshift(post);
  writeData(POSTS_FILE, posts);
  res.status(201).json({ ok: true, post: serializePost(post, req.user.id) });
});

app.delete("/api/posts/:id", authenticateToken, (req, res) => {
  const posts = readData(POSTS_FILE);
  const index = posts.findIndex((post) => post.id === req.params.id);
  if (index === -1) throw new HttpError(404, "Post not found");
  if (posts[index].userId !== req.user.id) throw new HttpError(403, "Unauthorized");
  posts.splice(index, 1);
  writeData(POSTS_FILE, posts);
  res.json({ ok: true });
});

app.post("/api/posts/:id/like", authenticateToken, (req, res) => {
  const posts = readData(POSTS_FILE);
  const post = posts.find((item) => item.id === req.params.id);
  if (!post) throw new HttpError(404, "Post not found");
  if (!Array.isArray(post.likedBy)) post.likedBy = [];
  const userIndex = post.likedBy.indexOf(req.user.id);
  if (userIndex > -1) post.likedBy.splice(userIndex, 1);
  else post.likedBy.push(req.user.id);
  writeData(POSTS_FILE, posts);
  res.json({ ok: true, post: serializePost(post, req.user.id) });
});

app.post("/api/posts/:id/comment", authenticateToken, (req, res) => {
  const body = requireObject(req.body);
  const text = readString(body.text, "text", { max: 300 });
  const posts = readData(POSTS_FILE);
  const post = posts.find((item) => item.id === req.params.id);
  if (!post) throw new HttpError(404, "Post not found");
  if (!Array.isArray(post.comments)) post.comments = [];
  const comment = {
    id: uid(),
    username: req.user.username,
    text,
    createdAt: new Date().toISOString(),
  };
  post.comments.push(comment);
  writeData(POSTS_FILE, posts);
  res.status(201).json({ ok: true, comment });
});

app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, error: "API route not found" });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || (error.type === "entity.too.large" ? 413 : 500);
  if (status >= 500) console.error(error);
  const message = status >= 500 ? "Internal server error" : error.message;
  res.status(status).json({ ok: false, error: message });
});

function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`Oasis running on: http://localhost:${port}`);
  });
}

if (require.main === module) startServer();

module.exports = { app, startServer };
