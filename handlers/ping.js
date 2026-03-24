module.exports = {
  name: "ping",
  commands: ["ping"],
  execute: async ({ sock, jid, message }) => {
    const now = Date.now();
    const msgTs = Number(message.messageTimestamp || 0) * 1000;
    const latency = msgTs > 0 ? Math.max(0, now - msgTs) : 0;

    await sock.sendMessage(
      jid,
      { text: `Pong! ⚡ ${latency} ms\nBot aman, santai aja 😎` },
      { quoted: message }
    );
  }
};
