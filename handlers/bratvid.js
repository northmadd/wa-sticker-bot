const pino = require("pino");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const { videoToWebp } = require("../utils/converter");
const { getMediaTarget } = require("../utils/message");

const BAILEYS_LOG = pino({ level: "silent" });

module.exports = {
  name: "bratvid",
  commands: ["bratvid"],
  execute: async ({ sock, jid, message, prefix }) => {
    const mediaTarget = getMediaTarget(message);
    if (!mediaTarget || mediaTarget.type !== "videoMessage") {
      await sock.sendMessage(
        jid,
        {
          text: `Kirim/reply video dulu ya (max 10 detik), terus ketik ${prefix}bratvid`
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

    const stickerBuffer = await videoToWebp(mediaBuffer, 10);
    await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: message });
  }
};
