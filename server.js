const app = require('./app');
const PORT = 3000;

const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

// This will be useful for tests
module.exports = server;
