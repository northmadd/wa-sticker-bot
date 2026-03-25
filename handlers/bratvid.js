const pino = require("pino");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const {
  MAX_VIDEO_STICKER_SECONDS,
  videoToWebp,
  bratTextToAnimatedWebp
} = require("../utils/converter");
const { getMediaTarget } = require("../utils/message");
const { getRuntimeLabel } = require("../utils/runtime");

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
            text: `Kirim teks atau reply video dulu ya (max ${MAX_VIDEO_STICKER_SECONDS} detik).\nContoh: ${prefix}bratvid uang gabisa beli kebahagiaan`
          },
          { quoted: message }
        );
        return;
      }

      if (Number(mediaTarget.seconds || 0) > MAX_VIDEO_STICKER_SECONDS) {
        const detectedSeconds = Number(mediaTarget.seconds || 0);
        console.log(
          `[bratvid] reject video duration=${detectedSeconds}s limit=${MAX_VIDEO_STICKER_SECONDS}s runtime=${getRuntimeLabel()}`
        );
        await sock.sendMessage(
          jid,
          {
            text: `Video kebaca ${detectedSeconds} detik.\nLimit bot saat ini ${MAX_VIDEO_STICKER_SECONDS} detik buat bratvid.`
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
        throw new Error("Media video tidak terbaca");
      }

      const stickerBuffer = await videoToWebp(mediaBuffer, MAX_VIDEO_STICKER_SECONDS);
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
