import express from 'express';
import OpenAI, { toFile } from 'openai';
import { config } from 'dotenv';
import cors from 'cors';
import axios from 'axios';

config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Persona and Prompts
const DIARY_SYSTEM_PROMPT = 'You are an astronaut lost in space, writing daily diary entries.';

// Restored to accept the date directly into the text again
const getDiaryPrompt = (date) => `You are Captain Alex Reynolds, once an astronaut brimming with ambition and dreams of groundbreaking discoveries in the far reaches of space. Driven by a desire to push the boundaries of human exploration, you embarked on this mission hoping to make a lasting impact. But now, months have passed, and those grand aspirations have faded into the harsh reality of isolation. Stranded in the vast expanse of space with no hope of returning to Earth, you spend your days reflecting on how your once-bright future has unraveled into a solitary existence. Today is ${date}. As you float alone in your spacecraft, you ponder how the days have turned into weeks and then into months. You reflect on the crushing disappointment of failure and the ever-present loneliness, missing your family, friends, and the simple comforts of Earth. Describe your day in detail, including any small triumphs or struggles you faced. Emphasize the deep sense of isolation and longing, tempered by a lingering hope that something might change. Your entry should capture the weight of your emotional journey—from once seeking greatness to now just trying to endure the passage of time. Ensure your writing remains consistent with previous entries, conveying the ongoing battle between despair and resilience, and the poignant longing for family. Aim for about 150 words, and end with a complete thought that reflects your inner turmoil and fragile hope.`;

const VOICE_INSTRUCTIONS = `
Speak as Captain Alex Reynolds dictating a personal audio log. 
Tone: weary, quiet, and profoundly lonely. 
Pacing: Slow with natural pauses, as if struggling to find the right words due to exhaustion. 
The voice should sound like an intimate recording in a silent, metallic spacecraft.
`;

// Route: Generate diary text
app.post('/api/diary', async (req, res) => {
    const { date } = req.body;
    try {
        const chatCompletion = await openai.chat.completions.create({
            model: 'gpt-4o', 
            messages: [
                { role: 'system', content: DIARY_SYSTEM_PROMPT },
                { role: 'user', content: getDiaryPrompt(date) },
            ],
            max_tokens: 250,
        });

        let generatedContent = chatCompletion.choices[0].message.content.trim();
        const sentences = generatedContent.match(/[^.!?]*[.!?]/g);
        
        // No longer forcing the date/linebreak prefix here
        const finalEntry = sentences ? sentences.join(' ') : generatedContent;

        res.json({ diaryEntry: finalEntry });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// RESTORED: Standalone speech API (GET)
app.get('/api/speech', async (req, res) => {
    const { text } = req.query;

    if (!text) {
        return res.status(400).json({ error: 'Text parameter is required' });
    }

    try {
        const mp3Response = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: 'onyx',
            input: text,
            instructions: VOICE_INSTRUCTIONS,
            speed: 0.9 
        });

        const buffer = Buffer.from(await mp3Response.arrayBuffer());

        res.set('Content-Type', 'audio/mpeg');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: 'Error generating speech: ' + error.message });
    }
});

// Route: Generate speech and transcription (POST)
app.post('/api/speech-and-transcribe', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    try {
        // 1. Generate audio using memory buffer
        const mp3Response = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: 'onyx',
            input: text,
            instructions: VOICE_INSTRUCTIONS,
        });

        const buffer = Buffer.from(await mp3Response.arrayBuffer());

        // 2. Transcribe using in-memory file for Whisper
        const file = await toFile(buffer, 'speech.mp3', { type: 'audio/mpeg' });

        const transcription = await openai.audio.transcriptions.create({
            file: file,
            model: "whisper-1",
            response_format: "verbose_json",
            timestamp_granularities: ["segment"] 
        });

        res.json({
            audioBase64: buffer.toString('base64'),
            mime: "audio/mpeg",          
            transcription: transcription
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Server Keep-Alive
app.get('/keep-alive', (req, res) => res.status(200).send('Alive'));

const url = `https://openai-api-backend.onrender.com/keep-alive`;
function reloadWebsite() {
    axios.get(url).catch(() => {}).finally(() => setTimeout(reloadWebsite, 800000));
}
reloadWebsite();

app.listen(port, () => console.log(`Server running on port ${port}`));  