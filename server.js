const express = require('express');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const PORT = 7000;

const DATA_FILE = path.join(__dirname, 'data', 'messages_public.json');

// Sajikan folder 'public' sebagai static
app.use(express.static(path.join(__dirname, 'public')));

// Sajikan folder 'data' sebagai static agar image & video dapat diakses
app.use('/data', express.static(path.join(__dirname, 'data')));

app.get('/api/messages', async (req, res) => {
    try {
        if (await fs.pathExists(DATA_FILE)) {
            const data = await fs.readJson(DATA_FILE);
            res.json(data);
        } else {
            res.status(404).json({ error: 'Data file not found.' });
        }
    } catch (error) {
        console.error('Error reading data file:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
