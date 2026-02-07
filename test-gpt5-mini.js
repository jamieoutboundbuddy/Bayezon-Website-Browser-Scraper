require('dotenv').config();
const { default: OpenAI } = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function testGPT5Mini() {
    console.log('Testing gpt-5-mini API call...\n');
    console.log('API Key present:', !!process.env.OPENAI_API_KEY);
    console.log('API Key length:', process.env.OPENAI_API_KEY?.length || 0);

    try {
        console.log('\nTest 1: Basic call with max_completion_tokens');
        const response1 = await openai.chat.completions.create({
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Say "hello world" and nothing else.' }],
            max_completion_tokens: 50
        });

        console.log('✅ Success!');
        console.log('Response:', response1.choices[0]?.message?.content);
        console.log('Usage:', response1.usage);

    } catch (e) {
        console.error('❌ Test  1 Failed:', e.message);
        console.error('Status:', e.status);
        console.error('Type:', e.type);
    }

    console.log('\n---\n');

    try {
        console.log('Test 2: Call without max_completion_tokens');
        const response2 = await openai.chat.completions.create({
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Say "hello world" and nothing else.' }]
        });

        console.log('✅ Success!');
        console.log('Response:', response2.choices[0]?.message?.content);

    } catch (e) {
        console.error('❌ Test 2 Failed:', e.message);
        console.error('Status:', e.status);
    }

    console.log('\n---\n');

    try {
        console.log('Test 3: Compare with gpt-4o-mini (known working)');
        const response3 = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Say "hello world" and nothing else.' }],
            max_completion_tokens: 50
        });

        console.log('✅ Success!');
        console.log('Response:', response3.choices[0]?.message?.content);
        console.log('Usage:', response3.usage);

    } catch (e) {
        console.error('❌ Test 3 Failed:', e.message);
    }
}

testGPT5Mini().catch(console.error);
