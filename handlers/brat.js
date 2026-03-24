const axios = require("axios");
const { imageToWebp } = require("../utils/converter");

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
      const url = `https://brat.caliphdev.com/api/brat?text=${encodeURIComponent(text)}`;
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 20000
      });

      const imageBuffer = Buffer.from(response.data);
      const stickerBuffer = await imageToWebp(imageBuffer);
      await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: message });
    } catch (error) {
      console.error("Error .brat:", error.message);
      await sock.sendMessage(
        jid,
        { text: "Endpoint brat lagi rewel. Coba lagi bentar ya 🙏" },
        { quoted: message }
      );
    }
  }
};
