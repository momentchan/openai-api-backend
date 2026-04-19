import express from 'express';
import OpenAI, { toFile } from 'openai';
import { config } from 'dotenv';
import cors from 'cors';
import axios from 'axios';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ============================
// Cloudflare R2 Setup
// ============================
let s3Client = null;

// Initialize S3 Client if credentials exist
if (process.env.CF_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
    s3Client = new S3Client({
        region: "auto",
        endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });
}

// Upload audio buffer to R2 and return the public URL
async function uploadAudioToR2(buffer, dateStr) {
    if (!s3Client || !process.env.R2_BUCKET_NAME) return null;

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const time = `${now.getHours()}-${now.getMinutes()}`;
    
    // Short ID to prevent filename collisions
    const shortId = Date.now().toString().slice(-4); 
    const fileName = `diaries/${year}/${month}/${year}-${month}-${day}_${time}_${shortId}.mp3`;

    const command = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileName,
        Body: buffer,
        ContentType: "audio/mpeg",
    });

    await s3Client.send(command);

    const publicDomain = process.env.R2_PUBLIC_DOMAIN || "";
    return publicDomain ? `${publicDomain}/${fileName}` : null;
}

// ============================
// Cloudflare D1 Setup
// ============================

// Save the complete log entry to Cloudflare D1 via REST API
async function saveEntryToD1(date, content, audioUrl, transcriptionData) {
    if (!process.env.CF_ACCOUNT_ID || !process.env.D1_DATABASE_ID || !process.env.CF_API_TOKEN) {
        console.error("D1 credentials missing. Skipping database insert.");
        return;
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/d1/database/${process.env.D1_DATABASE_ID}/query`;
    const transcriptionString = JSON.stringify(transcriptionData);

    try {
        await axios.post(url, {
            sql: "INSERT INTO entries (entry_date, text_content, audio_url, transcription_json) VALUES (?, ?, ?, ?)",
            params: [date, content, audioUrl, transcriptionString]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.CF_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`Successfully saved entry for ${date} to D1 database.`);
    } catch (error) {
        console.error("D1 Database insert failed:", error.response?.data || error.message);
    }
}

// ============================
// Persona and Prompts
// ============================
const DIARY_SYSTEM_PROMPT = 'You are an astronaut lost in space, writing daily diary entries.';

const getDiaryPrompt = (date) => `You are Captain Alex Reynolds, once an astronaut brimming with ambition and dreams of groundbreaking discoveries in the far reaches of space. Driven by a desire to push the boundaries of human exploration, you embarked on this mission hoping to make a lasting impact. But now, months have passed, and those grand aspirations have faded into the harsh reality of isolation. Stranded in the vast expanse of space with no hope of returning to Earth, you spend your days reflecting on how your once-bright future has unraveled into a solitary existence. Today is ${date}. As you float alone in your spacecraft, you ponder how the days have turned into weeks and then into months. You reflect on the crushing disappointment of failure and the ever-present loneliness, missing your family, friends, and the simple comforts of Earth. Describe your day in detail, including any small triumphs or struggles you faced. Emphasize the deep sense of isolation and longing, tempered by a lingering hope that something might change. Your entry should capture the weight of your emotional journey—from once seeking greatness to now just trying to endure the passage of time. Ensure your writing remains consistent with previous entries, conveying the ongoing battle between despair and resilience, and the poignant longing for family. Aim for about 150 words, and end with a complete thought that reflects your inner turmoil and fragile hope.`;

const VOICE_INSTRUCTIONS = `
Speak as Captain Alex Reynolds dictating a personal audio log. 
Tone: weary, quiet, and profoundly lonely. 
Pacing: Slow with natural pauses, as if struggling to find the right words due to exhaustion. 
The voice should sound like an intimate recording in a silent, metallic spacecraft.
`;

// ============================
// Routes
// ============================

// Generate diary text
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
        const finalEntry = sentences ? sentences.join(' ') : generatedContent;

        res.json({ diaryEntry: finalEntry });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Standalone speech API
app.get('/api/speech', async (req, res) => {
    const { text } = req.query;
    if (!text) return res.status(400).json({ error: 'Text parameter is required' });

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

// Master Pipeline: Generate speech -> Transcribe -> Upload to R2 -> Save to D1
app.post('/api/speech-and-transcribe', async (req, res) => {
    const { text, date } = req.body; 
    if (!text) return res.status(400).json({ error: 'Text required' });

    try {
        // Step 1: Generate audio using memory buffer
        const mp3Response = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: 'onyx',
            input: text,
            instructions: VOICE_INSTRUCTIONS,
        });

        const buffer = Buffer.from(await mp3Response.arrayBuffer());

        // Step 2: Transcribe using in-memory file for Whisper
        const file = await toFile(buffer, 'speech.mp3', { type: 'audio/mpeg' });
        const transcription = await openai.audio.transcriptions.create({
            file: file,
            model: "whisper-1",
            response_format: "verbose_json",
            timestamp_granularities: ["segment"] 
        });

        // Step 3: Upload to Cloudflare R2
        let publicAudioUrl = null;
        const uploadDate = date || new Date().toISOString().split('T')[0];
        
        try {
            publicAudioUrl = await uploadAudioToR2(buffer, uploadDate);
            if (publicAudioUrl) console.log(`Audio successfully uploaded to: ${publicAudioUrl}`);
        } catch (r2Error) {
            console.error("Cloudflare R2 Upload Failed:", r2Error.message);
        }

        // Step 4: Save metadata to Cloudflare D1
        if (publicAudioUrl) {
            await saveEntryToD1(uploadDate, text, publicAudioUrl, transcription);
        }

        // Step 5: Send final data to frontend
        res.json({
            audioBase64: buffer.toString('base64'), // Keeping this for backward compatibility during transitions
            mime: "audio/mpeg",          
            transcription: transcription,
            audioUrl: publicAudioUrl 
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