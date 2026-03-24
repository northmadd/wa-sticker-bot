const fs = require("fs");
const path = require("path");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const { Boom } = require("@hapi/boom");
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} = require("@whiskeysockets/baileys");

const { loadDB, saveDB, ensureDBFile } = require("./utils/database");
const { extractText, parseCommand } = require("./utils/message");
const { getHandler } = require("./handlers");
const { getMenuText } = require("./handlers/menu");

const DATA_DIR = process.env.DATA_DIR || __dirname;
const BOT_NAME = process.env.BOT_NAME || "northmadbot";
const PREFIX = process.env.PREFIX || ".";
const SESSION_DIR = process.env.SESSION_DIR || path.join(DATA_DIR, "session");
const USE_PAIRING_CODE = String(process.env.USE_PAIRING_CODE || "false").toLowerCase() === "true";
const PAIRING_NUMBER = String(process.env.PAIRING_NUMBER || "").replace(/\D/g, "");
const LOG = pino({ level: "silent" });

let db = null;

const ensureRuntimeDirs = () => {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
  ensureDBFile();
};

const startBot = async () => {
  ensureRuntimeDirs();
  db = loadDB();

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: LOG,
    browser: [BOT_NAME, "Chrome", "1.0.0"],
    printQRInTerminal: false
  });

  if (USE_PAIRING_CODE && !sock.authState.creds.registered) {
    if (!PAIRING_NUMBER) {
      console.log("USE_PAIRING_CODE aktif tapi PAIRING_NUMBER belum diisi.");
    } else {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(PAIRING_NUMBER);
          console.log(`\nPairing code: ${code}`);
          console.log("Buka WhatsApp > Linked Devices > Link with phone number.");
        } catch (error) {
          console.error("Gagal generate pairing code:", error.message);
        }
      }, 2000);
    }
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan QR ini di WhatsApp kamu:\n");
      qrcode.generate(qr, { small: true });
      const qrUrl = `https://quickchart.io/qr?size=300&text=${encodeURIComponent(qr)}`;
      console.log(`Kalau QR kepotong di log, buka ini: ${qrUrl}`);
    }

    if (connection === "open") {
      console.log(`\n${BOT_NAME} terkoneksi dan siap dipakai.`);
    }

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log("Koneksi putus, coba reconnect...");
        setTimeout(startBot, 3000);
      } else {
        console.log(`Session logout. Hapus folder ${SESSION_DIR} lalu scan QR ulang.`);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    const message = messages?.[0];
    if (!message || !message.message || message.key.fromMe) return;

    const jid = message.key.remoteJid;
    if (!jid || jid === "status@broadcast") return;

    try {
      if (!db.chats[jid]) {
        db.chats[jid] = {
          firstSeenAt: new Date().toISOString(),
          menuSent: true
        };
        await sock.sendMessage(jid, { text: getMenuText(PREFIX) });
        await saveDB(db);
      }

      const text = extractText(message);
      if (!text || !text.startsWith(PREFIX)) return;

      const { command, args } = parseCommand(text, PREFIX);
      if (!command) return;

      const handler = getHandler(command);
      if (!handler) return;

      await handler.execute({
        sock,
        message,
        jid,
        args,
        text,
        prefix: PREFIX,
        botName: BOT_NAME,
        db,
        saveDB: () => saveDB(db)
      });
    } catch (error) {
      console.error("Error handle message:", error);
      await sock.sendMessage(
        jid,
        { text: "Waduh error dikit nih. Coba ulang bentar ya 😅" },
        { quoted: message }
      );
    }
  });
};

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

startBot().catch((error) => {
  console.error("Gagal jalanin bot:", error);
  process.exit(1);
});
