import express from 'express';
import OpenAI from 'openai';
import { config } from 'dotenv';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import axios from 'axios';


config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const app = express();
const port = process.env.PORT || 3000;
const speechFile = path.resolve('./speech.mp3')
const transcriptionFile = path.resolve('./transcription.json');

app.use(cors());
app.use(express.json());

// Route to generate diary entry
app.post('/api/diary', async (req, res) => {
    const { date } = req.body;
    const prompt = `You are Captain Alex Reynolds, once an astronaut with grand ambitions and dreams of monumental success in space exploration. Driven to push the boundaries of human knowledge and make a lasting mark on the universe, you were celebrated for your achievements—a symbol of human determination. But now, after months lost in the vast expanse of space, those dreams have crumbled. With no hope of returning to Earth, solace is found only in your daily diary entries. Today is ${date}, and as you float alone in your spacecraft, the isolation is crushing. The endless void outside mocks your sense of purpose, a stark reminder of your failure. Your mind drifts to past glories, those fleeting moments when you felt invincible—now they are just bitter memories. Each small triumph today feels like a cruel joke, a reminder of your ultimate failure. The frustration boils over as you replay the mistakes that led to this nightmare, anger at yourself for being so blind and reckless. Longing for your loved ones and the simple comforts of Earth consumes you. The small victories of your day seem hollow against the backdrop of unfulfilled dreams. Loneliness is a relentless torment, and time feels like a cruel joke. Occasionally, you indulge in self-mockery, questioning the very ideals that once drove you, realizing how naive you were. Today's entry ends with a stark realization: the grandeur of your past achievements now feels like a distant, mocking dream. The greatness you once sought seems laughable now, and the pride you once felt is overshadowed by the deep regret of your current state. Word Limit: 200 words`;

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
            const mp3Response = await openai.audio.speech.create({
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

// Route to generate speech from text and transcribe with timestamps
app.post('/api/speech-and-transcribe', async (req, res) => {
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'Text parameter is required' });
    }

    try {
        // 1. Generate speech from text
        const mp3Response = await openai.audio.speech.create({
            model: "tts-1",
            voice: 'onyx',
            input: text
        });

        const buffer = Buffer.from(await mp3Response.arrayBuffer());
        await fs.promises.writeFile(speechFile, buffer);

        // Encode audio file as base64
        const audioBase64 = buffer.toString('base64');

        // 2. Transcribe the generated audio with timestamps
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(speechFile),
            model: "whisper-1",
            response_format: "verbose_json",
            timestamp_granularities: ["segment"]
        });

        // Save transcription for debugging or further processing
        await fs.promises.writeFile(transcriptionFile, JSON.stringify(transcription, null, 2));

        // 3. Send both audio and transcription
        res.json({
            audioBase64: `data:audio/mp3;base64,${audioBase64}`, // Base64 encoded audio
            transcription: transcription
        });

    } catch (error) {
        res.status(500).json({ error: 'Error processing request: ' + error.message });
    }
});

// Dummy endpoint
app.get('/keep-alive', (req, res) => {
    res.status(200).send('Server is alive');
});

// self-referencing
const url = `https://openai-api-backend.onrender.com/keep-alive`;
const interval = 800000; // 5 minutes

function reloadWebsite() {
    axios.get(url)
        .then(response => {
            console.log(`Reloaded at ${new Date().toISOString()}: Status Code ${response.status}`);
        })
        .catch(error => {
            console.error(`Error reloading at ${new Date().toISOString()}:`, error.message);
        })
        .finally(() => {
            // Schedule the next reload after the current one completes
            setTimeout(reloadWebsite, interval);
        });
}

// Start the first reload
reloadWebsite();

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
