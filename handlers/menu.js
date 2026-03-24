const getMenuText = (prefix = ".") => `╭───「 NORTHMADBOT 」
│
├ ${prefix}menu
├ ${prefix}ping
├ ${prefix}sticker / ${prefix}s
├ ${prefix}brat <text>
├ ${prefix}bratvid
│
╰─────────────

Ketik ${prefix}menu 😎`;

module.exports = {
  name: "menu",
  commands: ["menu"],
  getMenuText,
  execute: async ({ sock, jid, message, prefix }) => {
    await sock.sendMessage(jid, { text: getMenuText(prefix) }, { quoted: message });
  }
};
