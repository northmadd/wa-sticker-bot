const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR;
const DEFAULT_DB_PATH = DATA_DIR
  ? path.join(DATA_DIR, "database", "db.json")
  : path.join(__dirname, "..", "database", "db.json");
const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;
const DB_DIR = path.dirname(DB_PATH);
const INITIAL_DB = {
  chats: {}
};

const ensureDBFile = () => {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(INITIAL_DB, null, 2));
  }
};

const loadDB = () => {
  ensureDBFile();
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const data = JSON.parse(raw);
    if (!data.chats || typeof data.chats !== "object") data.chats = {};
    return data;
  } catch (error) {
    console.error("DB rusak, reset ke default:", error.message);
    fs.writeFileSync(DB_PATH, JSON.stringify(INITIAL_DB, null, 2));
    return { ...INITIAL_DB };
  }
};

const saveDB = async (db) => {
  ensureDBFile();
  await fs.promises.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
};

module.exports = {
  DB_PATH,
  ensureDBFile,
  loadDB,
  saveDB
};
