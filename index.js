import express from 'express';
import OpenAI from 'openai';
import { config } from 'dotenv';
import cors from 'cors';
import fs from 'fs';
import path from 'path';


config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const app = express();
const port = process.env.PORT || 3000;
const speechFile = path.resolve('./speech.mp3')

app.use(cors());
app.use(express.json());

// Route to generate diary entry
app.post('/api/diary', async (req, res) => {
    const { date } = req.body;
    const prompt = `You are Captain Alex Reynolds, an astronaut who has been lost in the vast expanse of space for several months. With no hope of returning to Earth, you find solace in your daily diary entries. Today is ${date}, and as you float alone in your spacecraft, you reflect on the countless days you’ve spent away from your loved ones. Describe your day in detail, including any small triumphs or struggles you faced. Emphasize the sense of isolation and longing you feel, missing your family, friends, and the simple comforts of Earth. Your entry should convey the emotional weight of your situation, revealing how you cope with loneliness and the passage of time. Ensure that your writing is consistent with your previous entries, capturing the ongoing challenges and the hope that sustains you. Aim for about 200 words and end with a complete thought that leaves a lasting impression of your emotional state.`;

    try {
        const chatCompletion = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                { role: 'system', content: 'You are an astronaut lost in space, writing daily diary entries.' },
                { role: 'user', content: prompt },
            ],
            max_tokens: 200,
        });

        let entry = chatCompletion.choices[0].message.content.trim();
        const lastCompleteSentence = entry.match(/[^.!?]*[.!?]/g)?.slice(0, -1).join(' ') || entry;

        res.json({ diaryEntry: lastCompleteSentence });

    } catch (error) {
        res.status(500).json({ error: 'Error generating diary entry: ' + error.message });
    }
});

// Route to generate speech from text
app.get('/api/speech', async (req, res) => {
    const { text } = req.query

    if (!text) {
        return res.status(400).json({ error: 'Text parameter is required' });
    } else {
        console.log(text);

        try {
            const mp3Response  = await openai.audio.speech.create({
                model: "tts-1",
                voice: 'onyx',
                input: text
            });

            const buffer = Buffer.from(await mp3Response.arrayBuffer());
            await fs.promises.writeFile(speechFile, buffer);

            res.set('Content-Type', 'audio/mpeg');
            res.send(buffer);
        } catch (error) {
            res.status(500).json({ error: 'Error generating speech: ' + error.message });
        }
    }
})

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
