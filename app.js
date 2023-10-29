// Environment configuration
require("dotenv").config();

// Native and third-party modules
const express = require("express");
const crypto = require("crypto");
const axios = require("axios"); // For making HTTP requests
const OpenAIApi = require("openai");
const tiktoken = require("tiktoken");

// Constants
const PORT = 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TEST_SIGNING_SECRET = "dGhpc19zZWNyZXRfaXNfZm9yX3Rlc3Rpbmdfb25seQ==";
const SIGNING_SECRET_ALGORITHM = "sha256";
const ZD_AUTH = Buffer.from(`${process.env.ZD_USERNAME}/token:${process.env.ZD_API_KEY}`).toString("base64");

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
  const encoder = tiktoken.encoding_for_model("gpt-3.5-turbo-instruct");
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
    .then(response => console.log(JSON.stringify(response.data)))
    .catch(error => console.error("Error updating ticket:", error.message));
}

// Middleware for raw body parsing
app.use(express.json({ verify: storeRawBody }));

// Webhook endpoint
app.post("/post", async (req, res) => {
    const signature = req.headers["x-zendesk-webhook-signature"];
    const timestamp = req.headers["x-zendesk-webhook-signature-timestamp"];
    const body = req.rawBody;
  
    if (!isValidSignature(signature, body, timestamp)) {
      console.log("HMAC signature is invalid");
      return res.status(401).send("Invalid signature");
    }
  
    const message = req.body.message;
  
    // Check for basic thank you messages
    if (
      ["thank you", "thanks", "appreciate it"].some((phrase) =>
        message.toLowerCase().includes(phrase)
      )
    ) {
      autoSolveThankyou(req.body.ticket.id);
      return res.json({ isThankYou: true });
    }
  
    // We can assume that the message is not a basic thank you message if it's longer than 300 tokens
    if (numTokensFromString(message) > 300) {
      return res.json({ isThankYou: false });
    }
  
    try {
      // Call OpenAI API (remember to include your OpenAI API key)
      const response = await openai.createCompletion({
        model: "gpt-3.5-turbo-instruct",
        prompt,
        temperature: 0.5,
        max_tokens: 3000,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      });
  
      const result = response.data.choices[0].text.trim();
      if (result.includes("just a thank you")) {
        autoSolveThankyou(req.body.ticket.id);
        return res.json({ isThankYou: true });
      }
    } catch (error) {
      console.error("Error calling OpenAI API:", error.message);
      return res.status(500).send("Internal server error");
    }
  });
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
