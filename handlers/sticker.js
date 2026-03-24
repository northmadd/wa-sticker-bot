const pino = require("pino");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { imageToWebp, videoToWebp } = require("../utils/converter");
const { getMediaTarget } = require("../utils/message");

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
            text: `Kirim/reply gambar atau video dulu ya.\nContoh: ${prefix}sticker atau ${prefix}s`
          },
          { quoted: message }
        );
        return;
      }

      if (mediaTarget.type === "videoMessage" && Number(mediaTarget.seconds || 0) > 10) {
        await sock.sendMessage(
          jid,
          { text: "Video kepanjangan bro, maksimal 10 detik aja buat sticker." },
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
          : await videoToWebp(mediaBuffer, 10);

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
