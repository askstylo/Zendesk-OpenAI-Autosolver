# ZD-AI User Group - Gratitude project 

This API is designed to automatically handle and respond to Zendesk tickets, particularly those that are simple "thank you" messages.

## Overview

When the webhook endpoint (/thanks) receives a POST request, it first verifies the HMAC signature provided by Zendesk to ensure the validity of the request. If the incoming message is a simple "thank you" phrase, it automatically closes the ticket. For more complex messages, it utilizes the OpenAI API to determine whether the message is solely an expression of gratitude or if there's an additional action/query. If it's solely an expression of gratitude, the ticket is auto-closed.

## Installation

1. Clone this repository.
2. Install the required dependencies by running `npm install`.
3. Create a `.env` file in the root directory of the project and add the following environment variables:
   - `OPENAI_API_KEY`: Your OpenAI API key.
   - `ZD_EMAIL`: Your Zendesk email.
   - `ZD_API_KEY`: Your Zendesk API key.
   - `ZD_SUBDOMAIN`: Your Zendesk subdomain.
4. Start the server by running `npm start`.

## Usage

1. Send a webhook request from your Zendesk account. The body should be formatted such as this:

```
{
    "ticket_id": "{{ticket.id}}",
    "message": "{{ticket.latest_public_comment_html}}"
}
```
2. The webhook will analyze the message and determine if it's solely an expression of gratitude or if there's an additional intention or query in the message. This is done via a light check to see if the ticket includes only the words 'thanks' or 'thank you'. If that can't be determined we pass to OpenAI to have it analyze the message.
3. If the message is solely an expression of gratitude, the webhook will automatically close the ticket and mark it as solved.

## Key Functions

`isValidSignature(signature, body, timestamp)`: Validates the HMAC signature provided by Zendesk.

`storeRawBody(req, res, buf)`: Middleware function to capture the raw request body for HMAC validation.

`numTokensFromString(message)`: Calculates the number of tokens in a given message using the tiktoken library.

`autoSolveThankyou(ticket_id)`: Closes a Zendesk ticket with a status of "solved" and a tag of "auto_solve".

## Contributing

Contributions are welcome! If you find a bug or have a feature request, please open an issue or submit a pull request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
