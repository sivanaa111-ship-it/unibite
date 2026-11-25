const app = require('./app');
const { PORT } = require('./config');
const { ensureAdmin } = require('./db/bootstrap');

ensureAdmin();
app.listen(PORT, () => console.log(`UniBite running at http://localhost:${PORT}`));
