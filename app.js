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

// Helper for Strict Paths
const getUserCol = (userId, type) => 
    db.collection('artifacts').doc(appId).collection('users').doc(userId).collection(type);

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
// 1. TIMEZONE-AWARE REMINDERS ENGINE
// ==========================================
cron.schedule('* * * * *', async () => {
    try {
        const usersSnapshot = await db.collection('artifacts').doc(appId).collection('users').get();
        for (const userDoc of usersSnapshot.docs) {
            const userData = userDoc.data();
            const userTz = userData.timezone || 'UTC';
            
            const now = new Date();
            const userTimeString = now.toLocaleTimeString('en-GB', { 
                timeZone: userTz, hour: '2-digit', minute: '2-digit', hour12: false 
            });
            const userDay = now.toLocaleDateString('en-US', { timeZone: userTz, weekday: 'long' });

            const reminders = await userDoc.ref.collection('reminders').get();
            reminders.forEach(async (rem) => {
                const data = rem.data();
                const shouldFire = (data.frequency === 'daily' && data.time === userTimeString) ||
                                   (data.frequency === 'weekly' && data.day === userDay && data.time === userTimeString);

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
// 2. CORE COMMANDS (TASKS & REMINDERS)
// ==========================================

slackApp.command('/help', async ({ command, ack, client }) => {
    await ack();
    await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: "*Personal Assistant Commands:*\n" +
              "• `/task` - Add task (Modal with Priorities)\n" +
              "• `/tasks` - View/Done active tasks\n" +
              "• `/reminds` - Set timezone-aware reminders\n" +
              "• `/reminders` - View/Delete reminders\n" +
              "• `/save [content] [tags]` - Save info to vault\n" +
              "• `/find [tag]` - Search vault\n" +
              "• `/habit [name]` - Log daily habit\n" +
              "• `/park [idea]` - Note an idea\n" +
              "• `/review` - View ideas\n" +
              "• `/focus [min] [task]` - Pomodoro timer"
    });
});

slackApp.command('/task', async ({ command, ack, client }) => {
    await ack();
    try {
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
                    },
                    {
                        type: "input",
                        block_id: "priority_input",
                        element: {
                            type: "static_select",
                            action_id: "priority_val",
                            initial_option: { text: { type: "plain_text", text: "Medium" }, value: "medium" },
                            options: [
                                { text: { type: "plain_text", text: "🔴 High" }, value: "high" },
                                { text: { type: "plain_text", text: "🟡 Medium" }, value: "medium" },
                                { text: { type: "plain_text", text: "🔵 Low" }, value: "low" }
                            ]
                        },
                        label: { type: "plain_text", text: "Priority" }
                    }
                ],
                submit: { type: "plain_text", text: "Add" }
            }
        });
    } catch (error) {
        console.error("Task Modal Error:", error);
    }
});

slackApp.command('/tasks', async ({ command, ack, client }) => {
    await ack();
    const snapshot = await getUserCol(command.user_id, 'tasks').get();
    const priorityWeight = { high: 1, medium: 2, low: 3 };
    const tasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (priorityWeight[a.priority] || 2) - (priorityWeight[b.priority] || 2));

    const blocks = [{ type: "header", text: { type: "plain_text", text: "📋 Your Tasks" } }];
    tasks.forEach(t => {
        const emoji = t.priority === 'high' ? '🔴' : (t.priority === 'low' ? '🔵' : '🟡');
        blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `${emoji} *${t.text}*` },
            accessory: {
                type: "button",
                text: { type: "plain_text", text: "Done" },
                action_id: "remove_item",
                value: JSON.stringify({ col: 'tasks', id: t.id, label: t.text })
            }
        });
    });
    if (tasks.length === 0) blocks.push({ type: "section", text: { type: "mrkdwn", text: "_No active tasks._" } });
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, blocks });
});

slackApp.command('/reminds', async ({ command, ack, client }) => {
    // 1. Immediately acknowledge the command to prevent "dispatch_failed"
    await ack();

    try {
        // 2. Fetch User Timezone if missing (done after ack to stay within 3s limit)
        const userDocRef = db.collection('artifacts').doc(appId).collection('users').doc(command.user_id);
        const userDoc = await userDocRef.get();
        
        if (!userDoc.exists || !userDoc.data().timezone) {
            const userInfo = await client.users.info({ user: command.user_id });
            if (userInfo.ok) {
                await userDocRef.set({
                    timezone: userInfo.user.tz || 'UTC'
                }, { merge: true });
            }
        }

        // 3. Open Modal
        await client.views.open({
            trigger_id: command.trigger_id,
            view: {
                type: "modal",
                callback_id: "setup_reminder_view",
                title: { type: "plain_text", text: "Set Reminder" },
                blocks: [
                    { type: "input", block_id: "text_block", element: { type: "plain_text_input", action_id: "text" }, label: { type: "plain_text", text: "Reminder" } },
                    { type: "input", block_id: "freq_block", element: { type: "static_select", action_id: "frequency", options: [{ text: { type: "plain_text", text: "Daily" }, value: "daily" }, { text: { type: "plain_text", text: "Weekly" }, value: "weekly" }] }, label: { type: "plain_text", text: "Frequency" } },
                    { type: "input", block_id: "time_block", element: { type: "timepicker", action_id: "time" }, label: { type: "plain_text", text: "Time" } },
                    { type: "input", block_id: "day_block", optional: true, element: { type: "static_select", action_id: "day", options: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(d => ({ text: { type: "plain_text", text: d }, value: d })) }, label: { type: "plain_text", text: "Day (Weekly)" } }
                ],
                submit: { type: "plain_text", text: "Schedule" }
            }
        });
    } catch (error) {
        console.error("Remind Error:", error);
        await client.chat.postEphemeral({
            channel: command.channel_id,
            user: command.user_id,
            text: "⚠️ Sorry, I couldn't open the reminder setup. Please try again."
        });
    }
});

slackApp.command('/reminders', async ({ command, ack, client }) => {
    await ack();
    try {
        const snapshot = await getUserCol(command.user_id, 'reminders').get();
        const blocks = [{ type: "header", text: { type: "plain_text", text: "⏰ Scheduled Reminders" } }];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const sched = data.frequency === 'weekly' ? `${data.day} at ${data.time}` : `Daily at ${data.time}`;
            blocks.push({
                type: "section",
                text: { type: "mrkdwn", text: `*${data.text}*\n_${sched}_` },
                accessory: { type: "button", text: { type: "plain_text", text: "Delete" }, style: "danger", action_id: "remove_item", value: JSON.stringify({ col: 'reminders', id: docSnap.id, label: data.text }) }
            });
        });
        if (snapshot.empty) blocks.push({ type: "section", text: { type: "mrkdwn", text: "_No reminders set._" } });
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, blocks });
    } catch (error) {
        console.error("Reminders Error:", error);
        await client.chat.postEphemeral({
            channel: command.channel_id,
            user: command.user_id,
            text: "⚠️ Sorry, I couldn't fetch your reminders. Please try again."
        });
    }
});

// ==========================================
// 3. VAULT, HABITS & IDEAS
// ==========================================

slackApp.command('/save', async ({ command, ack, client }) => {
    await ack();
    const parts = command.text.split(' ');
    const tags = parts.filter(p => p.startsWith('#'));
    const content = parts.filter(p => !p.startsWith('#')).join(' ');
    if (!content) return client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "Format: `/save [content] #tag1 #tag2`" });
    await getUserCol(command.user_id, 'vault').add({ content, tags, createdAt: Date.now() });
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: `✅ Saved to vault with tags: ${tags.join(', ') || 'none'}` });
});

slackApp.command('/find', async ({ command, ack, client }) => {
    await ack();
    const tag = command.text.trim();
    const snapshot = await getUserCol(command.user_id, 'vault').get();
    const results = snapshot.docs.map(d => d.data()).filter(d => tag ? d.tags.includes(tag) : true);
    let text = results.length ? `🔍 *Vault Results (${tag || 'all'}):*\n` + results.map(r => `• ${r.content}`).join('\n') : "_No matching items found._";
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text });
});

slackApp.command('/habit', async ({ command, ack, client }) => {
    await ack();
    const name = command.text.trim();
    if (!name) return client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "Usage: `/habit [habit name]`" });
    await getUserCol(command.user_id, 'habits').add({ name, date: new Date().toISOString().split('T')[0] });
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: `💪 Habit logged: *${name}*` });
});

slackApp.command('/park', async ({ command, ack, client }) => {
    await ack();
    if (!command.text) return client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "Usage: `/park [your idea]`" });
    await getUserCol(command.user_id, 'parking_lot').add({ idea: command.text, createdAt: Date.now() });
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "💡 Idea parked for later review." });
});

slackApp.command('/review', async ({ command, ack, client }) => {
    await ack();
    const snapshot = await getUserCol(command.user_id, 'parking_lot').get();
    const blocks = [{ type: "header", text: { type: "plain_text", text: "💡 Ideas Parking Lot" } }];
    snapshot.forEach(docSnap => {
        blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `• ${docSnap.data().idea}` },
            accessory: { type: "button", text: { type: "plain_text", text: "Clear" }, action_id: "remove_item", value: JSON.stringify({ col: 'parking_lot', id: docSnap.id, label: 'Idea' }) }
        });
    });
    if (snapshot.empty) blocks.push({ type: "section", text: { type: "mrkdwn", text: "_The parking lot is empty._" } });
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, blocks });
});

slackApp.command('/focus', async ({ command, ack, client }) => {
    await ack();
    const [minStr, ...taskParts] = command.text.split(' ');
    const mins = parseInt(minStr) || 25;
    const task = taskParts.join(' ') || 'Deep Work';
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: `🚀 Focus timer started: *${task}* for ${mins} minutes.` });
    setTimeout(async () => {
        await client.chat.postMessage({ channel: command.user_id, text: `🔔 *Focus Session Complete:* ${task}. Time to take a break!` });
    }, mins * 60000);
});

// ==========================================
// 4. ACTION & MODAL HANDLERS
// ==========================================

slackApp.view('add_task_view', async ({ ack, body, view }) => {
    await ack();
    const text = view.state.values.task_input.text_val.value;
    const priority = view.state.values.priority_input.priority_val.selected_option.value;
    await getUserCol(body.user.id, 'tasks').add({ text, priority, createdAt: Date.now(), status: 'active' });
});

slackApp.view('setup_reminder_view', async ({ ack, body, view }) => {
    const v = view.state.values;
    const frequency = v.freq_block.frequency.selected_option.value;
    const day = v.day_block.day.selected_option?.value;
    if (frequency === 'weekly' && !day) {
        return await ack({ response_action: "errors", errors: { day_block: "Select a day for weekly reminders." } });
    }
    await ack();
    await getUserCol(body.user.id, 'reminders').add({ text: v.text_block.text.value, frequency, day: day || null, time: v.time_block.time.selected_time });
});

slackApp.action('remove_item', async ({ ack, body, action, client }) => {
    await ack();
    const { col, id, label } = JSON.parse(action.value);
    await getUserCol(body.user.id, col).doc(id).delete();
    await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: `🗑 Removed: *${label}*` });
});

(async () => {
    await slackApp.start();
    console.log('✅ Assistant fully restored with Vault, Habits, Parking Lot, and Focus.');
})();