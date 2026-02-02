// PERSONAL ASSISTANT BOT (RESTRUCTURED WITH MODALS, REMINDERS & DELETION)
import http from 'node:http';
import pkg from '@slack/bolt';
import { config } from 'dotenv';
import admin from 'firebase-admin';
import cron from 'node-cron';

config();

// Health check
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

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const appId = process.env.__app_id || 'personal-bot-default';

// Helpers
const getCol = (userId, type) => db.collection('artifacts').doc(appId).collection('users').doc(userId).collection(type);

// ==========================================
// SLACK APP CONFIGURATION
// ==========================================
const slackApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
    logLevel: LogLevel.INFO,
});

// ==========================================
// 1. REMINDERS ENGINE (CRON)
// ==========================================
cron.schedule('* * * * *', async () => {
    const now = new Date();
    const currentDay = now.toLocaleString('en-us', { weekday: 'long' });
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    try {
        const usersSnapshot = await db.collection('artifacts').doc(appId).collection('users').get();
        for (const userDoc of usersSnapshot.docs) {
            const reminders = await userDoc.ref.collection('reminders').get();
            reminders.forEach(async (rem) => {
                const data = rem.data();
                const shouldFire = (data.frequency === 'daily' && data.time === currentTime) ||
                                   (data.frequency === 'weekly' && data.day === currentDay && data.time === currentTime);

                if (shouldFire) {
                    await slackApp.client.chat.postMessage({
                        channel: userDoc.id,
                        text: `⏰ *Reminder:* ${data.text}`
                    });
                }
            });
        }
    } catch (e) {
        console.error('Cron Error:', e);
    }
});

// ==========================================
// 2. MODAL CONSTRUCTORS
// ==========================================

const openReminderModal = (client, trigger_id) => {
    return client.views.open({
        trigger_id,
        view: {
            type: "modal",
            callback_id: "setup_reminder_view",
            title: { type: "plain_text", text: "Set Reminder" },
            blocks: [
                {
                    type: "input",
                    block_id: "task_block",
                    element: { type: "plain_text_input", action_id: "text" },
                    label: { type: "plain_text", text: "Reminder Text" }
                },
                {
                    type: "input",
                    block_id: "freq_block",
                    element: {
                        type: "static_select",
                        action_id: "frequency",
                        options: [
                            { text: { type: "plain_text", text: "Daily" }, value: "daily" },
                            { text: { type: "plain_text", text: "Weekly" }, value: "weekly" }
                        ]
                    },
                    label: { type: "plain_text", text: "Frequency" }
                },
                {
                    type: "input",
                    block_id: "day_block",
                    optional: true,
                    element: {
                        type: "static_select",
                        action_id: "day",
                        options: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(d => ({
                            text: { type: "plain_text", text: d }, value: d
                        }))
                    },
                    label: { type: "plain_text", text: "Day (for Weekly)" }
                },
                {
                    type: "input",
                    block_id: "time_block",
                    element: { type: "plain_text_input", action_id: "time", placeholder: "HH:MM (e.g. 09:30)" },
                    label: { type: "plain_text", text: "Time" }
                }
            ],
            submit: { type: "plain_text", text: "Schedule" }
        }
    });
};

// ==========================================
// 3. COMMANDS (TASK & REMINDER MANAGEMENT)
// ==========================================

// Add Task (Modal)
slackApp.command('/task', async ({ command, ack, client }) => {
    await ack();
    await client.views.open({
        trigger_id: command.trigger_id,
        view: {
            type: "modal",
            callback_id: "add_task_view",
            title: { type: "plain_text", text: "New Task" },
            blocks: [
                {
                    type: "input",
                    block_id: "task_input",
                    element: { type: "plain_text_input", action_id: "text_val" },
                    label: { type: "plain_text", text: "Task Description" }
                }
            ],
            submit: { type: "plain_text", text: "Add" }
        }
    });
});

// View Tasks (With Delete/Done)
slackApp.command('/tasks', async ({ command, ack, client }) => {
    await ack();
    const snapshot = await getCol(command.user_id, 'tasks').get();
    const blocks = [{ type: "header", text: { type: "plain_text", text: "📋 Your Active Tasks" } }];

    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `• ${data.text}` },
            accessory: {
                type: "button",
                text: { type: "plain_text", text: "Done" },
                style: "primary",
                action_id: "remove_item",
                value: JSON.stringify({ col: 'tasks', id: docSnap.id, label: data.text })
            }
        });
    });

    if (blocks.length === 1) blocks.push({ type: "section", text: { type: "mrkdwn", text: "_No active tasks._" } });
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, blocks });
});

// Add Reminder (Modal)
slackApp.command('/remind', async ({ command, ack, client }) => {
    await ack();
    await openReminderModal(client, command.trigger_id);
});

// View Reminders (With Delete)
slackApp.command('/reminders', async ({ command, ack, client }) => {
    await ack();
    const snapshot = await getCol(command.user_id, 'reminders').get();
    const blocks = [{ type: "header", text: { type: "plain_text", text: "⏰ Scheduled Reminders" } }];

    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const sched = data.frequency === 'weekly' ? `${data.day} at ${data.time}` : `Daily at ${data.time}`;
        blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `*${data.text}*\n_${sched}_` },
            accessory: {
                type: "button",
                text: { type: "plain_text", text: "Delete" },
                style: "danger",
                action_id: "remove_item",
                value: JSON.stringify({ col: 'reminders', id: docSnap.id, label: data.text })
            }
        });
    });

    if (blocks.length === 1) blocks.push({ type: "section", text: { type: "mrkdwn", text: "_No reminders set._" } });
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, blocks });
});

// ==========================================
// 4. VIEW & ACTION HANDLERS
// ==========================================

// Handle Modal Submissions
slackApp.view('add_task_view', async ({ ack, body, view, client }) => {
    await ack();
    const text = view.state.values.task_input.text_val.value;
    await getCol(body.user.id, 'tasks').add({ text, createdAt: Date.now(), status: 'active' });
});

slackApp.view('setup_reminder_view', async ({ ack, body, view, client }) => {
    await ack();
    const v = view.state.values;
    const reminder = {
        text: v.task_block.text.value,
        frequency: v.freq_block.frequency.selected_option.value,
        day: v.day_block.day.selected_option?.value || null,
        time: v.time_block.time.value
    };
    await getCol(body.user.id, 'reminders').add(reminder);
});

// Universal Remove Action (Works for Tasks and Reminders)
slackApp.action('remove_item', async ({ ack, body, action, client }) => {
    await ack();
    const { col, id, label } = JSON.parse(action.value);
    try {
        await getCol(body.user.id, col).doc(id).delete();
        await client.chat.postEphemeral({
            channel: body.channel.id,
            user: body.user.id,
            text: `🗑 Removed: *${label}*`
        });
    } catch (e) {
        console.error(e);
    }
});

(async () => {
    await slackApp.start();
    console.log('✅ Assistant Online: Commands /task, /tasks, /remind, /reminders available.');
})();