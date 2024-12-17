const fs = require("fs-extra");
const path = require("path");
const puppeteer = require("puppeteer");
const axios = require("axios");

const SLACK_URL = "https://app.slack.com/client/T084BP64JFR/C084PE1MWLD";
const DATA_DIR = path.join(__dirname, "data");
const IMAGES_DIR = path.join(DATA_DIR, "images");
const VIDEOS_DIR = path.join(DATA_DIR, "videos");
const DATA_FILE = path.join(DATA_DIR, "messages.json");
const PUBLIC_DATA_FILE = path.join(DATA_DIR, "messages_public.json");
const SCRAPE_INTERVAL = 300000; // 5 menit

let browser;
let page;
let isScraping = false;

async function ensureDirectories() {
    await fs.ensureDir(DATA_DIR);
    await fs.ensureDir(IMAGES_DIR);
    await fs.ensureDir(VIDEOS_DIR);
}

function sanitizeFilename(filename) {
    return filename.replace(/[^a-z0-9.\-]/gi, "_").toLowerCase();
}

async function getCookiesHeader() {
    const cookies = await page.cookies();
    const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    return cookieHeader;
}

async function downloadFileWithCookies(url, filepath) {
    try {
        console.log(`Mengunduh file dengan cookies: ${url}`);
        const cookieHeader = await getCookiesHeader();

        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: {
                'Cookie': cookieHeader
            },
            timeout: 1800000 // 30 menit jika perlu
        });

        await fs.writeFile(filepath, response.data);
        console.log(`File disimpan di: ${filepath}`);
    } catch (error) {
        console.error(`Gagal mengunduh file dari ${url}:`, error.message);
    }
}

async function initBrowser() {
    console.log("Menginisialisasi Puppeteer...");
    browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized'],
        userDataDir: path.join(__dirname, "chrome-user-data"),
        protocolTimeout: 1800000 , // Increase to 30 minutes
    });
    page = await browser.newPage();
    page.setDefaultTimeout(1800000);
    page.setDefaultNavigationTimeout(1800000);
    console.log("Puppeteer berhasil diinisialisasi.");
}

async function loginAndNavigate() {
    console.log(`Navigasi ke URL Slack: ${SLACK_URL}`);
    await page.goto(SLACK_URL, { waitUntil: "networkidle2" });
    console.log("Silakan login secara manual jika belum. Tekan ENTER di terminal setelah login.");
    await new Promise(resolve => {
        process.stdin.once('data', () => resolve());
    });
    await page.reload({ waitUntil: 'networkidle2' });

    const channelSelector = '[data-qa-channel-sidebar-channel-id="C084PE1MWLD"]';
    await page.waitForSelector(channelSelector, { visible: true });
    await page.click(channelSelector);
    await new Promise(resolve => setTimeout(resolve, 5000)); 
    console.log("Berhasil menuju channel yang diinginkan.");
}

async function closeAllPanels() {
    console.log("Menutup semua panel...");
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 500)); 
    }
    
    let closeBtnExists = true;
    while (closeBtnExists) {
        const closeBtns = await page.$$('button[data-qa="close_flexpane"]');
        if (closeBtns.length > 0) {
            for (const btn of closeBtns) {
                await btn.click().catch(() => {});
                await new Promise(resolve => setTimeout(resolve, 500)); 
            }
        } else {
            closeBtnExists = false;
        }
    }
    console.log("Semua panel ditutup (atau tidak ada panel).");
}

async function scrollToBottom() {
    console.log("Scrolling ke dasar chat...");
    await page.evaluate(() => {
        const el = document.querySelector('div[class^="c-virtual"]');
        if (el) el.scrollTop = el.scrollHeight;
    });
    await new Promise(resolve => setTimeout(resolve, 2000)); 
    console.log("Diperkirakan telah mencapai dasar chat.");
}

async function scrollUpMultipleTimes(times = 15) {
    console.log("Mulai scroll ke atas untuk memuat pesan lama...");
    for (let i = 0; i < times; i++) {
        await page.evaluate(() => {
            const el = document.querySelector('div[class^="c-virtual"]');
            if (el) el.scrollTop = el.scrollTop - 2000; 
        });
        await new Promise(resolve => setTimeout(resolve, 1000)); 
    }
    console.log("Selesai scroll ke atas.");
}

async function getMessageElements() {
    return await page.$$('div.c-virtual_list__item[id]');
}

async function processThreadMessages(parentId) {
    let threadMessages = [];
    let processedThreadIds = new Set();

    console.log("Menunggu panel thread muncul...");
    await page.waitForSelector('div.c-virtual_list[id*="-thread-list-Thread"]', { visible: true });
    const threadContainer = await page.$('div.c-virtual_list[id*="-thread-list-Thread"]');
    if (!threadContainer) {
        console.log("Thread container tidak ditemukan.");
        return threadMessages;
    }

    const threadMessageElements = await threadContainer.$$('[id*="thread-list-Thread_"]');
    for (let tMsgEl of threadMessageElements) {
        const tMsgId = await tMsgEl.evaluate(el => el.getAttribute('id'));
        const match = tMsgId.match(/Thread_(\d+\.\d+)$/);
        if (!match) continue;
        const threadMsgId = match[1];
        if (processedThreadIds.has(threadMsgId)) continue;

        const username = await tMsgEl.$eval(".c-message__sender, .c-message_kit__sender", el => el.innerText).catch(() => "Unknown");
        const timestamp = await tMsgEl.$eval("a.c-timestamp", el => el.getAttribute("aria-label")).catch(() => "Unknown");

        let regularMessage = "";
        const contentElement = await tMsgEl.$('.c-message_kit__blocks--rich_text .p-rich_text_section');
        if (contentElement) {
            regularMessage = (await contentElement.evaluate(el => el.innerText)).trim();
        }

        // Ambil gambar
        let images = [];
        const imageLinkElements = await tMsgEl.$$('[data-qa="message_file_image_thumbnail"]');
        for (let linkEl of imageLinkElements) {
            const imageUrl = await linkEl.evaluate(el => el.getAttribute('href'));
            if (imageUrl) {
                let imageName = sanitizeFilename(`${threadMsgId}_${path.basename(imageUrl.split("?")[0])}`);
                await downloadFileWithCookies(imageUrl, path.join(IMAGES_DIR, imageName));
                images.push(imageName);
            }
        }

        // Ambil emotes
        let emotes = [];
        if (contentElement) {
            const emoteElements = await contentElement.$$("img[alt^=':']:not([alt=''])");
            for (let emoEl of emoteElements) {
                const alt = await emoEl.evaluate(el => el.getAttribute('alt'));
                if (alt) emotes.push(alt);
            }
        }

        // Ambil video dengan logika yang sama dengan pesan utama
        let videos = await processVideos(tMsgEl, threadMsgId);

        let threadMessageObj = {
            id: threadMsgId,
            id_root: parentId,
            username,
            timestamp,
            regular_message: regularMessage,
            images,
            videos,
            emotes,
            threads: []
        };

        threadMessages.push(threadMessageObj);
        processedThreadIds.add(threadMsgId);
    }

    return threadMessages;
}

async function processVideos(msgElement, msgId) {
    let videos = [];

    try {
        const videoOverlay = await msgElement.$('.p-video_controls_overlay');
        if (!videoOverlay) {
            console.log(`Tidak ada video pada pesan ID: ${msgId}.`);
            return videos;
        }

        console.log(`Video terdeteksi pada pesan ID: ${msgId}. Mencoba memunculkan menu more actions...`);

        await videoOverlay.hover();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const moreActionsBtn = await videoOverlay.$('.c-button-unstyled.c-icon_button.c-icon_button--size_medium.p-video_message_file__controls_overlay_ellipsis.c-icon_button--dark');
        console.log("Hasil pencarian tombol more actions:", moreActionsBtn);

        if (!moreActionsBtn) {
            console.log("Tombol More actions tidak ditemukan pada elemen video.");
            return videos;
        }

        await moreActionsBtn.click();
        console.log("Tombol More actions berhasil diklik!");

        await page.waitForSelector('.c-menu__items', { visible: true });
        console.log("Modal menu actions telah muncul.");

        const menuButtons = await page.$$('.c-menu_item__button');
        let viewDetailsFound = false;

        for (const btn of menuButtons) {
            const labelEl = await btn.$('.c-menu_item__label');
            if (!labelEl) continue;
            const labelText = await labelEl.evaluate(el => el.innerText.trim());
            if (labelText === 'View details') {
                console.log("Tombol 'View details' ditemukan:", btn);
                await btn.click();
                console.log("Tombol 'View details' berhasil diklik!");
                viewDetailsFound = true;
                break;
            }
        }

        if (!viewDetailsFound) {
            console.log("Tombol 'View details' tidak ditemukan di dalam menu.");
            return videos;
        }

        // Tunggu panel file details muncul
        await page.waitForSelector('.p-view_contents.p-view_contents--secondary', { visible: true });
        console.log("Panel File details telah muncul.");

        // Ambil elemen link download
        const downloadLinkEl = await page.$('a[data-qa="download_action"]');
        if (!downloadLinkEl) {
            console.log("Link download tidak ditemukan.");
        } else {
            let downloadUrl = await downloadLinkEl.evaluate(el => el.getAttribute('href'));
            console.log("Link download ditemukan:", downloadUrl);

            // Hapus parameter ?origin_team=T084BP64JFR jika ada
            // Cara 1: Menggunakan URL object
            try {
                const urlObj = new URL(downloadUrl);
                urlObj.searchParams.delete('origin_team');
                downloadUrl = urlObj.toString();
            } catch (e) {
                // Jika gagal pakai URL, coba string replace sederhana
                downloadUrl = downloadUrl.replace(/\?origin_team=[^&]+/, '');
            }

            console.log("Link download setelah dihapus origin_team:", downloadUrl);

            // Cek ekstensi video
            const videoExtensionRegex = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;
            if (downloadUrl && downloadUrl.startsWith('https://') && videoExtensionRegex.test(downloadUrl)) {
                let videoName = sanitizeFilename(`${msgId}_${path.basename(downloadUrl)}`);
                console.log(`Mengunduh video: ${downloadUrl}`);
                await downloadFileWithCookies(downloadUrl, path.join(VIDEOS_DIR, videoName));
                videos.push(videoName);
                console.log("Video berhasil diunduh:", videoName);
            } else {
                console.log("Tidak terdeteksi sebagai video (ekstensi tidak cocok atau URL tidak valid). Lewati.");
            }
        }

        const closeBtn = await page.$('button[data-qa="close_flexpane"]');
        if (closeBtn) {
            await closeBtn.click();
            console.log("Panel File details ditutup.");
        } else {
            console.log("Tombol close panel tidak ditemukan.");
        }

    } catch (error) {
        console.error(`Kesalahan saat memproses video di pesan ${msgId}:`, error);
        console.error('Detail kesalahan:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
    }

    return videos;
}


async function processMessageElement(msgElement, processedIds) {
    const msgId = await msgElement.evaluate(el => el.getAttribute('id')) || "";
    if (!/^\d+\.\d+$/.test(msgId)) {
        return null;
    }

    if (processedIds.has(msgId)) {
        return null;
    }

    const username = await msgElement.$eval(".c-message__sender, .c-message_kit__sender", el => el.innerText).catch(() => "Unknown");
    const timestamp = await msgElement.$eval("a.c-timestamp", el => el.getAttribute("aria-label")).catch(() => "Unknown");

    let regularMessage = "";
    const contentElement = await msgElement.$('.c-message_kit__blocks--rich_text .p-rich_text_section');
    if (contentElement) {
        regularMessage = (await contentElement.evaluate(el => el.innerText)).trim();
    }

    let images = [];
    const imageLinkElements = await msgElement.$$('[data-qa="message_file_image_thumbnail"]');
    for (let linkEl of imageLinkElements) {
        const imageUrl = await linkEl.evaluate(el => el.getAttribute('href'));
        if (imageUrl) {
            let imageName = sanitizeFilename(`${msgId}_${path.basename(imageUrl.split("?")[0])}`);
            await downloadFileWithCookies(imageUrl, path.join(IMAGES_DIR, imageName));
            images.push(imageName);
        }
    }

    let emotes = [];
    if (contentElement) {
        const emoteElements = await contentElement.$$("img[alt^=':']:not([alt=''])");
        for (let emoEl of emoteElements) {
            const alt = await emoEl.evaluate(el => el.getAttribute('alt'));
            if (alt) emotes.push(alt);
        }
    }

    let videos = await processVideos(msgElement, msgId);

    let threads = [];
    const replyButtons = await msgElement.$$('[data-qa="reply_bar_count"]');
    if (replyButtons.length > 0) {
        await replyButtons[0].click();
        console.log("Thread button diklik, menunggu 5 detik sebelum memproses thread...");
        await new Promise(resolve => setTimeout(resolve, 5000));
        threads = await processThreadMessages(msgId);
        await closeAllPanels();
    }

    let messageObj = {
        id: msgId,
        username,
        timestamp,
        regular_message: regularMessage,
        images,
        videos,
        emotes,
        threads
    };

    return messageObj;
}

async function collectMessages() {
    let allMessagesData = [];
    let processedIds = new Set();

    console.log("Mulai kumpulkan pesan dengan scroll ke atas...");
    await scrollUpMultipleTimes(15);

    const messageElements = await getMessageElements();
    console.log(`Ditemukan ${messageElements.length} pesan.`);

    for (let msgElement of messageElements) {
        const messageData = await processMessageElement(msgElement, processedIds);
        if (messageData) {
            allMessagesData.push(messageData);
            processedIds.add(messageData.id);
            console.log(`Memproses pesan ID: ${messageData.id}`);
        }
    }

    console.log("Selesai mengumpulkan pesan.");
    return allMessagesData;
}

async function saveMessages(allMessagesData) {
    console.log("Mengurutkan pesan berdasarkan ID...");
    allMessagesData.sort((a, b) => parseFloat(a.id) - parseFloat(b.id));
    console.log("Pesan terurut.");

    console.log(`Menyimpan ${allMessagesData.length} pesan ke ${DATA_FILE}...`);
    await fs.writeJson(DATA_FILE, allMessagesData, { spaces: 2 });
    console.log("Pesan disimpan sukses.");

    if (await fs.pathExists(PUBLIC_DATA_FILE)) {
        console.log(`${PUBLIC_DATA_FILE} ditemukan, menghapus file lama...`);
        await fs.remove(PUBLIC_DATA_FILE);
        console.log("File lama terhapus.");
    } else {
        console.log("File public belum ada, tidak perlu hapus.");
    }

    console.log(`Mengganti nama ${DATA_FILE} menjadi ${PUBLIC_DATA_FILE}...`);
    await fs.rename(DATA_FILE, PUBLIC_DATA_FILE);
    console.log(`Sukses mengganti nama menjadi ${PUBLIC_DATA_FILE}.`);
}

async function scrapeMessages() {
    if (isScraping) {
        console.log("Scraping sedang berjalan. Lewati scrape saat ini.");
        return;
    }
    isScraping = true;
    console.log("Memulai proses scraping...");

    try {
        await scrollToBottom();
        let allMessagesData = await collectMessages();
        await saveMessages(allMessagesData);
        console.log("Proses scraping selesai dengan sukses.");
    } catch (error) {
        console.error("Terjadi kesalahan saat scraping:", error.message);
    } finally {
        isScraping = false;
        console.log("Flag scraping direset. Siap untuk cycle scraping berikutnya.");
    }
}

async function startScraping() {
    await ensureDirectories();
    await initBrowser();

    try {
        await loginAndNavigate();

        console.log("Tekan ENTER untuk memulai scraping...");
        process.stdin.once("data", async () => {
            console.log("ENTER ditekan. Memulai scraping awal...");

            await page.goto(SLACK_URL, { waitUntil: "networkidle2" });
            await new Promise(resolve => setTimeout(resolve, 5000));

            await scrapeMessages();
            console.log(`Jadwalkan scraping berikutnya dalam ${SCRAPE_INTERVAL / 60000} menit.`);
            setInterval(scrapeMessages, SCRAPE_INTERVAL);
        });
    } catch (error) {
        console.error("Terjadi kesalahan saat navigasi ke Slack:", error.message);
    }
}

process.on("SIGINT", async () => {
    console.log("\nMenerima SIGINT. Shutdown dengan baik...");
    if (browser) {
        try {
            console.log("Menutup Puppeteer Browser...");
            await browser.close();
            console.log("Browser tertutup.");
        } catch (err) {
            console.error("Error saat menutup browser:", err.message);
        }
    }
    process.exit();
});

// Mulai
startScraping();
