const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PROCESS_NAME = "northmadbot";

const run = (command, options = {}) => {
  console.log(`\n$ ${command}`);
  return execSync(command, {
    stdio: "inherit",
    ...options
  });
};

const runSilent = (command) => {
  try {
    execSync(command, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const setup = () => {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const user = process.env.USER || "root";
  const home = process.env.HOME || `/home/${user}`;
  const credsPath = path.join(__dirname, "session", "creds.json");
  const firstRun = !fs.existsSync(credsPath);

  console.log("== Setup northmadbot ==");

  if (!runSilent("pm2 -v")) {
    run(`${npmCmd} install -g pm2`);
  } else {
    console.log("PM2 udah terinstall, lanjut.");
  }

  runSilent(`pm2 delete ${PROCESS_NAME}`);

  run(`pm2 start index.js --name ${PROCESS_NAME}`);
  run("pm2 save");

  try {
    run(`pm2 startup systemd -u ${user} --hp ${home}`);
  } catch (error) {
    console.log("\nGagal auto-setup startup penuh.");
    console.log("Jalankan manual command ini jika perlu:");
    console.log(`pm2 startup systemd -u ${user} --hp ${home}`);
  }

  console.log("\nSelesai. Bot jalan via PM2 dan akan auto-restart saat crash.");
  console.log(`Cek status: pm2 status ${PROCESS_NAME}`);
  console.log("Lihat log: pm2 logs northmadbot");

  if (firstRun) {
    console.log("\nFirst run terdeteksi. Scan QR dari log di bawah ini.");
    console.log("Setelah sukses scan, tekan Ctrl+C untuk keluar dari log (bot tetap jalan).");
    run(`pm2 logs ${PROCESS_NAME} --lines 120`);
  }
};

setup();
