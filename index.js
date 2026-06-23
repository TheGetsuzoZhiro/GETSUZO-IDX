const axios = require("axios");
const moment = require("moment-timezone");
const express = require("express");
const path = require("path");
const os = require("os");
const mongoose = require("mongoose");

// ============ KONFIGURASI ZONA WAKTU ============
moment.tz.setDefault('Asia/Jakarta');

// ============ KONEKSI MONGODB ============
const MONGO_URI = "mongodb+srv://zhironihboss_db_user:tzPCYPLUNw0fWrTz@cluster0.bfs8tiy.mongodb.net/getsuzo_db?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ Berhasil terhubung ke MongoDB Atlas (Read-Only Mode)!"))
  .catch((err) => console.error("❌ Gagal koneksi ke MongoDB:", err.message));

// ============ MONGOOSE SCHEMAS & MODELS ============
const SignalSchema = new mongoose.Schema({
  stockCode: String,
  signalType: String,
  confidenceScore: Number,
  confidenceDetails: [String],
  entryPrice: Number,
  tp1: Number,
  sl: Number,
  slModerat: Number,
  slKonservatif: Number,
  macd: Number,
  macdSignal: Number,
  rsi: Number,
  ema20: Number,
  ema50: Number,
  vwap: Number,
  adx: Number,
  bbLow: Number,
  bbHigh: Number,
  atr: Number,
  patternChart: String,
  patternCandle: String,
  sinyalBandar: String,
  smartMoneyNet: Number,
  foreignNet: Number,
  foreignPartisipasi: Number,
  beta: Number,
  volatilitas: Number,
  topBuyers: [{ code: String, lot: Number }],
  topSellers: [{ code: String, lot: Number }],
  analystOpinion: String,
  relatedNews: [String],
  status: String,
  signalDate: String,
  closeDate: String,
  exitPrice: Number,
  returnPercent: Number,
  holdingDays: Number,
  currentHigh: Number,
  currentLow: Number
}, { versionKey: false });

const ReportSchema = new mongoose.Schema({
  type: { type: String, default: "daily" },
  daily: [{
    id: Number,
    date: String,
    title: String,
    content: String
  }]
}, { versionKey: false });

const SignalModel = mongoose.model("Signal", SignalSchema, "signals");
const ReportModel = mongoose.model("Report", ReportSchema, "reports");

// Helper untuk memastikan dokumen reports global dibaca dengan aman
async function initReportDoc() {
  let reportDoc = await ReportModel.findOne({ type: "daily" });
  if (!reportDoc) {
    reportDoc = { type: "daily", daily: [] };
  }
  return reportDoc;
}

// ============ YAHOO FINANCE & MARKET TIME HELPERS ============
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
    const session1 = (hour > 9 || (hour === 9 && minute >= 0)) && (hour < 11 || (hour === 11 && minute <= 30));
    const session2 = (hour > 14 || (hour === 14 && minute >= 0)) && (hour < 15 || (hour === 15 && minute <= 49));
    return session1 || session2;
  } else {
    const session1 = (hour > 9 || (hour === 9 && minute >= 0)) && (hour < 12 || (hour === 12 && minute <= 0));
    const session2 = (hour > 13 || (hour === 13 && minute >= 30)) && (hour < 15 || (hour === 15 && minute <= 49));
    return session1 || session2;
  }
}

// ============ EXPRESS WEB SERVER (READ-ONLY INTERFACE) ============
const app = express();
const PORT = process.env.PORT || process.env.SERVER_PORT || process.env.APP_PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Route 1: Mengambil Data Laporan / Report dari Mongo (Read-Only)
app.get("/api/reports", async (req, res) => {
  try {
    const reportDoc = await initReportDoc();
    res.json(reportDoc);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route 2: Realtime Price Checker via Yahoo
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

// Route 3: Mengambil Informasi Profil Saham & Logo
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

// Route 4: Mengambil Data Sinyal (Running & Closed) dari Mongo (Read-Only)
app.get("/api/signals", async (req, res) => {
  try {
    const allSignals = await SignalModel.find({});
    const running = allSignals.filter((s) => s.status === "RUNNING");
    const closed = allSignals.filter((s) => s.status !== "RUNNING").slice(-20);
    res.json({ running, closed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route 5: Mengambil Status Operasional Bursa Realtime
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

// Helper IP publik untuk logging lokal
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
  res.send("Server Frontend Read-Only Aktif!");
});

app.listen(PORT, "0.0.0.0", async () => {
  const ip = await getPublicIP();
  console.log(`\n🌐 Frontend API server available at:`);
  console.log(`   • http://localhost:${PORT}`);
  console.log(`   • http://${ip}:${PORT}`);
  console.log(`\n✅ Read-Only Server running on Port: ${PORT}`);
});
