const pino = require("pino");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const {
  MAX_VIDEO_STICKER_SECONDS,
  imageToWebp,
  videoToWebp
} = require("../utils/converter");
const { getMediaTarget } = require("../utils/message");
const { getRuntimeLabel } = require("../utils/runtime");

const BAILEYS_LOG = pino({ level: "silent" });

module.exports = {
  name: "sticker",
  commands: ["sticker", "s"],
  execute: async ({ sock, jid, message, prefix }) => {
    try {
      const mediaTarget = getMediaTarget(message);
      if (!mediaTarget) {
        await sock.sendMessage(
          jid,
          {
            text: `Kirim/reply gambar atau video dulu ya.\nKalau video, maksimal ${MAX_VIDEO_STICKER_SECONDS} detik.\nContoh: ${prefix}sticker atau ${prefix}s`
          },
          { quoted: message }
        );
        return;
      }

      if (
        mediaTarget.type === "videoMessage" &&
        Number(mediaTarget.seconds || 0) > MAX_VIDEO_STICKER_SECONDS
      ) {
        const detectedSeconds = Number(mediaTarget.seconds || 0);
        console.log(
          `[sticker] reject video duration=${detectedSeconds}s limit=${MAX_VIDEO_STICKER_SECONDS}s runtime=${getRuntimeLabel()}`
        );
        await sock.sendMessage(
          jid,
          {
            text: `Video kebaca ${detectedSeconds} detik.\nLimit bot saat ini ${MAX_VIDEO_STICKER_SECONDS} detik buat sticker.`
          },
          { quoted: message }
        );
        return;
      }

      const mediaBuffer = await downloadMediaMessage(
        mediaTarget.targetMessage,
        "buffer",
        {},
        {
          logger: BAILEYS_LOG,
          reuploadRequest: sock.updateMediaMessage
        }
      );

      if (!mediaBuffer || !Buffer.isBuffer(mediaBuffer)) {
        throw new Error("Media tidak terbaca");
      }

      const stickerBuffer =
        mediaTarget.type === "imageMessage"
          ? await imageToWebp(mediaBuffer)
          : await videoToWebp(mediaBuffer, MAX_VIDEO_STICKER_SECONDS);

      await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: message });
    } catch (error) {
      console.error("Error .sticker:", error.message);
      await sock.sendMessage(
        jid,
        { text: "Gagal bikin sticker. Coba kirim media lain atau ulangi lagi." },
        { quoted: message }
      );
    }
  }
};
