const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const { parse: parseEmoji } = require("twemoji-parser");

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const TMP_DIR = path.join(os.tmpdir(), "northmadbot");
const WATERMARK = "northmadbot";
const BRAT_FONT_PATH = path.join(__dirname, "..", "assets", "font.ttf");
const ENABLE_WATERMARK = String(process.env.ENABLE_WATERMARK || "false").toLowerCase() === "true";

const BRAT_BG_HEX = "#EDEDED";
const BRAT_FONT_COLOR = "#111111";
const BRAT_FONT_SIZE = 66;
const BRAT_X = 40;
const BRAT_LINE_SPACING = 78;
const BRAT_MAX_CHARS = 18;
const BRAT_MAX_LINES = 5;
const BRAT_CANVAS_SIZE = 512;
const BRAT_MAX_WIDTH = BRAT_CANVAS_SIZE - BRAT_X * 2;
const BRAT_EMOJI_SIZE = 60;

let bratFontReady = false;
const emojiImageCache = new Map();
const emojiUrlCache = new Map();

const ensureTmpDir = async () => {
  await fs.mkdir(TMP_DIR, { recursive: true });
};

const randomName = (ext) => `${crypto.randomBytes(8).toString("hex")}.${ext}`;

const escapeFfmpegText = (text) =>
  String(text)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\n/g, "\\n");

const escapeFfmpegPath = (filePath) =>
  path
    .resolve(filePath)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");

const buildWatermarkFilter = () => {
  if (!ENABLE_WATERMARK) return "";

  const escapedWatermark = escapeFfmpegText(WATERMARK);
  const base = `text='${escapedWatermark}':fontcolor=white:fontsize=20:borderw=2:bordercolor=black:x=w-tw-12:y=h-th-12`;

  if (fsSync.existsSync(BRAT_FONT_PATH)) {
    const escapedFontPath = escapeFfmpegPath(BRAT_FONT_PATH);
    return `,drawtext=fontfile='${escapedFontPath}':${base}`;
  }

  return `,drawtext=${base}`;
};

const shouldRetryWithoutWatermark = (message) =>
  /drawtext|no such filter|filter not found|cannot find a valid font|invalid argument/i.test(
    String(message || "")
  );

const runFfmpeg = (command, outputPath) =>
  new Promise((resolve, reject) => {
    let ffmpegStderr = "";
    command
      .save(outputPath)
      .on("stderr", (line) => {
        ffmpegStderr = line || ffmpegStderr;
      })
      .on("end", resolve)
      .on("error", (error) => {
        reject(new Error(`${error.message}${ffmpegStderr ? ` | ${ffmpegStderr}` : ""}`));
      });
  });

const ensureBratFont = () => {
  if (bratFontReady) return;
  if (!fsSync.existsSync(BRAT_FONT_PATH)) return;

  try {
    GlobalFonts.registerFromPath(BRAT_FONT_PATH, "BratFont");
    bratFontReady = true;
  } catch {
    bratFontReady = false;
  }
};

const getGraphemes = (text) => {
  const input = String(text || "");
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter("id", { granularity: "grapheme" });
    return Array.from(segmenter.segment(input), (s) => s.segment);
  }
  return Array.from(input);
};

const getEmojiUrl = (grapheme) => {
  if (emojiUrlCache.has(grapheme)) return emojiUrlCache.get(grapheme);

  const parsed = parseEmoji(grapheme);
  const emoji = parsed.length === 1 && parsed[0].text === grapheme ? parsed[0].url : null;
  emojiUrlCache.set(grapheme, emoji);
  return emoji;
};

const measureByGrapheme = (ctx, text) => {
  let width = 0;
  for (const grapheme of getGraphemes(text)) {
    width += getEmojiUrl(grapheme) ? BRAT_EMOJI_SIZE : ctx.measureText(grapheme).width;
  }
  return width;
};

const splitLongWord = (ctx, word, maxWidth) => {
  const chunks = [];
  let current = "";
  let currentWidth = 0;

  for (const grapheme of getGraphemes(word)) {
    const w = getEmojiUrl(grapheme) ? BRAT_EMOJI_SIZE : ctx.measureText(grapheme).width;
    if (current && currentWidth + w > maxWidth) {
      chunks.push(current);
      current = grapheme;
      currentWidth = w;
    } else {
      current += grapheme;
      currentWidth += w;
    }
  }

  if (current) chunks.push(current);
  return chunks;
};

const splitBratLines = (ctx, text) => {
  const safe = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  if (!safe) return ["brat"];

  const words = safe.split(" ");
  const lines = [];
  let line = "";
  let lineWidth = 0;
  const spaceWidth = ctx.measureText(" ").width;
  const roughMaxWidth = BRAT_MAX_CHARS * (BRAT_FONT_SIZE * 0.55);
  const maxWidth = Math.min(BRAT_MAX_WIDTH, roughMaxWidth);

  for (const rawWord of words) {
    if (!rawWord) continue;

    const wordParts = measureByGrapheme(ctx, rawWord) > maxWidth ? splitLongWord(ctx, rawWord, maxWidth) : [rawWord];

    for (const word of wordParts) {
      const wordWidth = measureByGrapheme(ctx, word);
      const required = line ? lineWidth + spaceWidth + wordWidth : wordWidth;

      if (!line || required <= maxWidth) {
        line = line ? `${line} ${word}` : word;
        lineWidth = required;
      } else {
        lines.push(line);
        if (lines.length >= BRAT_MAX_LINES) return lines;
        line = word;
        lineWidth = wordWidth;
      }
    }

    if (lines.length >= BRAT_MAX_LINES) break;
  }

  if (line && lines.length < BRAT_MAX_LINES) lines.push(line);
  return lines.slice(0, BRAT_MAX_LINES);
};

const getBratBaseY = (lineCount) => {
  const count = Math.max(1, Number(lineCount || 1));
  const totalHeight = count * BRAT_LINE_SPACING;
  return Math.max(36, Math.floor((BRAT_CANVAS_SIZE - totalHeight) / 2));
};

const drawLineWithEmoji = async (ctx, line, x, y) => {
  let cursor = x;
  let textRun = "";

  const flushText = () => {
    if (!textRun) return;
    ctx.fillText(textRun, cursor, y);
    cursor += measureByGrapheme(ctx, textRun);
    textRun = "";
  };

  for (const grapheme of getGraphemes(line)) {
    const emojiUrl = getEmojiUrl(grapheme);

    if (!emojiUrl) {
      textRun += grapheme;
      continue;
    }

    flushText();

    try {
      let emojiImage = emojiImageCache.get(emojiUrl);
      if (!emojiImage) {
        emojiImage = await loadImage(emojiUrl);
        emojiImageCache.set(emojiUrl, emojiImage);
      }
      const emojiY = y + Math.max(0, Math.floor((BRAT_FONT_SIZE - BRAT_EMOJI_SIZE) / 2));
      ctx.drawImage(emojiImage, cursor, emojiY, BRAT_EMOJI_SIZE, BRAT_EMOJI_SIZE);
      cursor += BRAT_EMOJI_SIZE;
    } catch {
      ctx.fillText(grapheme, cursor, y);
      cursor += ctx.measureText(grapheme).width;
    }
  }

  flushText();
};

const imageToWebp = async (buffer) => {
  await ensureTmpDir();
  const inputPath = path.join(TMP_DIR, randomName("jpg"));
  const outputPath = path.join(TMP_DIR, randomName("webp"));

  await fs.writeFile(inputPath, buffer);

  const runConvert = (withWatermark) => {
    const watermark = withWatermark ? buildWatermarkFilter() : "";

    return runFfmpeg(
      ffmpeg(inputPath).outputOptions([
        "-vcodec",
        "libwebp",
        "-vf",
        `format=rgba,scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000${watermark}`,
        "-pix_fmt",
        "yuva420p",
        "-lossless",
        "0",
        "-q:v",
        "60",
        "-compression_level",
        "6",
        "-preset",
        "picture",
        "-loop",
        "0",
        "-an",
        "-vsync",
        "0"
      ]),
      outputPath
    );
  };

  try {
    try {
      await runConvert(ENABLE_WATERMARK);
    } catch (error) {
      if (ENABLE_WATERMARK && shouldRetryWithoutWatermark(error.message)) {
        await runConvert(false);
      } else {
        throw error;
      }
    }

    return await fs.readFile(outputPath);
  } finally {
    await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);
  }
};

const videoToWebp = async (buffer, maxSeconds = 10) => {
  await ensureTmpDir();
  const inputPath = path.join(TMP_DIR, randomName("mp4"));
  const outputPath = path.join(TMP_DIR, randomName("webp"));
  const safeDuration = Math.min(Math.max(maxSeconds, 1), 10);

  await fs.writeFile(inputPath, buffer);

  const runConvert = (withWatermark) => {
    const watermark = withWatermark ? buildWatermarkFilter() : "";

    return runFfmpeg(
      ffmpeg(inputPath).outputOptions([
        "-t",
        String(safeDuration),
        "-vcodec",
        "libwebp",
        "-vf",
        `fps=15,format=rgba,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000${watermark}`,
        "-pix_fmt",
        "yuva420p",
        "-loop",
        "0",
        "-an",
        "-vsync",
        "0",
        "-s",
        "512:512",
        "-preset",
        "default"
      ]),
      outputPath
    );
  };

  try {
    try {
      await runConvert(ENABLE_WATERMARK);
    } catch (error) {
      if (ENABLE_WATERMARK && shouldRetryWithoutWatermark(error.message)) {
        await runConvert(false);
      } else {
        throw error;
      }
    }

    return await fs.readFile(outputPath);
  } finally {
    await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);
  }
};

const bratTextToWebp = async (text) => {
  ensureBratFont();

  const canvas = createCanvas(BRAT_CANVAS_SIZE, BRAT_CANVAS_SIZE);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BRAT_BG_HEX;
  ctx.fillRect(0, 0, BRAT_CANVAS_SIZE, BRAT_CANVAS_SIZE);

  ctx.fillStyle = BRAT_FONT_COLOR;
  ctx.textBaseline = "top";
  ctx.font = bratFontReady ? `${BRAT_FONT_SIZE}px BratFont` : `${BRAT_FONT_SIZE}px sans-serif`;

  const lines = splitBratLines(ctx, text);
  const baseY = getBratBaseY(lines.length);

  for (let i = 0; i < lines.length; i += 1) {
    await drawLineWithEmoji(ctx, lines[i], BRAT_X, baseY + i * BRAT_LINE_SPACING);
  }

  const pngBuffer = canvas.toBuffer("image/png");
  return imageToWebp(pngBuffer);
};

module.exports = {
  imageToWebp,
  videoToWebp,
  bratTextToWebp
};
