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
const BRAT_FONT_SIZE_MAX = 108;
const BRAT_FONT_SIZE_MIN = 44;
const BRAT_PADDING = 40;
const BRAT_LINE_SPACING_RATIO = 1;
const BRAT_MAX_LINES = 5;
const BRAT_CANVAS_SIZE = 512;
const BRAT_MAX_WIDTH = BRAT_CANVAS_SIZE - BRAT_PADDING * 2;
const BRAT_MAX_HEIGHT = BRAT_CANVAS_SIZE - BRAT_PADDING * 2;
const BRAT_EMOJI_SCALE = 0.96;
const BRAT_SPACE_COMPRESS = 0.8;
const BRAT_JUSTIFY_THRESHOLD = 0.56;
const BRAT_SOFTEN_SCALE = 0.84;
const BRAT_SOFTEN_PASSES = 2;
const BRAT_BOLD_PASSES = [
  { dx: -1.2, dy: 0, alpha: 0.98 },
  { dx: 1.2, dy: 0, alpha: 0.98 },
  { dx: 0, dy: -0.8, alpha: 0.9 },
  { dx: 0, dy: 0.8, alpha: 0.9 },
  { dx: -0.8, dy: -0.8, alpha: 0.82 },
  { dx: 0.8, dy: 0.8, alpha: 0.82 }
];
const BRAT_BLUR_PASSES = [
  { dx: -6, dy: 0, alpha: 0.16 },
  { dx: 6, dy: 0, alpha: 0.16 },
  { dx: 0, dy: -6, alpha: 0.15 },
  { dx: 0, dy: 6, alpha: 0.15 },
  { dx: -4, dy: -4, alpha: 0.14 },
  { dx: 4, dy: 4, alpha: 0.14 },
  { dx: -3, dy: 3, alpha: 0.12 },
  { dx: 3, dy: -3, alpha: 0.12 },
  { dx: -8, dy: 0, alpha: 0.08 },
  { dx: 8, dy: 0, alpha: 0.08 }
];
const BRAT_ANIM_FPS = 12;
const BRAT_ANIM_FRAMES = 22;
const RAW_MAX_VIDEO_STICKER_SECONDS = Number(process.env.MAX_VIDEO_STICKER_SECONDS || 30);
const MAX_VIDEO_STICKER_SECONDS =
  Number.isFinite(RAW_MAX_VIDEO_STICKER_SECONDS) && RAW_MAX_VIDEO_STICKER_SECONDS > 0
    ? Math.floor(RAW_MAX_VIDEO_STICKER_SECONDS)
    : 30;

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

const measureByGrapheme = (ctx, text, emojiSize) => {
  let width = 0;
  for (const grapheme of getGraphemes(text)) {
    width += getEmojiUrl(grapheme) ? emojiSize : ctx.measureText(grapheme).width;
  }
  return width;
};

const measureWordsWidth = (ctx, words, emojiSize) =>
  words.reduce((total, word) => total + measureByGrapheme(ctx, word, emojiSize), 0);

const splitLongWord = (ctx, word, maxWidth, emojiSize) => {
  const chunks = [];
  let current = "";
  let currentWidth = 0;

  for (const grapheme of getGraphemes(word)) {
    const w = getEmojiUrl(grapheme) ? emojiSize : ctx.measureText(grapheme).width;
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

const splitBratLines = (ctx, text, fontSize, emojiSize) => {
  const safe = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  if (!safe) return ["brat"];

  const words = safe.split(" ");
  const lines = [];
  let line = "";
  let lineWidth = 0;
  const spaceWidth = ctx.measureText(" ").width * BRAT_SPACE_COMPRESS;
  const maxWidth = BRAT_MAX_WIDTH;

  for (const rawWord of words) {
    if (!rawWord) continue;

    const wordParts =
      measureByGrapheme(ctx, rawWord, emojiSize) > maxWidth
        ? splitLongWord(ctx, rawWord, maxWidth, emojiSize)
        : [rawWord];

    for (const word of wordParts) {
      const wordWidth = measureByGrapheme(ctx, word, emojiSize);
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

const getBratBaseY = (totalHeight) => {
  const safeHeight = Math.max(0, Number(totalHeight || 0));
  return BRAT_PADDING + Math.max(0, Math.floor((BRAT_MAX_HEIGHT - safeHeight) / 2));
};

const drawTextToken = async (ctx, token, x, y, fontSize, emojiSize, alpha = 1) => {
  let cursor = x;
  let textRun = "";
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha;

  const flushText = () => {
    if (!textRun) return;
    ctx.fillText(textRun, cursor, y);
    cursor += measureByGrapheme(ctx, textRun, emojiSize);
    textRun = "";
  };

  for (const grapheme of getGraphemes(token)) {
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
      const emojiY = y + Math.max(0, Math.floor((fontSize - emojiSize) / 2));
      ctx.drawImage(emojiImage, cursor, emojiY, emojiSize, emojiSize);
      cursor += emojiSize;
    } catch {
      ctx.fillText(grapheme, cursor, y);
      cursor += ctx.measureText(grapheme).width;
    }
  }

  flushText();
  ctx.globalAlpha = prevAlpha;
  return cursor - x;
};

const drawLineWithEmojiRaw = async (ctx, line, x, y, fontSize, emojiSize, alpha = 1) => {
  const tokens = String(line)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length <= 1) {
    await drawTextToken(ctx, line, x, y, fontSize, emojiSize, alpha);
    return;
  }

  const tokensWidth = measureWordsWidth(ctx, tokens, emojiSize);
  const naturalSpaceWidth = ctx.measureText(" ").width * BRAT_SPACE_COMPRESS;
  const naturalWidth = tokensWidth + naturalSpaceWidth * (tokens.length - 1);
  const useJustify = naturalWidth <= BRAT_MAX_WIDTH * BRAT_JUSTIFY_THRESHOLD;

  let cursor = x;
  let gap = naturalSpaceWidth;

  if (useJustify) {
    gap = Math.max(naturalSpaceWidth, (BRAT_MAX_WIDTH - tokensWidth) / (tokens.length - 1));
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const tokenWidth = await drawTextToken(ctx, tokens[i], cursor, y, fontSize, emojiSize, alpha);
    cursor += tokenWidth;
    if (i < tokens.length - 1) {
      cursor += gap;
    }
  }
};

const drawLineWithEmoji = async (ctx, line, x, y, fontSize, emojiSize, alpha = 1) => {
  for (const pass of BRAT_BLUR_PASSES) {
    await drawLineWithEmojiRaw(
      ctx,
      line,
      x + pass.dx,
      y + pass.dy,
      fontSize,
      emojiSize,
      Math.min(1, alpha * pass.alpha)
    );
  }

  for (const pass of BRAT_BOLD_PASSES) {
    await drawLineWithEmojiRaw(
      ctx,
      line,
      x + pass.dx,
      y + pass.dy,
      fontSize,
      emojiSize,
      Math.min(1, alpha * pass.alpha)
    );
  }

  await drawLineWithEmojiRaw(ctx, line, x, y, fontSize, emojiSize, alpha);
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const easeOutCubic = (value) => 1 - Math.pow(1 - clamp(value, 0, 1), 3);

const softenCanvas = (sourceCanvas) => {
  let current = sourceCanvas;

  for (let i = 0; i < BRAT_SOFTEN_PASSES; i += 1) {
    const downscaled = createCanvas(
      Math.max(64, Math.round(BRAT_CANVAS_SIZE * BRAT_SOFTEN_SCALE)),
      Math.max(64, Math.round(BRAT_CANVAS_SIZE * BRAT_SOFTEN_SCALE))
    );
    const downCtx = downscaled.getContext("2d");
    downCtx.imageSmoothingEnabled = true;
    downCtx.drawImage(current, 0, 0, downscaled.width, downscaled.height);

    const upscaled = createCanvas(BRAT_CANVAS_SIZE, BRAT_CANVAS_SIZE);
    const upCtx = upscaled.getContext("2d");
    upCtx.imageSmoothingEnabled = true;
    upCtx.drawImage(downscaled, 0, 0, BRAT_CANVAS_SIZE, BRAT_CANVAS_SIZE);
    current = upscaled;
  }

  return current;
};

const pickBratLayout = (ctx, text, fontFamily) => {
  let bestLayout = null;

  for (let size = BRAT_FONT_SIZE_MAX; size >= BRAT_FONT_SIZE_MIN; size -= 2) {
    const emojiSize = Math.round(size * BRAT_EMOJI_SCALE);
    const lineSpacing = Math.max(size + 4, Math.round(size * BRAT_LINE_SPACING_RATIO));
    ctx.font = `${size}px ${fontFamily}`;

    const lines = splitBratLines(ctx, text, size, emojiSize);
    const widest = Math.max(...lines.map((line) => measureByGrapheme(ctx, line, emojiSize)));
    const totalHeight = lines.length * lineSpacing;
    const widthUsage = widest / BRAT_MAX_WIDTH;
    const heightUsage = totalHeight / BRAT_MAX_HEIGHT;
    const score = widthUsage * 0.55 + heightUsage * 0.45;

    if (widest <= BRAT_MAX_WIDTH && totalHeight <= BRAT_MAX_HEIGHT) {
      const candidate = { fontSize: size, emojiSize, lineSpacing, lines, score };
      if (!bestLayout || candidate.score > bestLayout.score) {
        bestLayout = candidate;
      }

      if (widthUsage >= 0.9 && heightUsage >= 0.7) {
        return candidate;
      }
    }
  }

  if (bestLayout) return bestLayout;

  const fallbackSize = BRAT_FONT_SIZE_MIN;
  const fallbackEmojiSize = Math.round(fallbackSize * BRAT_EMOJI_SCALE);
  const fallbackSpacing = Math.max(
    fallbackSize + 4,
    Math.round(fallbackSize * BRAT_LINE_SPACING_RATIO)
  );
  ctx.font = `${fallbackSize}px ${fontFamily}`;
  return {
    fontSize: fallbackSize,
    emojiSize: fallbackEmojiSize,
    lineSpacing: fallbackSpacing,
    lines: splitBratLines(ctx, text, fallbackSize, fallbackEmojiSize)
  };
};

const getBratLayout = (text) => {
  ensureBratFont();

  const layoutCanvas = createCanvas(BRAT_CANVAS_SIZE, BRAT_CANVAS_SIZE);
  const layoutCtx = layoutCanvas.getContext("2d");
  layoutCtx.textBaseline = "top";

  const fontFamily = bratFontReady ? "BratFont" : "sans-serif";
  const layout = pickBratLayout(layoutCtx, text, fontFamily);
  return { layout, fontFamily };
};

const renderBratCanvas = async (layout, fontFamily, options = {}) => {
  const { animated = false, frameProgress = 1 } = options;

  const canvas = createCanvas(BRAT_CANVAS_SIZE, BRAT_CANVAS_SIZE);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BRAT_BG_HEX;
  ctx.fillRect(0, 0, BRAT_CANVAS_SIZE, BRAT_CANVAS_SIZE);

  ctx.fillStyle = BRAT_FONT_COLOR;
  ctx.textBaseline = "top";
  ctx.font = `${layout.fontSize}px ${fontFamily}`;

  const totalHeight = layout.lines.length * layout.lineSpacing;
  const baseY = getBratBaseY(totalHeight);
  const fadeAlpha = animated ? 0.08 + 0.92 * easeOutCubic(frameProgress) : 1;

  for (let i = 0; i < layout.lines.length; i += 1) {
    const y = baseY + i * layout.lineSpacing;
    await drawLineWithEmoji(
      ctx,
      layout.lines[i],
      BRAT_PADDING,
      y,
      layout.fontSize,
      layout.emojiSize,
      fadeAlpha
    );
  }

  return softenCanvas(canvas);
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

const videoToWebp = async (buffer, maxSeconds = MAX_VIDEO_STICKER_SECONDS) => {
  await ensureTmpDir();
  const inputPath = path.join(TMP_DIR, randomName("mp4"));
  const outputPath = path.join(TMP_DIR, randomName("webp"));
  const safeDuration = Math.min(Math.max(maxSeconds, 1), MAX_VIDEO_STICKER_SECONDS);

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
  const { layout, fontFamily } = getBratLayout(text);
  const canvas = await renderBratCanvas(layout, fontFamily, { animated: false });
  const pngBuffer = canvas.toBuffer("image/png");
  return imageToWebp(pngBuffer);
};

const bratTextToAnimatedWebp = async (text) => {
  await ensureTmpDir();
  const { layout, fontFamily } = getBratLayout(text);

  const framesDir = path.join(TMP_DIR, `bratvid-${crypto.randomBytes(6).toString("hex")}`);
  const outputPath = path.join(TMP_DIR, randomName("webp"));
  await fs.mkdir(framesDir, { recursive: true });

  try {
    for (let i = 0; i < BRAT_ANIM_FRAMES; i += 1) {
      const progress = BRAT_ANIM_FRAMES <= 1 ? 1 : i / (BRAT_ANIM_FRAMES - 1);
      const frameCanvas = await renderBratCanvas(layout, fontFamily, {
        animated: true,
        frameProgress: progress
      });

      const framePath = path.join(framesDir, `frame_${String(i).padStart(3, "0")}.png`);
      await fs.writeFile(framePath, frameCanvas.toBuffer("image/png"));
    }

    await runFfmpeg(
      ffmpeg(path.join(framesDir, "frame_%03d.png"))
        .inputOptions(["-framerate", String(BRAT_ANIM_FPS)])
        .outputOptions([
          "-vcodec",
          "libwebp",
          "-vf",
          "format=rgba,scale=512:512:flags=lanczos",
          "-loop",
          "0",
          "-an",
          "-vsync",
          "0",
          "-preset",
          "default",
          "-q:v",
          "55"
        ]),
      outputPath
    );

    return await fs.readFile(outputPath);
  } finally {
    await Promise.allSettled([
      fs.rm(framesDir, { recursive: true, force: true }),
      fs.unlink(outputPath)
    ]);
  }
};

module.exports = {
  MAX_VIDEO_STICKER_SECONDS,
  imageToWebp,
  videoToWebp,
  bratTextToWebp,
  bratTextToAnimatedWebp
};
