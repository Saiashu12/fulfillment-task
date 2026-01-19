require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient();
const app = express();

const PORT = process.env.PORT || 4001;
const DB_URI = process.env.DATABASE_URL;

app.use(cors());
app.use(bodyParser.json());

app.get("/", (_req, res) => {
  res.send("Node fulfillment & carrier service server is running.");
});

console.log("hello");
console.log(DB_URI);
//inventory
app.post("/inventory", async (req, res) => {
  console.log("hii inventory");
  try {
    const { sku } = req.body || {};
    if (!sku) {
      return res.status(400).json({ error: "Missing sku" });
    }
    let inventory = 0;
    console.log(sku.length);
    inventory= sku.length*2;
    return res.json({ sku, inventory });
  } catch (err) {
    console.error("Inventory error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

//carrier-service
app.post("/carrier-service", async (req, res) => {
  console.log("Hii carrier");
  console.log("Incoming headers:", req.headers);

  try {
    const rate = req.body.rate;
    console.log("Parsed rate:", rate);

    if (!rate || !Array.isArray(rate.items)) {
      console.warn("Invalid payload: missing rate.items", req.body);
      return res
        .status(400)
        .json({ error: "Invalid payload: missing rate.items" });
    }

    const totalItems = rate.items.reduce(
      (sum, item) => sum + (item.quantity || 0),
      0
    );

    const currency = rate.currency || "USD";
    const today = new Date();

    const daysFromNow = (days) => {
      const d = new Date(today);
      d.setDate(d.getDate() + days);
      return d.toISOString();
    };

    const rates = [];

    if (totalItems === 1) {
      rates.push({
        service_name: "Standard Delivery",
        service_code: "STANDARD",
        description: "Standard delivery for a single item",
        total_price: "0", 
        currency,
        min_delivery_date: daysFromNow(4),
        max_delivery_date: daysFromNow(4),
      });
    }

    if (totalItems === 2) {
      rates.push(
        {
          service_name: "Standard Delivery",
          service_code: "STANDARD",
          description: "Standard delivery for two items",
          total_price: "0",
          currency,
          min_delivery_date: daysFromNow(4),
          max_delivery_date: daysFromNow(4),
        },
        {
          service_name: "Moderate Delivery",
          service_code: "MODERATE",
          description: "Moderately fast shipping",
          total_price: "500", 
          currency,
          min_delivery_date: daysFromNow(2),
          max_delivery_date: daysFromNow(3),
        }
      );
    }

    if (totalItems > 2) {
      rates.push(
        {
          service_name: "Standard Delivery",
          service_code: "STANDARD",
          description: "Standard delivery for multiple items",
          total_price: "0",
          currency,
          min_delivery_date: daysFromNow(4),
          max_delivery_date: daysFromNow(4),
        },
        {
          service_name: "Moderate Delivery",
          service_code: "MODERATE",
          description: "Moderately fast shipping",
          total_price: "500",
          currency,
          min_delivery_date: daysFromNow(2),
          max_delivery_date: daysFromNow(3),
        },
        {
          service_name: "Fast Delivery",
          service_code: "FAST",
          description: "Fastest available shipping",
          total_price: "1000", 
          currency,
          min_delivery_date: daysFromNow(1),
          max_delivery_date: daysFromNow(1),
        }
      );
    }

    console.log(totalItems);

    console.log("Responding with rates:", JSON.stringify(rates, null, 2));
    return res.json({ rates });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

//request-fulfillment
app.post("/request-fulfillment", async (req, res) => {
  console.log("fulfillement working")
  try {
    const { orderId, lineItems } = req.body || {};

    if (!orderId || !Array.isArray(lineItems)) {
      return res.status(400).json({
        error: "Missing orderId or lineItems",
      });
    }

    if (lineItems.length <= 1) {
      return res.json({
        accepted: false,
        reason: "Fulfillment requires more than one line item",
      });
    }

    await db.order.update({
      where: { id: orderId },
      data: { status: "REQUESTED" },
    });

    return res.json({ accepted: true });
  } catch (err) {
    console.error("request-fulfillment error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

//fulfill-order
app.post("/fulfill-order", async (req, res) => {
  console.log("ordered fullfillement")
  try {
    const { orderId } = req.body || {};

    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    const trackingNumber = `TRK-${orderId}-${Date.now()}`;
    const trackingUrl = `https://tracking.example.com/track/${trackingNumber}`;
    console.log(trackingNumber);
    console.log(trackingUrl)
    await db.order.update({
      where: { id: orderId },
      data: { status: "FULFILLED" },
    });
    return res.json({
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      carrier: "Custom Fulfillment Carrier",
      service: "Standard Delivery",
    });
  } catch (err) {
    console.error("fulfill-order error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(` Node server listening on port ${PORT}`);
});
