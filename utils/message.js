const MEDIA_TYPES = ["imageMessage", "videoMessage"];

const unwrapMessageContent = (content) => {
  if (!content) return {};
  if (content.ephemeralMessage) return unwrapMessageContent(content.ephemeralMessage.message);
  if (content.viewOnceMessage) return unwrapMessageContent(content.viewOnceMessage.message);
  if (content.viewOnceMessageV2) return unwrapMessageContent(content.viewOnceMessageV2.message);
  if (content.viewOnceMessageV2Extension) {
    return unwrapMessageContent(content.viewOnceMessageV2Extension.message);
  }
  return content;
};

const getMessageType = (content) => {
  const normalized = unwrapMessageContent(content);
  return Object.keys(normalized)[0];
};

const extractText = (message) => {
  const content = unwrapMessageContent(message.message);

  if (content.conversation) return content.conversation;
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
  if (content.imageMessage?.caption) return content.imageMessage.caption;
  if (content.videoMessage?.caption) return content.videoMessage.caption;
  if (content.buttonsResponseMessage?.selectedButtonId) {
    return content.buttonsResponseMessage.selectedButtonId;
  }
  if (content.listResponseMessage?.singleSelectReply?.selectedRowId) {
    return content.listResponseMessage.singleSelectReply.selectedRowId;
  }
  if (content.templateButtonReplyMessage?.selectedId) {
    return content.templateButtonReplyMessage.selectedId;
  }
  return "";
};

const parseCommand = (text, prefix) => {
  const trimmed = (text || "").trim();
  if (!trimmed.startsWith(prefix)) return { command: null, args: [] };

  const parts = trimmed.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
  const command = (parts.shift() || "").toLowerCase();
  return { command, args: parts };
};

const getMediaTarget = (message) => {
  const normalized = unwrapMessageContent(message.message);
  const type = getMessageType(normalized);

  if (MEDIA_TYPES.includes(type)) {
    return {
      type,
      targetMessage: {
        key: message.key,
        message: normalized
      },
      seconds: normalized.videoMessage?.seconds || 0
    };
  }

  const contextInfo =
    normalized.extendedTextMessage?.contextInfo ||
    normalized.imageMessage?.contextInfo ||
    normalized.videoMessage?.contextInfo;

  const quotedMessage = contextInfo?.quotedMessage;
  if (!quotedMessage) return null;

  const normalizedQuoted = unwrapMessageContent(quotedMessage);
  const quotedType = getMessageType(normalizedQuoted);
  if (!MEDIA_TYPES.includes(quotedType)) return null;

  return {
    type: quotedType,
    targetMessage: {
      key: {
        remoteJid: message.key.remoteJid,
        fromMe: false,
        id: contextInfo.stanzaId,
        participant: contextInfo.participant
      },
      message: normalizedQuoted
    },
    seconds: normalizedQuoted.videoMessage?.seconds || 0
  };
};

module.exports = {
  extractText,
  parseCommand,
  getMessageType,
  unwrapMessageContent,
  getMediaTarget
};
