const menuHandler = require("./menu");
const pingHandler = require("./ping");
const stickerHandler = require("./sticker");
const bratHandler = require("./brat");
const bratVidHandler = require("./bratvid");

const handlers = [
  menuHandler,
  pingHandler,
  stickerHandler,
  bratHandler,
  bratVidHandler
];

const commandMap = new Map();
for (const handler of handlers) {
  for (const command of handler.commands) {
    commandMap.set(command, handler);
  }
}

const getHandler = (command) => commandMap.get(command.toLowerCase());

module.exports = {
  handlers,
  getHandler
};
