// PERSONAL ASSISTANT BOT
// A private Slack bot for personal productivity: Tasks, Reminders, Vault, Habits, and Parking Lot

import http from 'node:http';
import pkg from '@slack/bolt';
import { config } from 'dotenv';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { 
    getFirestore, 
    collection, 
    doc, 
    addDoc, 
    getDocs, 
    deleteDoc, 
    updateDoc,
    query, 
    orderBy,
    limit 
} from 'firebase/firestore';

// Health check for hosting
http.createServer((_req, res) => {
    res.writeHead(200);
    res.end('Personal Assistant is online.');
}).listen(process.env.PORT || 10001);

const { App, LogLevel } = pkg;
config();

// ==========================================
// FIREBASE SETUP
// ==========================================
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};
if (!firebaseConfig.projectId) {
    console.error('❌ Firebase config not set. Please configure .env file with Firebase credentials.');
    process.exit(1);
}

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const appId = process.env.__app_id || 'personal-bot-default';

const initAuth = async () => {
    try {
        if (process.env.__initial_auth_token) {
            await signInWithCustomToken(auth, process.env.__initial_auth_token);
        } else {
            await signInAnonymously(auth);
        }
        console.log('✅ Firebase auth initialized');
    } catch (err) {
        console.error("❌ Auth failed:", err);
        process.exit(1);
    }
};

// Slack App Configuration
if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
    console.error('❌ Slack tokens not set. Please configure SLACK_BOT_TOKEN and SLACK_APP_TOKEN in .env');
    process.exit(1);
}

const slackApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
    logLevel: LogLevel.INFO,
});

await initAuth();

// Helper for Firestore Paths (Rule 1: Private User Data)
const getRemindersCol = (userId) => collection(db, 'artifacts', appId, 'users', userId, 'reminders');
const getLogsCol = (userId) => collection(db, 'artifacts', appId, 'users', userId, 'logs');
const getTasksCol = (userId) => collection(db, 'artifacts', appId, 'users', userId, 'tasks');
const getVaultCol = (userId) => collection(db, 'artifacts', appId, 'users', userId, 'vault');
const getHabitsCol = (userId) => collection(db, 'artifacts', appId, 'users', userId, 'habits');
const getParkingLotCol = (userId) => collection(db, 'artifacts', appId, 'users', userId, 'parking_lot');

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
        } catch (e) { console.error(e); }
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
    if (!content || !auth.currentUser) return;
    await addDoc(getVaultCol(command.user_id), { content, tags, timestamp: Date.now() });
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: `📥 Vaulted: *${tags}*` });
});

slackApp.command('/find', async ({ command, ack, client }) => {
    await ack();
    if (!auth.currentUser) return;
    const searchTag = command.text.toLowerCase();
    const snapshot = await getDocs(getVaultCol(command.user_id));
    const results = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.tags.toLowerCase().includes(searchTag)) results.push(data.content);
    });
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: results.length ? `*Results:*\n${results.join('\n')}` : "None found." });
});

slackApp.command('/habit', async ({ command, ack, client }) => {
    await ack();
    if (!command.text || !auth.currentUser) return;
    await addDoc(getHabitsCol(command.user_id), { habit: command.text.trim(), date: new Date().toISOString().split('T')[0] });
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: `✅ Habit: *${command.text}*` });
});

slackApp.command('/park', async ({ command, ack, client }) => {
    await ack();
    if (!command.text || !auth.currentUser) return;
    await addDoc(getParkingLotCol(command.user_id), { idea: command.text, timestamp: Date.now() });
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "🚗 Idea parked." });
});

slackApp.command('/review', async ({ command, ack, client }) => {
    await ack();
    if (!auth.currentUser) return;
    const snapshot = await getDocs(getParkingLotCol(command.user_id));
    const blocks = [{ type: "header", text: { type: "plain_text", text: "🅿️ Parking Lot" } }];
    snapshot.forEach(docSnap => {
        blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `• ${docSnap.data().idea}` },
            accessory: { type: "button", text: { type: "plain_text", text: "To Task" }, action_id: "park_to_task", value: JSON.stringify({ id: docSnap.id, idea: docSnap.data().idea }) }
        });
    });
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, blocks });
});

// ==========================================
// 3. CORE TASKS & REMINDERS
// ==========================================

slackApp.command('/task', async ({ command, ack, client }) => {
    await ack();
    if (!command.text || !auth.currentUser) return;
    await addDoc(getTasksCol(command.user_id), { text: command.text, createdAt: Date.now(), status: 'active' });
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: `📌 Task set.` });
});

slackApp.command('/tasks', async ({ command, ack, client }) => {
    await ack();
    if (!auth.currentUser) return;
    const snapshot = await getDocs(getTasksCol(command.user_id));
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
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, blocks });
});

// ==========================================
// ACTION & VIEW HANDLERS
// ==========================================

slackApp.action('complete_task', async ({ ack, body, action, client }) => {
    await ack();
    if (!auth.currentUser) return;
    const { id, text } = JSON.parse(action.value);
    await deleteDoc(doc(db, 'artifacts', appId, 'users', body.user.id, 'tasks', id));
    await addDoc(getLogsCol(body.user.id), { text: `✅ Done: ${text}`, timestamp: Date.now() });
    await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: `Archived: ${text}` });
});

slackApp.action('log_focus_done', async ({ ack, body, action, client }) => {
    await ack();
    if (!auth.currentUser) return;
    await addDoc(getLogsCol(body.user.id), {
        text: `Completed Focus Session: ${action.value}`,
        timestamp: Date.now()
    });
    await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "✅ Focus session logged." });
});

slackApp.action('park_to_task', async ({ ack, body, action, client }) => {
    await ack();
    if (!auth.currentUser) return;
    const { id, idea } = JSON.parse(action.value);
    await deleteDoc(doc(db, 'artifacts', appId, 'users', body.user.id, 'parking_lot', id));
    await addDoc(getTasksCol(body.user.id), { text: idea, createdAt: Date.now(), status: 'active' });
    await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: `🚀 Idea moved to Tasks!` });
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