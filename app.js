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

function getTicketComments(ticketID){
  const zd_config = {
    method: "GET",
    url: `https://${process.env.ZD_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketID}/comments.json?include=users`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${ZD_AUTH}`,
    },
  };
  axios(zd_config)
    .then((response) => {
      const invalidChannels = ["voice", "chat", "native_messaging"];
      if (!response.data.channel.includes(invalidChannels) && response.data.comments.length > 2) {
        const comments = response.data.comments.filter(comment => comment.public);
        const lastTwoComments = comments.slice(-2);
        const users = response.data.users;
        const result = lastTwoComments.map(comment => {
          const user = users.find(user => user.id === comment.author_id);
          return {
            body: comment.body,
            name: user.name,
            role: user.role,
          };
        });
        return result;
      }
    })
    .catch((error) => console.error("Error getting ticket comments:", error));

}

// Middleware for raw body parsing
app.use(express.json({ verify: storeRawBody }));
app.use(express.json());

app.post("/multi-message", async (req, res) => {
  const signature = req.headers["x-zendesk-webhook-signature"];
  const timestamp = req.headers["x-zendesk-webhook-signature-timestamp"];
  const body = req.rawBody;

  if (!isValidSignature(signature, body, timestamp)) {
    console.log("HMAC signature is invalid");
    return res.status(401).send("Invalid signature");
  }

  if (req.body.ticket_id) {
    const ticket_id = req.body.ticket_id;
    const comments = getTicketComments(ticket_id);
    const prompt = `**Objective:** Assess whether the last two comments in a ticket signify a completed conversation. A conversation is deemed concluded if the final two comments adhere to all of the following conditions:

1. **Gratitude Expression:** The comments contain expressions of gratitude, such as "thank you," "merci," or "gracias," without introducing new queries or requests.
   
2. **Conclusive Statement:** The comments include statements that indicate the end of the discussion, not necessarily expressing gratitude but clearly signaling closure.
   
3. **No Pending Actions or Queries:** Neither of the last two comments introduces new action items, tasks to be completed, or questions that require further interaction.

**Non-completed Conversation Examples:**

- Example 1:
    - Agent (John): "Great, thanks for chatting. Have a great day!"
    - End-user (Jane): "I have another question."
    - *Reason:* New question introduced, indicating ongoing conversation.

- Example 2:
    - Agent (John): "I need to look into this further. I'll get back to you."
    - End-user (Jane): "Ok, thanks."
    - *Reason:* Indication of pending action, suggesting the conversation is not concluded.

**Evaluation Instructions:**

Analyze the provided messages to determine if they constitute a completed conversation based on the criteria above. If the messages satisfy all the listed conditions, return **true**. Otherwise, return **false**.

**Messages to Analyze:** ${comments}`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: prompt,
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
  
  }

});


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
