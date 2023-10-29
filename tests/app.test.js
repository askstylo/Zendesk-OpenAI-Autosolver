const request = require('supertest'); 
const crypto = require('crypto');
const axios = require('axios');
const OpenAIApi = require("openai");

jest.mock('axios'); 
jest.mock('openai'); 

const server = require('../server');
const app = require('../app');

describe('API tests', () => {
    afterEach(() => {
        jest.clearAllMocks(); // Clear any mocked behavior after each test
    });

    it('rejects invalid signatures', async () => {
        const invalidSignature = "invalid_signature";
        const timestamp = new Date().toISOString();
        const body = JSON.stringify({ message: "Test message" });

        await request(app).post('/thanks')
            .set('x-zendesk-webhook-signature', invalidSignature)
            .set('x-zendesk-webhook-signature-timestamp', timestamp)
            .send(body)
            .expect(401);
    });

    it('auto-solves a simple thank you message', async () => {
        const timestamp = new Date().toISOString();
        const body = JSON.stringify({ message: "Thank you", ticket_id: '123' }); // This is a string representation
    
        // Mock the HMAC signature validation
        const hmac = crypto.createHmac('sha256', process.env.ZD_SIGNING_SECRET);
        const signature = hmac.update(timestamp + body).digest("base64");
        axios.mockResolvedValue({ data: {} }); // Mock the axios response
    
        await request(app).post('/thanks')
            .set('Content-Type', 'application/json')  
            .set('x-zendesk-webhook-signature', signature)
            .set('x-zendesk-webhook-signature-timestamp', timestamp)
            .send(body)  
            .expect(200);
    
        expect(axios).toHaveBeenCalledWith(expect.objectContaining({
            method: "PUT",
            url: expect.stringMatching(/\/tickets\/123.json$/),
        }));
    });
    
    it('consults OpenAI for complex messages and handles response correctly', async () => {
        const timestamp = new Date().toISOString();
        const body = JSON.stringify({ message: "Thank you so much for your help! By the way, can you check my last order?", ticket_id: 124 });

        const hmac = crypto.createHmac('sha256', process.env.ZD_SIGNING_SECRET);
        const signature = hmac.update(timestamp + body).digest("base64");

        const mockResponse = {
            choices: [{
                message: {
                    content: "false"
                }
            }]
        };

        OpenAIApi.prototype.chat = {
            completions: {
                create: jest.fn().mockResolvedValue(mockResponse)
            }
        };

        axios.mockResolvedValue({ data: {} }); // Mock the axios response

        await request(app).post('/thanks')
            .set('Content-Type', 'application/json') 
            .set('x-zendesk-webhook-signature', signature)
            .set('x-zendesk-webhook-signature-timestamp', timestamp)
            .send(body)
            .expect(200);

        expect(OpenAIApi.prototype.chat.completions.create).toHaveBeenCalled();
        expect(axios).not.toHaveBeenCalled(); // Because the OpenAI response was "false"
    });
});

afterAll(done => {
    server.close(done);
});