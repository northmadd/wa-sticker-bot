const pino = require("pino");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { videoToWebp, bratTextToAnimatedWebp } = require("../utils/converter");
const { getMediaTarget } = require("../utils/message");

const BAILEYS_LOG = pino({ level: "silent" });

module.exports = {
  name: "bratvid",
  commands: ["bratvid"],
  execute: async ({ sock, jid, message, prefix, args }) => {
    try {
      const text = args.join(" ").trim();
      if (text) {
        if (text.length > 180) {
          await sock.sendMessage(
            jid,
            { text: "Teks terlalu panjang. Maksimal 180 karakter ya." },
            { quoted: message }
          );
          return;
        }

        const animatedSticker = await bratTextToAnimatedWebp(text);
        await sock.sendMessage(jid, { sticker: animatedSticker }, { quoted: message });
        return;
      }

      const mediaTarget = getMediaTarget(message);
      if (!mediaTarget || mediaTarget.type !== "videoMessage") {
        await sock.sendMessage(
          jid,
          {
            text: `Kirim teks atau reply video dulu ya (max 10 detik).\nContoh: ${prefix}bratvid uang gabisa beli kebahagiaan`
          },
          { quoted: message }
        );
        return;
      }

      if (Number(mediaTarget.seconds || 0) > 10) {
        await sock.sendMessage(
          jid,
          { text: "Video lebih dari 10 detik, potong dulu ya bro." },
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
        throw new Error("Media video tidak terbaca");
      }

      const stickerBuffer = await videoToWebp(mediaBuffer, 10);
      await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: message });
    } catch (error) {
      console.error("Error .bratvid:", error.message);
      await sock.sendMessage(
        jid,
        { text: "Gagal bikin bratvid. Coba teks/video lain ya." },
        { quoted: message }
      );
    }
  }
};
