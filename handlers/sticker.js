const pino = require("pino");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { imageToWebp, videoToWebp } = require("../utils/converter");
const { getMediaTarget } = require("../utils/message");

const BAILEYS_LOG = pino({ level: "silent" });

module.exports = {
  name: "sticker",
  commands: ["sticker", "s"],
  execute: async ({ sock, jid, message, prefix }) => {
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
        { text: "Video kepanjangan bro, maksimal 10 detik aja buat sticker 😎" },
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

    const stickerBuffer =
      mediaTarget.type === "imageMessage"
        ? await imageToWebp(mediaBuffer)
        : await videoToWebp(mediaBuffer, 10);

    await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: message });
  }
};
