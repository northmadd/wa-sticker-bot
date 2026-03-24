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
  /drawtext|no such filter|filter not found|cannot find a valid font/i.test(String(message || ""));

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
  const safeText = String(text || "brat").trim().slice(0, 120) || "brat";

  const font = await loadFont(SANS_64_BLACK);
  const image = new Jimp({ width: 512, height: 512, color: 0xffffffff });

  image.print({
    font,
    x: 20,
    y: 20,
    text: {
      text: safeText,
      alignmentX: HorizontalAlign.CENTER,
      alignmentY: VerticalAlign.MIDDLE
    },
    maxWidth: 472,
    maxHeight: 472
  });

  const pngBuffer = await image.getBuffer("image/png");
  return imageToWebp(pngBuffer);
};

module.exports = {
  imageToWebp,
  videoToWebp,
  bratTextToWebp
};
