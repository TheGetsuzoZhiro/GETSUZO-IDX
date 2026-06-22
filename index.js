const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const fs = require("fs");
const readline = require("readline");
const axios = require("axios");
const moment = require("moment-timezone");
const express = require("express");
const path = require("path");
const os = require("os");

// ============ KONFIGURASI ============
const { api_id, api_hash } = require("./config.js");
const SESSION_FILE = "session.txt";
const CONFIG_FILE = "config.json";
const SIGNAL_DB_FILE = "signals.json";
const REPORTS_FILE = "reports.json";
moment.tz.setDefault('Asia/Jakarta');

let targetTelegramChatId = null;
let targetTopicId = undefined;

// ============ DATABASE SINYAL ============
if (!fs.existsSync(SIGNAL_DB_FILE))
  fs.writeFileSync(SIGNAL_DB_FILE, "[]", "utf8");
if (!fs.existsSync(REPORTS_FILE))
  fs.writeFileSync(
    REPORTS_FILE,
    JSON.stringify({ daily: [] }, null, 2),
  );

function loadSignals() {
  const data = fs.readFileSync(SIGNAL_DB_FILE, "utf8");
  return JSON.parse(data);
}

function saveSignals(signals) {
  fs.writeFileSync(SIGNAL_DB_FILE, JSON.stringify(signals, null, 2));
  updateAllReports();
}

function loadReports() {
  const data = fs.readFileSync(REPORTS_FILE, "utf8");
  return JSON.parse(data);
}

function saveReports(reports) {
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2));
}

function parseLotString(str) {
  if (!str) return 0;
  let cleaned = str.replace(/,/g, "");
  let multiplier = 1;
  if (cleaned.endsWith("M")) {
    multiplier = 1000000;
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.endsWith("K")) {
    multiplier = 1000;
    cleaned = cleaned.slice(0, -1);
  }
  return parseFloat(cleaned) * multiplier;
}

// ============ PARSING SINYAL ============
function parseNewSignal(text) {
  if (
    !text.includes("ZETA IDX STOCK SIGNAL") &&
    !text.includes("GETSUZO IDX STOCK SIGNAL")
  )
    return null;

  let signal = {
    stockCode: null,
    signalType: "WATCHLIST",
    confidenceScore: null,
    confidenceDetails: [],
    entryPrice: null,
    tp1: null,
    sl: null,
    slModerat: null,
    slKonservatif: null,
    macd: null,
    macdSignal: null,
    rsi: null,
    ema20: null,
    ema50: null,
    vwap: null,
    adx: null,
    bbLow: null,
    bbHigh: null,
    atr: null,
    patternChart: null,
    patternCandle: null,
    sinyalBandar: null,
    smartMoneyNet: null,
    foreignNet: null,
    foreignPartisipasi: null,
    beta: null,
    volatilitas: null,
    topBuyers: [],
    topSellers: [],
    analystOpinion: null,
    relatedNews: [],
    status: "RUNNING",
    signalDate: moment().format("YYYY-MM-DD HH:mm:ss"),
    closeDate: null,
    exitPrice: null,
    returnPercent: null,
    holdingDays: null,
    currentHigh: null,
    currentLow: null,
  };

  const stockMatch = text.match(/Saham:\s*([A-Z]+)/);
  if (stockMatch) signal.stockCode = stockMatch[1].trim();

  const sigTypeMatch = text.match(
    /Signal:\s*(STRONG BUY|BUY|STRONG SELL|SELL|WATCHLIST)/i,
  );
  if (sigTypeMatch) signal.signalType = sigTypeMatch[1].toUpperCase();

  const confMatch = text.match(/Confidence Score:.*?(\d+)\/10/);
  if (confMatch) signal.confidenceScore = parseInt(confMatch[1]);

  const confBlock = text.match(
    /Confidence Score:[\s\S]*?(?=\n\n💵 Entry Price:|\nStop Loss:)/,
  );
  if (confBlock) {
    const lines = confBlock[0]
      .split("\n")
      .filter((line) => line.trim().match(/^[+-]\d+\s+/));
    signal.confidenceDetails = lines.map((line) => line.trim());
  }

  const entryMatch = text.match(/Entry Price:\s*Rp([\d,]+)/);
  if (entryMatch)
    signal.entryPrice = parseFloat(entryMatch[1].replace(/,/g, ""));

  const tpMatch = text.match(/TP1:\s*Rp([\d,]+)/);
  if (tpMatch) signal.tp1 = parseFloat(tpMatch[1].replace(/,/g, ""));

  const slMatch = text.match(/Default \(ATR\):\s*Rp([\d,]+)/);
  if (slMatch) signal.sl = parseFloat(slMatch[1].replace(/,/g, ""));

  const slModMatch = text.match(/Moderat \(-5%\):\s*Rp([\d,]+)/);
  if (slModMatch) signal.slModerat = parseFloat(slModMatch[1].replace(/,/g, ""));

  const slKonMatch = text.match(/Konservatif \(-3%\):\s*Rp([\d,]+)/);
  if (slKonMatch)
    signal.slKonservatif = parseFloat(slKonMatch[1].replace(/,/g, ""));

  const macdMatch = text.match(/MACD:\s*([\d.-]+)\s*\(Sig:\s*([\d.-]+)\)/);
  if (macdMatch) {
    signal.macd = parseFloat(macdMatch[1]);
    signal.macdSignal = parseFloat(macdMatch[2]);
  }

  const rsiMatch = text.match(/RSI \(14\):\s*([\d.-]+)/);
  if (rsiMatch) signal.rsi = parseFloat(rsiMatch[1]);

  const emaMatch = text.match(/EMA 20\/50:\s*Rp([\d,]+)\s*\/\s*Rp([\d,]+)/);
  if (emaMatch) {
    signal.ema20 = parseFloat(emaMatch[1].replace(/,/g, ""));
    signal.ema50 = parseFloat(emaMatch[2].replace(/,/g, ""));
  }

  const vwapMatch = text.match(/VWAP:\s*Rp([\d,]+)/);
  if (vwapMatch) signal.vwap = parseFloat(vwapMatch[1].replace(/,/g, ""));

  const adxMatch = text.match(/ADX:\s*([\d.-]+)/);
  if (adxMatch) signal.adx = parseFloat(adxMatch[1]);

  const bbMatch = text.match(/BB:\s*\[Rp([\d,]+)\s*-\s*Rp([\d,]+)\]/);
  if (bbMatch) {
    signal.bbLow = parseFloat(bbMatch[1].replace(/,/g, ""));
    signal.bbHigh = parseFloat(bbMatch[2].replace(/,/g, ""));
  }

  const atrMatch = text.match(/ATR:\s*Rp([\d,]+)/);
  if (atrMatch) signal.atr = parseFloat(atrMatch[1].replace(/,/g, ""));

  const chartPattern = text.match(/- Chart:\s*(.*?)(?=\n|$)/);
  if (chartPattern)
    signal.patternChart = chartPattern[1].replace(/[🔴🟢⚪]/g, "").trim();

  const candlePattern = text.match(/- Candle:\s*(.*?)(?=\n|$)/);
  if (candlePattern)
    signal.patternCandle = candlePattern[1].replace(/[🔴🟢⚪]/g, "").trim();

  const sinyalBandarMatch = text.match(
    /Sinyal Bandar:\s*[🔴🟢⚪️\s]*(STRONG_BUY|BUY|SELL|STRONG_SELL|NEUTRAL)/i,
  );
  if (sinyalBandarMatch)
    signal.sinyalBandar = sinyalBandarMatch[1].toUpperCase();

  const smNetMatch = text.match(/Smart Money\s*Net:\s*([+-]?[\d,]+)K?\s*lot/i);
  if (smNetMatch)
    signal.smartMoneyNet = parseFloat(smNetMatch[1].replace(/,/g, ""));

  const fnNetMatch = text.match(
    /Net Asing:.*?\(?([+-]?[\d,]+)\s*lot\)?\s*\|\s*Partisipasi:\s*(\d+)%/i,
  );
  if (fnNetMatch) {
    signal.foreignNet = parseFloat(fnNetMatch[1].replace(/,/g, ""));
    signal.foreignPartisipasi = parseInt(fnNetMatch[2]);
  } else {
    const fnNetSimple = text.match(/Net Asing:\s*.*?\(?([+-]?[\d,]+)\s*lot/i);
    if (fnNetSimple)
      signal.foreignNet = parseFloat(fnNetSimple[1].replace(/,/g, ""));
  }

  const betaMatch = text.match(
    /Beta:\s*([\d.]+)\s*\([^)]+\)\s*\|\s*Volatilitas:\s*(\d+)%/,
  );
  if (betaMatch) {
    signal.beta = parseFloat(betaMatch[1]);
    signal.volatilitas = parseInt(betaMatch[2]);
  }

  const buyerBlock = text.match(
    /Top Buyer:([\s\S]*?)(?=🔴 Top Seller:|📊 Foreign Flow:)/,
  );
  if (buyerBlock) {
    const buyerRegex = /([A-Z]{2})\s*\[.*?\].*?\+\s*([\d,.]+[MK]?)\s*lot/g;
    let bMatch;
    while ((bMatch = buyerRegex.exec(buyerBlock[1])) !== null) {
      signal.topBuyers.push({
        code: bMatch[1],
        lot: parseLotString(bMatch[2]),
      });
    }
  }

  const sellerBlock = text.match(
    /Top Seller:([\s\S]*?)(?=📊 Foreign Flow:|💡 Analyst Opinion:)/,
  );
  if (sellerBlock) {
    const sellerRegex = /([A-Z]{2})\s*\[.*?\].*?\+\s*([\d,.]+[MK]?)\s*lot/g;
    let sMatch;
    while ((sMatch = sellerRegex.exec(sellerBlock[1])) !== null) {
      signal.topSellers.push({
        code: sMatch[1],
        lot: parseLotString(sMatch[2]),
      });
    }
  }

  const opinionMatch = text.match(
    /💡 Analyst Opinion:\s*([\s\S]*?)(?=📰 Berita Terkait:|🤖 Powered by)/,
  );
  if (opinionMatch) signal.analystOpinion = opinionMatch[1].trim();

  const newsBlock = text.match(
    /📰 Berita Terkait:\s*([\s\S]*?)(?=🤖 Powered by|$)/,
  );
  if (newsBlock) {
    const newsLines = newsBlock[1]
      .split("\n")
      .filter((line) => line.trim().startsWith("•"));
    signal.relatedNews = newsLines.map((line) => line.replace("•", "").trim());
  }

  if (signal.stockCode && signal.entryPrice && signal.tp1 && signal.sl)
    return signal;
  return null;
}

// ============ YAHOO FINANCE ============
const yahooCache = new Map();

async function fetchYahooData(symbol) {
  const now = Date.now();
  const cached = yahooCache.get(symbol);
  if (cached && now - cached.timestamp < 10000) {
    return cached.data;
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.JK`;
    const response = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000,
    });
    const meta = response.data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error("Meta tidak ditemukan");

    const regularMarketTime = meta.regularMarketTime;
    const dateObj = moment.unix(regularMarketTime).tz('Asia/Jakarta');
    const dateStr = dateObj.format('YYYY-MM-DD');

    const result = {
      price: meta.regularMarketPrice,
      date: dateStr,
    };
    yahooCache.set(symbol, { data: result, timestamp: now });
    return result;
  } catch (err) {
    console.error(`Yahoo error for ${symbol}:`, err.message);
    return null;
  }
}

// ============ FILTER HARI LIBUR ============
const liburCache = { date: null, isLibur: false };
let currentHolidayName = null;

async function isTradingDay() {
  const now = moment().tz('Asia/Jakarta');
  const today = now.format("YYYY-MM-DD");
  const dayOfWeek = now.day();

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    currentHolidayName = 'Akhir Pekan';
    return false;
  }

  if (liburCache.date === today) {
    if (liburCache.isLibur) {
      currentHolidayName = liburCache.holidayName || 'Libur Nasional';
    } else {
      currentHolidayName = null;
    }
    return !liburCache.isLibur;
  }

  try {
    const response = await axios.get('https://api-hari-libur.vercel.app/api', {
      timeout: 5000,
    });
    if (response.data && response.data.data) {
      const holiday = response.data.data.find((h) => h.date === today);
      if (holiday) {
        liburCache.date = today;
        liburCache.isLibur = true;
        liburCache.holidayName = holiday.description || 'Libur Nasional';
        currentHolidayName = liburCache.holidayName;
        return false;
      }
    }
  } catch (err) {
    console.error('Gagal cek libur, asumsikan hari trading:', err.message);
  }

  liburCache.date = today;
  liburCache.isLibur = false;
  liburCache.holidayName = null;
  currentHolidayName = null;
  return true;
}

async function isMarketOpen() {
  if (!(await isTradingDay())) return false;

  const now = moment().tz('Asia/Jakarta');
  const hour = now.hour();
  const minute = now.minute();
  const dayOfWeek = now.day();
  const isFriday = dayOfWeek === 5;

  if (isFriday) {
    const session1 = (hour > 9 || (hour === 9 && minute >= 0)) &&
                     (hour < 11 || (hour === 11 && minute <= 30));
    const session2 = (hour > 14 || (hour === 14 && minute >= 0)) &&
                     (hour < 15 || (hour === 15 && minute <= 49));
    return session1 || session2;
  } else {
    const session1 = (hour > 9 || (hour === 9 && minute >= 0)) &&
                     (hour < 12 || (hour === 12 && minute <= 0));
    const session2 = (hour > 13 || (hour === 13 && minute >= 30)) &&
                     (hour < 15 || (hour === 15 && minute <= 49));
    return session1 || session2;
  }
}

// ============ AUTO TP/SL ============
async function checkRunningPositions() {
  if (!(await isMarketOpen())) return;

  const signals = loadSignals();
  const today = moment().tz('Asia/Jakarta').format('YYYY-MM-DD');
  let updated = false;

  for (const s of signals) {
    if (s.status !== "RUNNING") continue;

    const data = await fetchYahooData(s.stockCode);
    if (!data) continue;

    if (data.date !== today) {
      console.log(`[AUTO] Data untuk ${s.stockCode} masih tanggal ${data.date} (bukan hari ini), skip.`);
      continue;
    }

    const price = data.price;

    // Inisialisasi jika null
    if (s.currentHigh === null || s.currentHigh === undefined) {
      s.currentHigh = s.entryPrice;
      s.currentLow = s.entryPrice;
    }

    if (price > s.currentHigh) s.currentHigh = price;
    if (price < s.currentLow) s.currentLow = price;

    let newStatus = null;
    let exitPrice = null;

    if (s.currentLow <= s.sl) {
      newStatus = "SL";
      exitPrice = s.sl;
    } else if (s.currentHigh >= s.tp1) {
      newStatus = "TP";
      exitPrice = s.tp1;
    }

    if (newStatus) {
      s.status = newStatus;
      s.exitPrice = exitPrice;
      s.returnPercent = ((exitPrice - s.entryPrice) / s.entryPrice) * 100;
      s.closeDate = moment().format("YYYY-MM-DD HH:mm:ss");
      s.holdingDays = moment().diff(moment(s.signalDate), "days");
      updated = true;
      console.log(`[AUTO] ${s.stockCode} ${newStatus} at ${exitPrice} (High: ${s.currentHigh}, Low: ${s.currentLow})`);
    }
  }
  if (updated) saveSignals(signals);
}

// ============ LAPORAN ============
async function generateDailyReportAsync() {
  const signals = loadSignals();
  const today = moment().format("YYYY-MM-DD");
  const todaySignals = signals.filter((s) =>
    moment(s.signalDate).isSame(today, "day"),
  );

  const tp = todaySignals.filter((s) => s.status === "TP");
  const sl = todaySignals.filter((s) => s.status === "SL");
  const running = todaySignals.filter((s) => s.status === "RUNNING");

  let totalReturn = 0;
  tp.forEach((t) => (totalReturn += t.returnPercent || 0));
  sl.forEach((t) => (totalReturn += t.returnPercent || 0));

  const winRate =
    tp.length + sl.length > 0 ? (tp.length / (tp.length + sl.length)) * 100 : 0;

  let report = `📊 *Daily Report* - ${moment().format("DD MMM YYYY")}\n\n`;
  report += `*Total Signals:* ${todaySignals.length}\n`;
  report += `*TP:* ${tp.length}\n`;
  report += `*SL:* ${sl.length}\n`;
  report += `*Running:* ${running.length}\n`;
  report += `*Win Rate:* ${winRate.toFixed(2)}%\n`;
  report += `*Total Return:* ${totalReturn.toFixed(2)}%\n\n`;

  const closed = [...tp, ...sl];
  if (closed.length) {
    const best = closed.reduce((a, b) =>
      (a.returnPercent || 0) > (b.returnPercent || 0) ? a : b,
    );
    const worst = closed.reduce((a, b) =>
      (a.returnPercent || 0) < (b.returnPercent || 0) ? a : b,
    );
    report += `🏆 *Best Trade:* ${best.stockCode} ${best.returnPercent > 0 ? "+" : ""}${best.returnPercent.toFixed(2)}%\n`;
    report += `📉 *Worst Trade:* ${worst.stockCode} ${worst.returnPercent > 0 ? "+" : ""}${worst.returnPercent.toFixed(2)}%\n\n`;
  }

  const runningToday = todaySignals.filter((s) => s.status === "RUNNING");
  if (runningToday.length) {
    report += `🟡 *Open Positions:*\n`;
    for (const r of runningToday) {
      const data = await fetchYahooData(r.stockCode);
      const currentPrice = data ? data.price : "?";
      const currentReturn = data
        ? ((data.price - r.entryPrice) / r.entryPrice) * 100
        : 0;
      const holdingDays = moment().diff(moment(r.signalDate), "days");
      report += `${r.stockCode}: Entry ${r.entryPrice}, Current ${currentPrice}, Return ${currentReturn > 0 ? "+" : ""}${currentReturn.toFixed(2)}%, Hold ${holdingDays} days\n`;
    }
    report += "\n";
  }

  const stockCount = {};
  todaySignals.forEach(
    (s) => (stockCount[s.stockCode] = (stockCount[s.stockCode] || 0) + 1),
  );
  const sorted = Object.entries(stockCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (sorted.length) {
    report += `*Most Active Stocks:*\n`;
    sorted.forEach(
      ([code, count], idx) => (report += `${idx + 1}. ${code} (${count}x)\n`),
    );
  }

  return report;
}

async function updateAllReports() {
  try {
    const dailyReport = await generateDailyReportAsync();

    const reports = loadReports();

    const dayLabel = moment().format("YYYY-MM-DD");
    const dailyEntry = {
      id: Date.now(),
      date: moment().format("YYYY-MM-DD HH:mm:ss"),
      title: `Daily - ${dayLabel}`,
      content: dailyReport,
    };
    const existingDailyIdx = reports.daily.findIndex(
      (r) => r.title === dailyEntry.title,
    );
    if (existingDailyIdx !== -1) {
      reports.daily[existingDailyIdx] = dailyEntry;
    } else {
      reports.daily.unshift(dailyEntry);
      if (reports.daily.length > 30) reports.daily.pop();
    }

    saveReports(reports);
    console.log("[REPORT] Daily report updated.");
  } catch (err) {
    console.error("[REPORT] Error updating daily report:", err.message);
  }
}

// ============ EXPRESS WEB SERVER ============
const app = express();
const PORT =
  process.env.PORT || process.env.SERVER_PORT || process.env.APP_PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/reports", (req, res) => {
  const reports = loadReports();
  res.json(reports);
});

const priceCacheBackend = new Map();
app.get("/api/price/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    if (priceCacheBackend.has(symbol)) {
      const cached = priceCacheBackend.get(symbol);
      if (Date.now() - cached.timestamp < 30000) {
        return res.json({ symbol, price: cached.price });
      }
    }
    const data = await fetchYahooData(symbol);
    if (data) {
      priceCacheBackend.set(symbol, { price: data.price, timestamp: Date.now() });
      res.json({ symbol, price: data.price });
    } else {
      res.status(404).json({ error: "Price not found" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const infoCache = new Map();
app.get("/api/stock-info/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (infoCache.has(symbol)) {
    const cached = infoCache.get(symbol);
    if (Date.now() - cached.timestamp < 3600000) {
      return res.json(cached.data);
    }
  }
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.JK`;
    const response = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000,
    });
    const meta = response.data?.chart?.result?.[0]?.meta;
    const longName = meta?.longName || meta?.symbol || symbol;
    const logoUrl = `https://assets.parqet.com/logos/symbol/${symbol}.png`;
    const result = { symbol, longName, logoUrl };
    infoCache.set(symbol, { data: result, timestamp: Date.now() });
    res.json(result);
  } catch (error) {
    res.json({ symbol, longName: symbol, logoUrl: `https://assets.parqet.com/logos/symbol/${symbol}.png` });
  }
});

app.get("/api/signals", (req, res) => {
  const signals = loadSignals();
  const running = signals.filter((s) => s.status === "RUNNING");
  const closed = signals.filter((s) => s.status !== "RUNNING").slice(-20);
  res.json({ running, closed });
});

app.get("/api/market-status", async (req, res) => {
  const open = await isMarketOpen();
  const now = moment().tz("Asia/Jakarta");
  const dayOfWeek = now.day();
  let statusText = '';
  let statusClass = '';

  if (open) {
    statusText = 'Market Open';
    statusClass = 'open';
  } else {
    const tradingDay = await isTradingDay();
    if (!tradingDay) {
      statusText = `Libur: ${currentHolidayName || 'Nasional'}`;
      statusClass = 'holiday';
    } else {
      const hour = now.hour();
      const minute = now.minute();
      if (dayOfWeek === 5) {
        if (hour < 9 || (hour === 9 && minute < 0)) {
          statusText = 'Pra Buka';
        } else if ((hour > 11 || (hour === 11 && minute > 30)) && (hour < 14 || (hour === 14 && minute < 0))) {
          statusText = 'Istirahat';
        } else if (hour >= 15 || (hour === 15 && minute > 49)) {
          statusText = 'Pasca Bursa';
        } else {
          statusText = 'Market Closed';
        }
      } else {
        if (hour < 9 || (hour === 9 && minute < 0)) {
          statusText = 'Pra Buka';
        } else if ((hour > 12 || (hour === 12 && minute > 0)) && (hour < 13 || (hour === 13 && minute < 30))) {
          statusText = 'Istirahat';
        } else if (hour >= 15 || (hour === 15 && minute > 49)) {
          statusText = 'Pasca Bursa';
        } else {
          statusText = 'Market Closed';
        }
      }
      statusClass = 'closed';
    }
  }

  res.json({
    isOpen: open,
    currentTime: now.format("HH:mm:ss"),
    day: now.format("dddd"),
    date: now.format("DD MMM YYYY"),
    statusText: statusText,
    statusClass: statusClass,
    holidayName: currentHolidayName
  });
});

async function getPublicIP() {
  const sources = [
    "https://api.ipify.org?format=text",
    "https://ifconfig.me/ip",
    "https://ident.me",
  ];
  for (const url of sources) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url.trim(), { signal: controller.signal });
      clearTimeout(timeoutId);
      const ip = (await res.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
    } catch {}
  }
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

app.get("/", (req, res) => {
  res.send("Server aktif!");
});

app.listen(PORT, "0.0.0.0", async () => {
  const ip = await getPublicIP();
  console.log(`\n🌐 Web dashboard available at:`);
  console.log(`   • http://localhost:${PORT}`);
  console.log(`   • http://${ip}:${PORT} (dari jaringan lain)`);
  console.log(`\n✅ Server running on IP: ${ip}, Port: ${PORT}`);
});

// ============ TELEGRAM ============
function askQuestion(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const onData = (data) => {
      const input = data.toString().trim();
      process.stdin.removeListener("data", onData);
      resolve(input);
    };
    process.stdin.on("data", onData);
  });
}

async function scanAndSelectTelegramGroup() {
  console.log("\n🔍 Memindai grup Telegram...");
  const dialogs = await teleClient.getDialogs();
  const groups = [];
  for (const dialog of dialogs) {
    const chat = dialog.entity;
    if (
      chat.className === "Chat" ||
      (chat.className === "Channel" && chat.megagroup === true)
    ) {
      groups.push({
        id: chat.id,
        title: chat.title || "Tidak ada judul",
        type: chat.className === "Chat" ? "Grup biasa" : "Supergrup",
      });
    }
  }
  groups.forEach((g, idx) =>
    console.log(`${idx + 1}. ${g.title} [${g.type}] (ID: ${g.id})`),
  );
  const answer = await askQuestion("Pilih nomor grup: ");
  let cleaned = answer.trim();
  if (/^(\d)\1+$/.test(cleaned)) cleaned = cleaned[0];
  const idx = parseInt(cleaned) - 1;
  if (idx >= 0 && idx < groups.length) {
    const selected = groups[idx];
    console.log(`✅ Grup target: ${selected.title} (ID: ${selected.id})`);
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify({ target_chat_id: selected.id }, null, 2),
    );
    return selected.id;
  } else {
    console.log("❌ Pilihan salah, ulangi");
    return scanAndSelectTelegramGroup();
  }
}

async function setupTopicFilter(chatEntity) {
  console.log(
    "\n🏷️ Grup ini adalah supergrup. Apakah ingin memfilter berdasarkan topik? (y/n): ",
  );
  const answer = await askQuestion("(y/n): ");
  if (answer.toLowerCase() !== "y") {
    console.log("✅ Filter topik dinonaktifkan. Semua pesan akan diproses.");
    return null;
  }
  console.log("\n🔍 Memindai topik dari 50 pesan terakhir...");
  try {
    const messages = await teleClient.getMessages(chatEntity, { limit: 50 });
    const topicIds = new Set();
    for (const msg of messages) {
      const topicId = msg.replyToMsgId;
      if (topicId) topicIds.add(topicId);
    }
    if (topicIds.size === 0) {
      console.log(
        "⚠️ Tidak ditemukan topik. Pastikan grup memiliki topics aktif dan sudah ada pesan.",
      );
      console.log("Filter topik dinonaktifkan.");
      return null;
    }
    const topics = Array.from(topicIds).sort((a, b) => a - b);
    console.log(`\n📋 Daftar ID topik yang terdeteksi:\n`);
    topics.forEach((id, idx) => console.log(`${idx + 1}. ID Topik: ${id}`));
    console.log(`\n0. Lewati (ambil semua pesan tanpa filter topik)`);
    const choice = await askQuestion("Pilih nomor topik: ");
    let cleaned = choice.trim();
    if (/^(\d)\1+$/.test(cleaned)) cleaned = cleaned[0];
    const idx = parseInt(cleaned) - 1;
    if (idx >= 0 && idx < topics.length) {
      const selected = topics[idx];
      console.log(
        `✅ Filter topik: hanya pesan dari topik ID ${selected} akan diproses.`,
      );
      return selected;
    } else {
      console.log("✅ Filter topik dinonaktifkan.");
      return null;
    }
  } catch (err) {
    console.error("❌ Gagal memindai topik:", err.message);
    return null;
  }
}

function normalizeId(id) {
  let s = id.toString();
  if (s.startsWith("-100")) s = s.substring(4);
  return s;
}

// ============ MAIN ============
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let teleClient;

(async () => {
  // Inisialisasi Telegram
  let sessionString = "";
  if (fs.existsSync(SESSION_FILE)) {
    sessionString = fs.readFileSync(SESSION_FILE, "utf8");
  }
  const teleSession = new StringSession(sessionString);
  teleClient = new TelegramClient(teleSession, api_id, api_hash, {
    connectionRetries: 5,
  });

  try {
    await teleClient.start({
      phoneNumber: async () =>
        new Promise((resolve) =>
          rl.question("📱 Nomor Telegram (+62...): ", resolve),
        ),
      phoneCode: async () =>
        new Promise((resolve) => rl.question("🔑 Kode verifikasi: ", resolve)),
      password: async () =>
        new Promise((resolve) => rl.question("🔒 Password 2FA: ", resolve)),
      onError: (err) => console.log("❌ Error login:", err),
    });
    fs.writeFileSync(SESSION_FILE, teleClient.session.save(), "utf8");
    console.log("✅ Login Telegram berhasil!");
  } catch (err) {
    console.error("❌ Fatal:", err.message);
    process.exit(1);
  }

  // Konfigurasi target grup
  if (fs.existsSync(CONFIG_FILE)) {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    targetTelegramChatId = cfg.target_chat_id;
    console.log(`📌 Grup Telegram target: ${targetTelegramChatId}`);
    if (cfg.target_topic_id !== undefined) {
      targetTopicId = cfg.target_topic_id;
      if (targetTopicId === null) console.log("✅ Filter topik dinonaktifkan");
      else console.log(`📌 Filter topik aktif: ID ${targetTopicId}`);
    } else {
      targetTopicId = undefined;
    }
  } else {
    targetTelegramChatId = await scanAndSelectTelegramGroup();
    targetTopicId = undefined;
  }

  if (targetTopicId === undefined) {
    const chat = await teleClient.getEntity(targetTelegramChatId);
    if (chat.className === "Channel" && chat.megagroup === true) {
      targetTopicId = await setupTopicFilter(chat);
    } else {
      targetTopicId = null;
    }
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    cfg.target_topic_id = targetTopicId;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  }

  // Pengecekan otomatis tiap 30 detik (tanpa WhatsApp)
  setInterval(checkRunningPositions, 30000);
  setTimeout(checkRunningPositions, 5000);

  console.log("\n🎉 Bot siap! Menunggu pesan dari grup Telegram...\n");

  // ===== EVENT HANDLER TELEGRAM =====
teleClient.addEventHandler(async (update) => {
  if (!update || !update.className) return;
  let msg = null;
  if (update.className === "UpdateNewChannelMessage") msg = update.message;
  else if (update.className === "UpdateNewMessage") msg = update.message;
  else return;
  if (!msg) return;

  let chatId = null;
  if (msg.chatId) chatId = msg.chatId;
  else if (msg.peerId?.channelId) chatId = msg.peerId.channelId;
  else if (msg.peerId?.chatId) chatId = msg.peerId.chatId;
  else if (msg.peerId?.userId) chatId = msg.peerId.userId;
  if (!chatId) return;

  if (normalizeId(chatId) !== normalizeId(targetTelegramChatId)) return;
  const msgTopicId = msg.replyToMsgId;
  if (targetTopicId !== null && msgTopicId !== targetTopicId) return;

  let text = msg.text || msg.message || "";
  if (!text.trim()) return;

  // === FILTER HARI LIBUR ===
  if (!(await isTradingDay())) {
    console.log(`[INFO] Hari libur, sinyal diabaikan.`);
    return;
  }

  // Proses hanya sinyal baru
  let newSignal = parseNewSignal(text);
  const signals = loadSignals();

  if (newSignal) {
  newSignal.currentHigh = newSignal.entryPrice;
  newSignal.currentLow = newSignal.entryPrice;

  const existingIdx = signals.findIndex(
    (s) => s.stockCode === newSignal.stockCode && s.status === "RUNNING",
  );
  if (existingIdx !== -1) {
    signals[existingIdx] = newSignal;
    saveSignals(signals);
    console.log(`[SIGNAL] Replace signal for ${newSignal.stockCode} with new data.`);
  } else {
    signals.push(newSignal);
    saveSignals(signals);
    console.log(`[SIGNAL] New signal: ${newSignal.stockCode}`);
  }
  } else {
    console.log(`[INFO] Pesan diabaikan (bukan sinyal baru): ${text.substring(0, 50)}`);
  }
});

  console.log("Menunggu pesan... (Ctrl+C stop)");
})();