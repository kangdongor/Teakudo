import dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";
import fs from "fs";
import axios from "axios";
import chalk from "chalk";
import readlineSync from "readline-sync";


const PRIVATE_KEY = readlineSync.question("\u{1F511} Masukkan Private Key: ", { hideEchoBack: true });
const MIN_TOKEN = parseInt(readlineSync.question("Masukkan jumlah token MIN (contoh: 10000): "));
const MAX_TOKEN = parseInt(readlineSync.question("Masukkan jumlah token MAX (contoh: 100000): "));
const MIN_DELAY = parseInt(readlineSync.question("Delay antar transaksi MIN (detik): ")) * 1000;
const MAX_DELAY = parseInt(readlineSync.question("Delay antar transaksi MAX (detik): ")) * 1000;
const MIN_TX = parseInt(readlineSync.question("Minimal jumlah transaksi hari ini: "));
const MAX_TX = parseInt(readlineSync.question("Maksimal jumlah transaksi hari ini: "));


const RPC_URL = process.env.RPC_URL;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!PRIVATE_KEY || !RPC_URL || !TOKEN_ADDRESS) {
    console.error("❌ ERROR: Pastikan input dan .env sudah dikonfigurasi dengan benar.");
    process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const tokenContract = new ethers.Contract(TOKEN_ADDRESS, [
    "function transfer(address to, uint256 amount) public returns (bool)",
    "function decimals() view returns (uint8)"
], wallet);

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function readAddressesFromFile(filename) {
    if (!fs.existsSync(filename)) return [];
    return fs.readFileSync(filename, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
}

function writeAddressesToFile(filename, addresses) {
    fs.writeFileSync(filename, addresses.join('\n'), 'utf8');
}

function log(msg) {
    console.log(chalk.green(`[INFO] ${msg}`));
}

function logError(msg) {
    console.error(chalk.red(`[ERROR] ${msg}`));
    sendTelegramMessage(`*Error:* ${msg}`);
}

async function sendTelegramMessage(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: "Markdown"
        });
    } catch (err) {
        console.error("Gagal mengirim Telegram:", err.message);
    }
}

async function fetchKYCAddresses() {
    try {
        const res = await axios.get("https://raw.githubusercontent.com/clwkevin/LayerOS/main/addressteasepoliakyc.txt");
        return res.data.split('\n').map(addr => addr.trim().toLowerCase());
    } catch (e) {
        logError("Gagal fetch KYC: " + e.message);
        return [];
    }
}

async function distributeTokens() {
    try {
        const decimals = await tokenContract.decimals();
        const kycAddresses = await fetchKYCAddresses();
        if (kycAddresses.length === 0) return logError("Tidak ada alamat KYC.");

        const sent = readAddressesFromFile('kyc_addresses_sent.txt').map(a => a.toLowerCase());
        const failedPrev = readAddressesFromFile('kyc_addresses_pending.txt').map(a => a.toLowerCase());

        const recipients = kycAddresses.filter(addr => !sent.includes(addr) || failedPrev.includes(addr));
        writeAddressesToFile('kyc_addresses_pending.txt', []);

        if (recipients.length === 0) return log("Semua alamat sudah menerima.");

        const txLimit = Math.min(recipients.length, Math.floor(Math.random() * (MAX_TX - MIN_TX + 1)) + MIN_TX);
        log(`🎯 Akan mengirim ${txLimit} transaksi.`);

        let failed = [];
        const selected = recipients.slice(0, txLimit).sort(() => 0.5 - Math.random());

        for (let i = 0; i < selected.length; i++) {
            const to = selected[i];
            const amountRaw = Math.floor(Math.random() * (MAX_TOKEN - MIN_TOKEN + 1)) + MIN_TOKEN;
            const amount = ethers.parseUnits(amountRaw.toString(), decimals);

            log(`🎁 Kirim ${amountRaw} token ke ${to}`);

            let waitTime = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
            let remaining = Math.floor(waitTime / 1000);

            while (remaining > 0) {
                const m = Math.floor(remaining / 60);
                const s = remaining % 60;
                process.stdout.write(`⏳ Menunggu ${m}m ${s}s sebelum kirim...\r`);
                await delay(1000);
                remaining--;
            }
            console.log();

            try {
                const tx = await tokenContract.transfer(to, amount);
                await tx.wait(3);
                log(`${i + 1}. ✅ TX Berhasil ke ${to} - TX Hash: ${tx.hash}`);

                sent.push(to);
                writeAddressesToFile('kyc_addresses_sent.txt', [...new Set(sent)]);

                const afterDelay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
                await delay(afterDelay);
            } catch (err) {
                logError(`${i + 1}. ❌ TX Gagal ke ${to} - ${err.message}`);
                failed.push(to);
            }
        }

        writeAddressesToFile('kyc_addresses_pending.txt', failed);
        log(`🎉 Selesai. Berhasil: ${txLimit - failed.length}, Gagal: ${failed.length}`);
        sendTelegramMessage(`🎉 Selesai. Berhasil: ${txLimit - failed.length}, Gagal: ${failed.length}`);
    } catch (e) {
        logError(e.message);
    }
}

(async () => {
    while (true) {
        await distributeTokens();

        let now = new Date();
        let tomorrow = new Date();
        tomorrow.setUTCHours(0, 0, 0, 0);
        tomorrow.setUTCDate(now.getUTCDate() + 1);

        const waitTime = tomorrow - now;
        log(`⏳ Menunggu hingga besok: ${tomorrow.toISOString()}`);
        sendTelegramMessage("Menunggu hingga besok untuk transaksi selanjutnya...");

        await delay(waitTime + Math.floor(Math.random() * 5 * 60 * 1000));
    }
})();
