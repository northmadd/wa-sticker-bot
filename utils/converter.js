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

const ensureTmpDir = async () => {
  await fs.mkdir(TMP_DIR, { recursive: true });
};

const randomName = (ext) => `${crypto.randomBytes(8).toString("hex")}.${ext}`;

const watermarkFilter = `drawtext=text='${WATERMARK}':fontcolor=white:fontsize=20:borderw=2:bordercolor=black:x=w-tw-12:y=h-th-12`;

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
          `scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,${watermarkFilter}`,
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
          `fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,${watermarkFilter}`,
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

module.exports = {
  imageToWebp,
  videoToWebp
};
