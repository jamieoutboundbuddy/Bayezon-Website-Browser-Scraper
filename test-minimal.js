require('dotenv').config();
const { default: OpenAI } = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function test() {
    console.log('Testing exact config from aiAgent.ts...\n');

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Generate a short search query for fashion shoes. Just respond with the query text, nothing else.' }],
            max_completion_tokens: 150
        });

        console.log('✅ Success!');
        console.log('Content:', response.choices[0]?.message?.content);
        console.log('Content length:', response.choices[0]?.message?.content?.length || 0);
        console.log('\nFull response:');
        console.log(JSON.stringify(response, null, 2));

    } catch (e) {
        console.error('❌ Failed:', e.message);
        console.error('Status:', e.status);
        console.error('Error type:', e.type);
        console.error('\nFull error:', e);
    }
}

test().catch(console.error);
