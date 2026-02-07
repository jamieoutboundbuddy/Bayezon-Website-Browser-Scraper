import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function testGPT5Mini() {
    console.log('Testing gpt-5-mini API call...\n');

    try {
        console.log('Test 1: Basic call with max_completion_tokens');
        const response1 = await openai.chat.completions.create({
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Say "hello world" and nothing else.' }],
            max_completion_tokens: 50
        });

        console.log('✅ Success!');
        console.log('Response:', response1.choices[0]?.message?.content);
        console.log('Full response:', JSON.stringify(response1, null, 2));

    } catch (e: any) {
        console.error('❌ Test 1 Failed:', e.message);
        console.error('Error details:', e);
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

    } catch (e: any) {
        console.error('❌ Test 2 Failed:', e.message);
    }

    console.log('\n---\n');

    try {
        console.log('Test 3: Try with temperature');
        const response3 = await openai.chat.completions.create({
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Say "hello world" and nothing else.' }],
            max_completion_tokens: 50,
            temperature: 1
        });

        console.log('✅ Success!');
        console.log('Response:', response3.choices[0]?.message?.content);

    } catch (e: any) {
        console.error('❌ Test 3 Failed:', e.message);
    }

    console.log('\n---\n');

    try {
        console.log('Test 4: Compare with gpt-4o-mini (known working model)');
        const response4 = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Say "hello world" and nothing else.' }],
            max_completion_tokens: 50
        });

        console.log('✅ Success!');
        console.log('Response:', response4.choices[0]?.message?.content);

    } catch (e: any) {
        console.error('❌ Test 4 Failed:', e.message);
    }
}

testGPT5Mini().catch(console.error);
