import OpenAI from "openai"
import { config } from "dotenv"
import express from 'express';

config()

const openai = new OpenAI({
    apiKey: process.env.API_KEY
})

const app = express();
const port = process.env.PORT || 3000;

async function generateAstronautDiary(date) {
    const prompt = `You are Captain Alex Reynolds, an astronaut who has been lost in the vast expanse of space for several months. With no hope of returning to Earth, you find solace in your daily diary entries. Today is ${date}, and as you float alone in your spacecraft, you reflect on the countless days you’ve spent away from your loved ones. Describe your day in detail, including any small triumphs or struggles you faced. Emphasize the sense of isolation and longing you feel, missing your family, friends, and the simple comforts of Earth. Your entry should convey the emotional weight of your situation, revealing how you cope with loneliness and the passage of time. Ensure that your writing is consistent with your previous entries, capturing the ongoing challenges and the hope that sustains you. Aim for about 200 words and end with a complete thought that leaves a lasting impression of your emotional state.`;

    try {
        const chatCompletion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                { role: "system", content: "You are an astronaut lost in space, writing daily diary entries." },
                { role: "user", content: prompt },
            ],
            max_tokens: 200,  // Increased token limit for flexibility
        });

        let entry = chatCompletion.choices[0].message.content.trim();

        // Truncate to the last complete sentence
        const lastCompleteSentence = entry.match(/[^.!?]*[.!?]/g)?.slice(0, -1).join(' ') || entry;

        console.log(lastCompleteSentence);
        return lastCompleteSentence;

    } catch (error) {
        console.error('Error generating diary entry:', error);
        throw new Error('Failed to generate diary entry');
    }
}

app.get('/diary', async (req, res) => {
    const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    try {
        const diaryEntry = await generateAstronautDiary(currentDate);
        res.json({ diaryEntry });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});