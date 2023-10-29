// Environment configuration
require("dotenv").config();

// Native and third-party modules
const express = require("express");
const crypto = require("crypto");
const axios = require("axios"); // For making HTTP requests
const OpenAIApi = require("openai");
const tiktoken = require("tiktoken");

// Constants
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// This signing secret is the one ZD always uses when testing webhooks. It's not the same as the one you'd use in production.
const TEST_SIGNING_SECRET = "dGhpc19zZWNyZXRfaXNfZm9yX3Rlc3Rpbmdfb25seQ==";
const SIGNING_SECRET_ALGORITHM = "sha256";
const ZD_AUTH = Buffer.from(
  `${process.env.ZD_USERNAME}/token:${process.env.ZD_API_KEY}`
).toString("base64");

const app = express();
const openai = new OpenAIApi({
  apiKey: OPENAI_API_KEY,
});

function isValidSignature(signature, body, timestamp) {

  const hmac = crypto.createHmac(
    SIGNING_SECRET_ALGORITHM,
    process.env.ZD_SIGNING_SECRET
  );
  const sig = hmac.update(timestamp + body).digest("base64");
    console.log(sig)
  return Buffer.compare(Buffer.from(signature), Buffer.from(sig)) === 0;
}

function storeRawBody(req, res, buf) {
  if (buf && buf.length) {
    req.rawBody = buf.toString("utf8");
  }
}

function numTokensFromString(message) {
  const encoder = tiktoken.encoding_for_model("gpt-3.5-turbo");
  const tokens = encoder.encode(message);
  encoder.free();
  return tokens.length;
}

function autoSolveThankyou(ticket_id) {
  const data = {
    ticket: {
      comment: {
        body: "This ticket was automatically closed as we've detected that it's just a thank you.",
        public: false,
      },
      status: "solved",
      tags: ["auto_solve"],
    },
  };

  const zd_config = {
    method: "PUT",
    url: `https://${process.env.ZD_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticket_id}.json`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${ZD_AUTH}`,
    },
    data: JSON.stringify(data),
  };

  axios(zd_config)
    .then((response) => console.log(JSON.stringify(response.data)))
    .catch((error) => console.error("Error updating ticket:", error.message));
}

// Middleware for raw body parsing
app.use(express.json({ verify: storeRawBody }));
app.use(express.json());

// Webhook endpoint
app.post("/thanks", async (req, res) => {
  const signature = req.headers["x-zendesk-webhook-signature"];
  const timestamp = req.headers["x-zendesk-webhook-signature-timestamp"];
  const body = req.rawBody;
  console.log(signature, timestamp, body);

  if (!isValidSignature(signature, body, timestamp)) {
    console.log("HMAC signature is invalid");
    return res.status(401).send("Invalid signature");
  }

  const message = req.body.message;
  console.log(message);
  res.json({ status: 200 });
  // Check for basic thank you messages
  if (
    ["thank you", "thanks", "appreciate it"].includes(
      message.trim().toLowerCase()
    )
  ) {
    autoSolveThankyou(req.body.ticket_id);
  }

  // We can assume that the message is not a basic thank you message if it's longer than 300 tokens
  if (numTokensFromString(message) > 300) {
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `
        Analyze the below message if the user is only expressing gratitude (e.g., "thank you", "merci", "gracias", etc.) or if there's an additional action item or query in the message for the individual that is being sent this message. Return true if the message is solely an expression of gratitude, and false otherwise.

      Examples:

    Message: "Thank you very much!" (English)
    Response: true

    Message: "Gracias, ¿cuánto cuestan los pepinillos?" (Spanish)
    Response: false

    Message: "Merci, c'est tout." (French)
    Response: true

    Here is the message: ${message}

`,
        },
      ],
    });
    const result = response.choices[0].message.content.toLowerCase();
    console.log(result);
    if (result.includes("true")) {
      autoSolveThankyou(req.body.ticket_id);
    }
    return;
  } catch (error) {
    console.error("Error calling OpenAI API:", error.message);
  }
});

module.exports = app;