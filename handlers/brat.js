const { bratTextToWebp } = require("../utils/converter");

module.exports = {
  name: "brat",
  commands: ["brat"],
  execute: async ({ sock, jid, message, args, prefix }) => {
    const text = args.join(" ").trim();
    if (!text) {
      await sock.sendMessage(
        jid,
        { text: `Format salah bro.\nContoh: ${prefix}brat halo semua` },
        { quoted: message }
      );
      return;
    }

    if (text.length > 120) {
      await sock.sendMessage(
        jid,
        { text: "Teksnya kepanjangan, maksimal 120 karakter ya." },
        { quoted: message }
      );
      return;
    }

    try {
      const stickerBuffer = await bratTextToWebp(text);
      await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: message });
    } catch (error) {
      console.error("Error .brat:", error.message);
      await sock.sendMessage(
        jid,
        { text: "Generate brat gagal. Coba teks yang lebih pendek ya." },
        { quoted: message }
      );
    }
  }
};
