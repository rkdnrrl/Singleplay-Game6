const express = require('express');

const PLATFORM_API_URL = process.env.PLATFORM_API_URL || 'http://43.203.215.179:4000';
const PORT = Number(process.env.PORT) || 3008;

const app = express();

app.get('/config.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/javascript');
  res.send(`window.__ALP_PLATFORM_API__ = ${JSON.stringify(PLATFORM_API_URL)};`);
});

app.use(
  express.static(__dirname, {
    index: 'index.html',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

app.listen(PORT, () => {
  console.log(`Alchemy (Singleplay-Game6) on port ${PORT}`);
});
