// PERSONAL ASSISTANT BOT
// A private Slack bot for personal productivity: Tasks, Reminders, Vault, Habits, and Parking Lot

import http from 'node:http';
import pkg from '@slack/bolt';
import { config } from 'dotenv';
import admin from 'firebase-admin';

config();

// Health check for hosting
http.createServer((_req, res) => {
    res.writeHead(200);
    res.end('Personal Assistant is online.');
}).listen(process.env.PORT || 10001);

const { App, LogLevel } = pkg;

// ==========================================
// FIREBASE ADMIN SETUP
// ==========================================
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
    console.error('❌ Firebase Admin credentials missing. Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY to .env');
    process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const appId = process.env.__app_id || 'personal-bot-default';

// ==========================================
// FIRESTORE COLLECTION HELPERS
// ==========================================
const getCol = (userId, type) => db.collection('artifacts').doc(appId).collection('users').doc(userId).collection(type);
const getTasksCol = (userId) => getCol(userId, 'tasks');
const getLogsCol = (userId) => getCol(userId, 'logs');
const getVaultCol = (userId) => getCol(userId, 'vault');
const getHabitsCol = (userId) => getCol(userId, 'habits');
const getParkingLotCol = (userId) => getCol(userId, 'parking_lot');

// ==========================================
// SLACK APP CONFIGURATION
// ==========================================
if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
    console.error('❌ Slack tokens not set. Configure SLACK_BOT_TOKEN and SLACK_APP_TOKEN in .env');
    process.exit(1);
}

const slackApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
    logLevel: LogLevel.INFO,
});

// ==========================================
// 1. PRODUCTIVITY: FOCUS TIMER
// ==========================================

slackApp.command('/focus', async ({ command, ack, client }) => {
    await ack();
    const parts = command.text.split(' ');
    const minutes = parseInt(parts[0]);
    const task = parts.slice(1).join(' ') || "Deep Work";

    if (isNaN(minutes)) {
        return await client.chat.postEphemeral({
            channel: command.channel_id,
            user: command.user_id,
            text: "Usage: `/focus [minutes] [task]`"
        });
    }

    await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: `⏳ Focus timer set for *${minutes}m*: _${task}_.`
    });

    setTimeout(async () => {
        try {
            await client.chat.postMessage({
                channel: command.user_id,
                text: `🔔 *Time's up!* Focus session over: *${task}*`,
                blocks: [
                    { type: "section", text: { type: "mrkdwn", text: `🔔 *Time's up!* Focus session over: *${task}*` } },
                    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Log as Done" }, action_id: "log_focus_done", value: task }] }
                ]
            });
        } catch (e) {
            console.error('❌ Focus timer notification error:', e);
        }
    }, minutes * 60000);
});

// ==========================================
// 2. INFORMATION VAULT, HABITS & PARKING LOT
// ==========================================

slackApp.command('/save', async ({ command, ack, client }) => {
    await ack();
    const parts = command.text.split(' ');
    const content = parts[0];
    const tags = parts.slice(1).join(' ') || "general";
    if (!content) {
        return await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "Usage: `/save [content] [tags...]`" });
    }
    try {
        await getVaultCol(command.user_id).add({ content, tags, timestamp: Date.now() });
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: `📥 Saved: *${tags}*` });
    } catch (e) {
        console.error('❌ /save error:', e);
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "Error saving to vault." });
    }
});

slackApp.command('/find', async ({ command, ack, client }) => {
    await ack();
    const searchTag = command.text.toLowerCase();
    try {
        const snapshot = await getVaultCol(command.user_id).get();
        const results = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.tags.toLowerCase().includes(searchTag)) results.push(data.content);
        });
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: results.length ? `*Results:*\n${results.join('\n')}` : "None found." });
    } catch (e) {
        console.error('❌ /find error:', e);
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "Error searching vault." });
    }
});

slackApp.command('/habit', async ({ command, ack, client }) => {
    await ack();
    if (!command.text) {
        return await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "Usage: `/habit [habit name]`" });
    }
    try {
        await getHabitsCol(command.user_id).add({ habit: command.text.trim(), date: new Date().toISOString().split('T')[0] });
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: `✅ Logged: *${command.text}*` });
    } catch (e) {
        console.error('❌ /habit error:', e);
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "Error logging habit." });
    }
});

slackApp.command('/park', async ({ command, ack, client }) => {
    await ack();
    if (!command.text) {
        return await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "Usage: `/park [idea]`" });
    }
    try {
        await getParkingLotCol(command.user_id).add({ idea: command.text, timestamp: Date.now() });
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "🚗 Idea parked." });
    } catch (e) {
        console.error('❌ /park error:', e);
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "Error parking idea." });
    }
});

slackApp.command('/review', async ({ command, ack, client }) => {
    await ack();
    try {
        const snapshot = await getParkingLotCol(command.user_id).get();
        const blocks = [{ type: "header", text: { type: "plain_text", text: "🅿️ Parking Lot" } }];
        snapshot.forEach(docSnap => {
            blocks.push({
                type: "section",
                text: { type: "mrkdwn", text: `• ${docSnap.data().idea}` },
                accessory: { type: "button", text: { type: "plain_text", text: "To Task" }, action_id: "park_to_task", value: JSON.stringify({ id: docSnap.id, idea: docSnap.data().idea }) }
            });
        });
        if (blocks.length === 1) blocks.push({ type: "section", text: { type: "mrkdwn", text: "No parked ideas." } });
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, blocks });
    } catch (e) {
        console.error('❌ /review error:', e);
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "Error loading parking lot." });
    }
});

// ==========================================
// 3. CORE TASKS & REMINDERS
// ==========================================

slackApp.command('/task', async ({ command, ack, client }) => {
    await ack();
    if (!command.text) {
        return await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "Usage: `/task [description]`" });
    }
    try {
        await getTasksCol(command.user_id).add({ text: command.text, createdAt: Date.now(), status: 'active' });
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: `📌 Task added.` });
    } catch (e) {
        console.error('❌ /task error:', e);
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "Error creating task." });
    }
});

slackApp.command('/tasks', async ({ command, ack, client }) => {
    await ack();
    try {
        const snapshot = await getTasksCol(command.user_id).get();
        const blocks = [{ type: "header", text: { type: "plain_text", text: "📋 Active Tasks" } }];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.status === 'active') {
                blocks.push({
                    type: "section",
                    text: { type: "mrkdwn", text: `• ${data.text}` },
                    accessory: { type: "button", text: { type: "plain_text", text: "Done" }, action_id: "complete_task", value: JSON.stringify({ id: docSnap.id, text: data.text }), style: "primary" }
                });
            }
        });
        if (blocks.length === 1) blocks.push({ type: "section", text: { type: "mrkdwn", text: "No active tasks." } });
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, blocks });
    } catch (e) {
        console.error('❌ /tasks error:', e);
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "Error loading tasks." });
    }
});

// ==========================================
// ACTION & VIEW HANDLERS
// ==========================================

slackApp.action('complete_task', async ({ ack, body, action, client }) => {
    await ack();
    try {
        const { id, text } = JSON.parse(action.value);
        await getTasksCol(body.user.id).doc(id).delete();
        await getLogsCol(body.user.id).add({ text: `✅ Done: ${text}`, timestamp: Date.now() });
        await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: `✅ Archived: ${text}` });
    } catch (e) {
        console.error('❌ complete_task error:', e);
        await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "Error completing task." });
    }
});

slackApp.action('log_focus_done', async ({ ack, body, action, client }) => {
    await ack();
    try {
        await getLogsCol(body.user.id).add({
            text: `Completed Focus Session: ${action.value}`,
            timestamp: Date.now()
        });
        await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "✅ Focus session logged." });
    } catch (e) {
        console.error('❌ log_focus_done error:', e);
        await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "Error logging focus session." });
    }
});

slackApp.action('park_to_task', async ({ ack, body, action, client }) => {
    await ack();
    try {
        const { id, idea } = JSON.parse(action.value);
        await getParkingLotCol(body.user.id).doc(id).delete();
        await getTasksCol(body.user.id).add({ text: idea, createdAt: Date.now(), status: 'active' });
        await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: `🚀 Moved to Tasks!` });
    } catch (e) {
        console.error('❌ park_to_task error:', e);
        await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "Error moving idea to tasks." });
    }
});

// ==========================================
// STARTUP
// ==========================================
(async () => {
    try {
        await slackApp.start();
        console.log('✅ Personal Assistant Bot is online');
        console.log('📋 Available commands: /focus, /task, /tasks, /save, /find, /habit, /park, /review');
    } catch (err) {
        console.error('❌ Failed to start bot:', err);
        process.exit(1);
    }
})();
