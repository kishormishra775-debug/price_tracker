const puppeteer = require("puppeteer");
const axios = require("axios");
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ================= CONFIG =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const FILE = path.join(__dirname, "products.json");

// ================= TELEGRAM =================
async function sendTelegram(msg) {
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: msg
    });
  } catch (e) {
    console.log("Telegram error:", e.message);
  }
}

// ================= FILE =================
function loadProducts() {
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]");
  return JSON.parse(fs.readFileSync(FILE));
}

function saveProducts(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// ================= API =================
app.get("/products", (req, res) => res.json(loadProducts()));

app.post("/add", (req, res) => {
  const data = loadProducts();

  data.push({
    name: req.body.name,
    url: req.body.url,
    target: parseInt(req.body.target),
    lastAlert: null
  });

  saveProducts(data);
  res.send("OK");
});

// ✅ RESET TARGET BY URL
app.post("/reset-target", (req, res) => {
  const { url, newTarget } = req.body;

  let data = loadProducts();
  let found = false;

  data = data.map(p => {
    if (p.url === url) {
      p.target = parseInt(newTarget);
      p.lastAlert = null;
      found = true;
    }
    return p;
  });

  saveProducts(data);

  if (found) res.send("Target updated");
  else res.status(404).send("Product not found");
});

// ================= UTIL =================
const delay = ms => new Promise(r => setTimeout(r, ms));

// ================= PRICE =================
async function getPrice(page) {
  try {
    await page.waitForSelector(
      "div.v1zwn21l.v1zwn20._1psv1zeb9._1psv1ze0",
      { timeout: 15000 }
    );

    const price = await page.evaluate(() => {
      const el = document.querySelector(
        "div.v1zwn21l.v1zwn20._1psv1zeb9._1psv1ze0"
      );

      if (!el) return null;

      const text = el.innerText;
      const match = text.match(/₹\s?([\d,]+)/);

      if (!match) return null;

      return parseInt(match[1].replace(/,/g, ""));
    });

    return price;

  } catch (e) {
    return null;
  }
}

// ================= TRACKER =================
async function startTracker() {
  console.log("🚀 Tracker starting...");

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--single-process",
      "--no-zygote"
    ]
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  );

  while (true) {
    console.log("🔁 Loop running...");

    const products = loadProducts();

    for (let p of products) {
      try {
        console.log("Checking:", p.name);

        await page.goto(p.url, {
          waitUntil: "networkidle2",
          timeout: 60000
        });

        try {
          await page.click("button._2KpZ6l._2doB4z");
        } catch {}

        await delay(3000);

        let price = await getPrice(page);

        if (!price) {
          console.log("Retrying...");
          await delay(2000);
          price = await getPrice(page);
        }

        if (!price) {
          console.log("❌ Price not found:", p.name);
          continue;
        }

        console.log(`💰 ${p.name}: ₹${price}`);

        if (price <= p.target && p.lastAlert !== price) {
          await sendTelegram(
            `🎯 TARGET HIT!\n\n📱 ${p.name}\n💰 ₹${price}\n🎯 Target: ₹${p.target}\n\n🔗 ${p.url}`
          );

          p.lastAlert = price;
          saveProducts(products);
        }

      } catch (err) {
        console.log("Error:", err.message);
      }

      await delay(3000);
    }

    await delay(10000);
  }
}

// ================= START =================
app.listen(process.env.PORT || 3000, () => {
  console.log("🌐 Server running...");
});

startTracker();