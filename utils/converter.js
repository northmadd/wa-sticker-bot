const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const { Jimp, loadFont, HorizontalAlign, VerticalAlign } = require("jimp");
const { SANS_64_BLACK } = require("jimp/fonts");

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const TMP_DIR = path.join(os.tmpdir(), "northmadbot");
const WATERMARK = "northmadbot";
const BRAT_FONT_PATH = path.join(__dirname, "..", "assets", "font.ttf");
const ENABLE_WATERMARK = String(process.env.ENABLE_WATERMARK || "false").toLowerCase() === "true";
const BRAT_BG_COLOR = 0xedededff;
const BRAT_FONT_COLOR = "#111111";
const BRAT_FONT_SIZE = 64;
const BRAT_X = 40;
const BRAT_LINE_SPACING = 74;
const BRAT_MAX_CHARS = 18;
const BRAT_MAX_LINES = 5;

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

const splitBratLines = (text, maxChars = BRAT_MAX_CHARS, maxLines = BRAT_MAX_LINES) => {
  const safe = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  if (!safe) return ["brat"];

  const words = safe.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!word) continue;

    if (word.length > maxChars) {
      const chunks = word.match(new RegExp(`.{1,${maxChars}}`, "g")) || [word];
      for (const chunk of chunks) {
        if (current) {
          lines.push(current);
          current = "";
          if (lines.length >= maxLines) return lines;
        }
        lines.push(chunk);
        if (lines.length >= maxLines) return lines;
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) return lines;
    }
  }

  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
};

const getBratBaseY = (lineCount) => {
  const count = Math.max(1, Number(lineCount || 1));
  const totalHeight = BRAT_FONT_SIZE + (count - 1) * BRAT_LINE_SPACING;
  return Math.max(40, Math.floor((512 - totalHeight) / 2));
};

const renderBratFallbackWithJimp = async (lines) => {
  const font = await loadFont(SANS_64_BLACK);
  const image = new Jimp({ width: 512, height: 512, color: BRAT_BG_COLOR });
  const baseY = getBratBaseY(lines.length);

  for (let i = 0; i < lines.length; i += 1) {
    image.print({
      font,
      x: BRAT_X,
      y: baseY + i * BRAT_LINE_SPACING,
      text: {
        text: lines[i],
        alignmentX: HorizontalAlign.LEFT,
        alignmentY: VerticalAlign.TOP
      },
      maxWidth: 512 - BRAT_X * 2,
      maxHeight: BRAT_LINE_SPACING
    });
  }

  const pngBuffer = await image.getBuffer("image/png");
  return imageToWebp(pngBuffer);
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
  await ensureTmpDir();
  const inputPath = path.join(TMP_DIR, randomName("png"));
  const outputPath = path.join(TMP_DIR, randomName("webp"));
  const lines = splitBratLines(text);

  if (!fsSync.existsSync(BRAT_FONT_PATH)) {
    return renderBratFallbackWithJimp(lines);
  }

  const image = new Jimp({ width: 512, height: 512, color: BRAT_BG_COLOR });
  await fs.writeFile(inputPath, await image.getBuffer("image/png"));

  const escapedFontPath = escapeFfmpegPath(BRAT_FONT_PATH);
  const baseY = getBratBaseY(lines.length);

  const textFilters = lines.map((line, index) => {
    const escapedLine = escapeFfmpegText(line);
    const yPos = baseY + index * BRAT_LINE_SPACING;
    return `drawtext=fontfile='${escapedFontPath}':text='${escapedLine}':fontsize=${BRAT_FONT_SIZE}:fontcolor=${BRAT_FONT_COLOR}:x=${BRAT_X}:y=${yPos}`;
  });

  if (ENABLE_WATERMARK) {
    const wm = buildWatermarkFilter().replace(/^,/, "");
    if (wm) textFilters.push(wm);
  }

  const vf = `format=rgba,${textFilters.join(",")}`;

  try {
    await runFfmpeg(
      ffmpeg(inputPath).outputOptions([
        "-frames:v",
        "1",
        "-vcodec",
        "libwebp",
        "-vf",
        vf,
        "-s",
        "512:512",
        "-loop",
        "0",
        "-an",
        "-vsync",
        "0"
      ]),
      outputPath
    );

    return await fs.readFile(outputPath);
  } catch (error) {
    if (shouldRetryWithoutWatermark(error.message)) {
      return renderBratFallbackWithJimp(lines);
    }
    throw error;
  } finally {
    await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);
  }
};

module.exports = {
  imageToWebp,
  videoToWebp,
  bratTextToWebp
};
