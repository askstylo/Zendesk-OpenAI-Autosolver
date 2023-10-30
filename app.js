// Environment configuration
require("dotenv").config();

// Native and third-party modules
const express = require("express");
const crypto = require("node:crypto");
const axios = require("axios"); // For making HTTP requests
const OpenAIApi = require("openai");
const tiktoken = require("tiktoken");

// Constants
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// This signing secret is the one ZD always uses when testing webhooks before creation. It's not the same as the one you'd use in production. Replace this with ZD_SIGNING_SECRET from your .env file after activating the webhook.
const TEST_SIGNING_SECRET = "dGhpc19zZWNyZXRfaXNfZm9yX3Rlc3Rpbmdfb25seQ==";
const SIGNING_SECRET_ALGORITHM = "sha256";

const ZD_AUTH = Buffer.from(
  `${process.env.ZD_EMAIL}/token:${process.env.ZD_API_KEY}`
).toString("base64");

const app = express();
const openai = new OpenAIApi({
  apiKey: OPENAI_API_KEY,
});

function isValidSignature(signature, body, timestamp) {
  const hmac = crypto.createHmac(SIGNING_SECRET_ALGORITHM, TEST_SIGNING_SECRET);
  const sig = hmac.update(timestamp + body).digest("base64");
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
  // if you don't feel comfortable letting this solve tickets for you. Have it just tag them for a quick review from a team member!

  const data = {
    ticket: {
      comment: {
        body: "This ticket was automatically solved as we've detected that the conversation is done",
        public: false,
      },
      status: "solved",
      tags: ["auto_solved"],
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
  console.log(zd_config);

  axios(zd_config)
    // .then((response) => console.log(JSON.stringify(response.data)))
    .catch((error) => console.error("Error updating ticket:", error));
}

// Middleware for raw body parsing
app.use(express.json({ verify: storeRawBody }));
app.use(express.json());

// Webhook endpoint
app.post("/thanks", async (req, res) => {
  const signature = req.headers["x-zendesk-webhook-signature"];
  const timestamp = req.headers["x-zendesk-webhook-signature-timestamp"];
  const body = req.rawBody;

  if (!isValidSignature(signature, body, timestamp)) {
    console.log("HMAC signature is invalid");
    return res.status(401).send("Invalid signature");
  }

  const message = req.body.message;
  res.json({ status: 200 });
  // Check for basic thank you messages. This can easily be expanded on.
  if (
    ["thank you", "thanks", "appreciate it"].includes(
      message.trim().toLowerCase()
    )
  ) {
    autoSolveThankyou(req.body.ticket_id);
  }

  // We can assume that the message is not a basic thank you message if it's longer than 300 tokens. You could trim this down even further if you'd like
  if (numTokensFromString(message) > 300) {
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `
          Determine if a given message:

          1. Expresses only gratitude, such as "thank you", "merci", or "gracias".
          2. Is a statement signifying the conclusion of the conversation, even if it doesn't express gratitude.

          If the message meets either of the above criteria, return **true**. Otherwise, return **false**.

          Analyze the following message: ${message}
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
