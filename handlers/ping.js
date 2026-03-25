const { MAX_VIDEO_STICKER_SECONDS } = require("../utils/converter");
const { getRuntimeLabel } = require("../utils/runtime");

module.exports = {
  name: "ping",
  commands: ["ping"],
  execute: async ({ sock, jid, message }) => {
    const now = Date.now();
    const msgTs = Number(message.messageTimestamp || 0) * 1000;
    const latency = msgTs > 0 ? Math.max(0, now - msgTs) : 0;

    await sock.sendMessage(
      jid,
      {
        text: `Ping! ${latency} ms\nLimit video: ${MAX_VIDEO_STICKER_SECONDS} detik\nRuntime: ${getRuntimeLabel()}`
      },
      { quoted: message }
    );
  }
};
