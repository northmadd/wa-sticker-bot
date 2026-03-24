const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const TMP_DIR = path.join(os.tmpdir(), "northmadbot");
const WATERMARK = "northmadbot";
const BRAT_FONT_PATH = path.join(__dirname, "..", "assets", "font.ttf");

const ensureTmpDir = async () => {
  await fs.mkdir(TMP_DIR, { recursive: true });
};

const randomName = (ext) => `${crypto.randomBytes(8).toString("hex")}.${ext}`;

const watermarkFilter = `drawtext=text='${WATERMARK}':fontcolor=white:fontsize=20:borderw=2:bordercolor=black:x=w-tw-12:y=h-th-12`;

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

const wrapText = (text, maxChars = 16, maxLines = 5) => {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (candidate.length <= maxChars) {
      currentLine = candidate;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
      if (lines.length >= maxLines) break;
    }
  }

  if (currentLine && lines.length < maxLines) lines.push(currentLine);
  return lines.slice(0, maxLines).join("\n");
};

const imageToWebp = async (buffer) => {
  await ensureTmpDir();
  const inputPath = path.join(TMP_DIR, randomName("jpg"));
  const outputPath = path.join(TMP_DIR, randomName("webp"));

  await fs.writeFile(inputPath, buffer);

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          "-vcodec",
          "libwebp",
          "-vf",
          `format=rgba,scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,${watermarkFilter}`,
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
        ])
        .save(outputPath)
        .on("end", resolve)
        .on("error", reject);
    });

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

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          "-t",
          String(safeDuration),
          "-vcodec",
          "libwebp",
          "-vf",
          `fps=15,format=rgba,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,${watermarkFilter}`,
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
        ])
        .save(outputPath)
        .on("end", resolve)
        .on("error", reject);
    });

    return await fs.readFile(outputPath);
  } finally {
    await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);
  }
};

const bratTextToWebp = async (text) => {
  await ensureTmpDir();
  const outputPath = path.join(TMP_DIR, randomName("webp"));
  const wrapped = wrapText(String(text || "").toLowerCase(), 16, 5);
  const escaped = escapeFfmpegText(wrapped || "brat");
  const escapedFontPath = escapeFfmpegPath(BRAT_FONT_PATH);

  try {
    await fs.access(BRAT_FONT_PATH);
  } catch {
    throw new Error(`Font tidak ditemukan di ${BRAT_FONT_PATH}`);
  }

  try {
    await new Promise((resolve, reject) => {
      ffmpeg("color=c=white:s=512x512:d=1")
        .inputFormat("lavfi")
        .outputOptions([
          "-frames:v",
          "1",
          "-vcodec",
          "libwebp",
          "-vf",
          `format=rgba,drawtext=fontfile='${escapedFontPath}':text='${escaped}':fontcolor=black:fontsize=74:line_spacing=12:x=(w-text_w)/2:y=(h-text_h)/2`,
          "-s",
          "512:512",
          "-loop",
          "0",
          "-an",
          "-vsync",
          "0"
        ])
        .save(outputPath)
        .on("end", resolve)
        .on("error", reject);
    });

    return await fs.readFile(outputPath);
  } finally {
    await Promise.allSettled([fs.unlink(outputPath)]);
  }
};

module.exports = {
  imageToWebp,
  videoToWebp,
  bratTextToWebp
};
